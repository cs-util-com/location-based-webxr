/**
 * Tests for SkyAtmosphere's bookkeeping, against a fake GPU device.
 *
 * Why this file matters: the GPU half cannot run in CI, but almost every way
 * this object can go wrong is bookkeeping. A LUT regenerated on every call is
 * a per-frame cost the on-demand renderer exists to avoid. An environment map
 * replaced without disposing the old one leaks VRAM every time the user drags
 * the time slider (round 5 shipped exactly that leak). A context restore that
 * does not re-render leaves a black sky. Exposure that re-renders LUTs wastes
 * a pass. All of that is testable with a fake device, so it is.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { horizonAverage } from './atmosphere-exposure.js';
import { AUTO_EXPOSURE, autoExposure } from './atmosphere-exposure.js';
import { fallbackSky, skyIlluminanceCpu } from './atmosphere-fallback.js';
import { ATMOSPHERE_MAX_SCENE_RADIANCE } from './atmosphere-glsl.js';
import { skyRadiance } from './atmosphere-scattering.js';
import { cloudColumnTransmittanceToward } from './cloud-column.js';
import { CLOUD_SHEET } from './cloud-sheet.js';
import {
  CLOUD_TEXTURE_SIZE,
  cloudNoise,
  cloudNoiseSample,
} from './cloud-layer.js';
import { SKY_VIEW_LUT_SIZE } from './atmosphere-lut-mapping.js';
import {
  EARTH_ATMOSPHERE,
  luminance,
  transmittanceToTop,
} from './atmosphere-model.js';
import type {
  AtmosphereDevice,
  LutName,
  SkyViewRead,
} from './atmosphere-luts.js';
import {
  ENVIRONMENT_BAKE_GAIN,
  SkyAtmosphere,
  SkyAtmosphereUnsupportedError,
} from './sky-atmosphere.js';

class FakeDevice implements AtmosphereDevice {
  supported = true;
  readonly transmittance = new THREE.Texture();
  readonly multiScattering = new THREE.Texture();
  readonly skyView = new THREE.Texture();
  renders: LutName[] = [];
  bakes = 0;
  released = 0;
  disposed = false;
  /** Every sky-view texel's radiance (LUT units); tests change it. */
  skyRadiance = 2;
  /** When set, the radiance of each sky-view ROW (overrides skyRadiance). */
  rowRadiance: ((row: number) => number) | undefined;
  /** Simulates a driver whose half-float readback fails. */
  readbackFails = false;
  /** The scene the last environment bake rendered. */
  bakedScene: THREE.Scene | undefined;
  private restoreListeners: Array<() => void> = [];

  render(lut: LutName): void {
    this.renders.push(lut);
  }
  bakeEnvironment(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  } {
    this.bakes += 1;
    this.bakedScene = scene;
    return {
      texture: new THREE.Texture(),
      dispose: () => (this.released += 1),
    };
  }
  readSkyView(): Float32Array | null {
    if (this.readbackFails) return null;
    const { width, height } = SKY_VIEW_LUT_SIZE;
    const lut = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const value = this.rowRadiance?.(y) ?? this.skyRadiance;
      lut.fill(value, y * width * 4, (y + 1) * width * 4);
    }
    return lut;
  }
  /** Asynchronous sky-view reads started (the staged path). */
  asyncReads = 0;
  /** Polls an asynchronous read answers "not yet" before it is ready. */
  pollsBeforeReady = 1;
  /** Asynchronous reads cancelled before they were taken. */
  cancelledReads = 0;
  /** Bakes into the device's own reused target (the staged path). */
  reusedBakes = 0;
  /** The reused bake's one texture. */
  readonly reusedTexture = new THREE.Texture();
  beginSkyViewRead(): SkyViewRead | null {
    this.asyncReads += 1;
    let polls = this.pollsBeforeReady;
    return {
      ready: () => polls-- <= 0,
      take: () => this.readSkyView(),
      cancel: () => (this.cancelledReads += 1),
    };
  }
  bakeEnvironmentReused(scene: THREE.Scene): {
    texture: THREE.Texture;
    dispose(): void;
  } {
    this.reusedBakes += 1;
    this.bakedScene = scene;
    return { texture: this.reusedTexture, dispose: () => {} };
  }
  readTexel(): [number, number, number] {
    return [0, 0, 0];
  }
  onContextRestored(listener: () => void): () => void {
    this.restoreListeners.push(listener);
    return () =>
      (this.restoreListeners = this.restoreListeners.filter(
        (l) => l !== listener
      ));
  }
  restoreContext(): void {
    for (const l of this.restoreListeners) l();
  }
  dispose(): void {
    this.disposed = true;
  }
}

const UP = { x: 0, y: 1, z: 0 };
const LOW = { x: Math.cos(0.05), y: Math.sin(0.05), z: 0 };

function setup(options: { sunIntensity?: number } = {}) {
  const scene = new THREE.Scene();
  const device = new FakeDevice();
  const atmosphere = new SkyAtmosphere({ scene, device, ...options });
  return { scene, device, atmosphere };
}

describe('SkyAtmosphere', () => {
  // Without float render targets there is no sky to draw. Refusing loudly
  // lets the caller keep its fallback sky; a half-built object would draw
  // black.
  it('refuses to construct on a device without float render targets', () => {
    const device = new FakeDevice();
    device.supported = false;
    expect(
      () => new SkyAtmosphere({ scene: new THREE.Scene(), device })
    ).toThrow(SkyAtmosphereUnsupportedError);
  });

  // The first sun renders all three LUTs and bakes the environment once.
  it('builds every LUT and one environment for the first sun', () => {
    const { device, atmosphere, scene } = setup();
    atmosphere.setSun(UP);
    expect(device.renders).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
    expect(device.bakes).toBe(1);
    expect(scene.environment).toBeInstanceOf(THREE.Texture);
  });

  // The on-demand renderer (OsmDemo DEC-R3-9) calls setSun on every change
  // notification; an unchanged sun must cost nothing.
  it('does no GPU work when the sun has not moved', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    const before = device.renders.length;
    atmosphere.setSun({ ...UP });
    expect(device.renders.length).toBe(before);
    expect(device.bakes).toBe(1);
  });

  // Moving the sun only needs the sky-view LUT and a new environment; the
  // transmittance and multi-scattering LUTs do not depend on the sun.
  it('re-renders only the sky view when the sun moves, disposing the old environment', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    atmosphere.setSun(LOW);
    expect(device.renders.slice(3)).toEqual(['skyView']);
    expect(device.bakes).toBe(2);
    expect(device.released).toBe(1);
  });

  // Visibility changes the medium itself, so everything is rebuilt.
  it('rebuilds everything when visibility changes', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    atmosphere.setVisibilityKm(20);
    expect(device.renders.slice(3)).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
  });

  // A bad slider value must not reach a shader, and must not half-apply.
  it('rejects an invalid visibility without changing anything', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    expect(() => atmosphere.setVisibilityKm(Number.NaN)).toThrow(RangeError);
    expect(device.renders.length).toBe(3);
  });

  // Exposure compensation is a slider dragged freely: it scales the sky, the
  // environment and the sun light, and must never re-render a LUT or
  // re-bake. +1 EV is exactly twice the light.
  it('applies exposure compensation without GPU work', () => {
    const { device, atmosphere, scene } = setup();
    atmosphere.setSun(UP);
    const before = atmosphere.exposure;
    atmosphere.setExposureCompensation(1);
    expect(device.renders.length).toBe(3);
    expect(device.bakes).toBe(1);
    expect(atmosphere.exposure).toBeCloseTo(2 * before, 10);
    // The environment carries the exposure, net of the bake gain.
    expect(scene.environmentIntensity).toBeCloseTo(
      atmosphere.exposure / ENVIRONMENT_BAKE_GAIN,
      10
    );
  });

  // The light dialog's auto-exposure strength (plan 2026-09-24-2140): like
  // the compensation, a slider dragged freely, so no GPU work; the exposure
  // follows the curve at the SAME illuminance; a bad value changes nothing.
  it('applies the auto-exposure adaptation without GPU work', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    const before = atmosphere.exposure;
    expect(atmosphere.autoExposureAdaptation).toBe(AUTO_EXPOSURE.adaptation);
    atmosphere.setAutoExposureAdaptation(0.4);
    expect(device.renders.length).toBe(3);
    expect(device.bakes).toBe(1);
    expect(atmosphere.autoExposureAdaptation).toBe(0.4);
    expect(atmosphere.exposure).not.toBeCloseTo(before, 6);
    atmosphere.setAutoExposureAdaptation(AUTO_EXPOSURE.adaptation);
    expect(atmosphere.exposure).toBeCloseTo(before, 12);
    expect(() => atmosphere.setAutoExposureAdaptation(2)).toThrow(RangeError);
    expect(atmosphere.autoExposureAdaptation).toBe(AUTO_EXPOSURE.adaptation);
  });

  // The environment is baked WITHOUT exposure, and exposure is applied once,
  // through scene.environmentIntensity. Baking it in as well was a real bug
  // in the first draft: exposure squared on every lit surface.
  //
  // The first version of this test compared two getters over the same
  // arithmetic, so wiring the bake to the sky's uniform (the real bug) left
  // it green (M1 milestone review, finding 3). It now reads the uniform the
  // BAKED MATERIAL actually carries, from the scene the device rendered.
  it('bakes the environment exposure-free', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.setExposureCompensation(2);
    const mesh = device.bakedScene!.children[0] as THREE.Mesh;
    const bakeScale = (mesh.material as THREE.ShaderMaterial).uniforms
      .atmRadianceToScene!;
    const skyScale = (atmosphere.sky.material as THREE.ShaderMaterial).uniforms
      .atmRadianceToScene!;
    expect(bakeScale).not.toBe(skyScale);
    // The bake carries a fixed gain (see the next test) and the environment
    // intensity divides it back out, so a lit surface still receives the
    // sky's radiance × exposure exactly once.
    expect(
      (bakeScale.value * atmosphere.exposure) / ENVIRONMENT_BAKE_GAIN
    ).toBeCloseTo(atmosphere.radianceToScene, 12);
  });

  // The bake gain's measured window (below) assumes the bake does not
  // scale with `sunIntensity`, a public option with no upper bound; the
  // intensity belongs with the exposure in environmentIntensity, and a lit
  // surface still receives bake × intensity = the sky's scene radiance
  // (M3 review finding 7).
  it('keeps the bake independent of sunIntensity, and the lit product exact', () => {
    const bakeValue = (sunIntensity: number) => {
      const { atmosphere, device, scene } = setup({ sunIntensity });
      atmosphere.setSun(UP);
      const mesh = device.bakedScene!.children[0] as THREE.Mesh;
      const bake = (mesh.material as THREE.ShaderMaterial).uniforms
        .atmRadianceToScene!.value as number;
      expect(bake * scene.environmentIntensity).toBeCloseTo(
        atmosphere.radianceToScene,
        12
      );
      return bake;
    };
    expect(bakeValue(40)).toBeCloseTo(bakeValue(1), 12);
  });

  // WHY (real-sun plan 2026-09-23-2149, review finding 6): the environment
  // is baked into a HALF-FLOAT cube, exposure-free, in sun-relative units.
  // At civil twilight (−6°) those values are 1e-5 to 5e-5, below the
  // smallest NORMAL half float (6.1e-5): a GPU may flush them to zero and
  // the dusk scene gets no environment light at all. A fixed gain keeps the
  // bake normal; it must not push the bright end (the Mie glow next to a
  // high sun) past the sky's own radiance cap, or noon would clip.
  it('keeps the twilight bake above the smallest normal half float, and noon below the cap', () => {
    const SMALLEST_NORMAL_HALF = 6.104e-5;
    const params = { visibilityKm: 60 };
    const exposureFree = (sunElevationDeg: number) => {
      const e = (sunElevationDeg * Math.PI) / 180;
      const sky = fallbackSky({ x: Math.cos(e), y: Math.sin(e), z: 0 }, params);
      return [...sky.zenith, ...sky.horizon].map((c) => c / sky.exposure);
    };
    for (const elevation of [-6, -5, -3]) {
      const dimmest = Math.min(...exposureFree(elevation));
      expect(dimmest * ENVIRONMENT_BAKE_GAIN).toBeGreaterThan(
        4 * SMALLEST_NORMAL_HALF
      );
    }
    // The bright end: single scattering 0.7° from the sun (half a 64² cube
    // texel), where the Mie glow peaks; ×1.5 for the multiple scattering a
    // zero Ψ leaves out.
    const r =
      EARTH_ATMOSPHERE.groundRadiusKm +
      EARTH_ATMOSPHERE.defaultObserverAltitudeKm;
    const toRelative =
      1 /
      luminance(
        transmittanceToTop(
          r,
          Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
          params
        )
      );
    for (const elevation of [2, 10, 45, 90]) {
      const e = (elevation * Math.PI) / 180;
      const viewZenith = Math.max(0, Math.PI / 2 - e - (0.7 * Math.PI) / 180);
      const glow = skyRadiance(
        r,
        viewZenith,
        0,
        Math.sin(e),
        params,
        () => [0, 0, 0],
        32
      );
      const peak = Math.max(...glow) * toRelative * 1.5;
      expect(peak * ENVIRONMENT_BAKE_GAIN).toBeLessThan(
        ATMOSPHERE_MAX_SCENE_RADIANCE
      );
    }
  });

  // Auto-exposure follows the light: the same sun under a brighter sky gets
  // less exposure, and a sun below the horizon gets more than noon.
  it('auto-exposes for the measured light', () => {
    const dim = setup();
    dim.atmosphere.setSun(UP);
    const bright = setup();
    bright.device.skyRadiance = 200;
    bright.atmosphere.setSun(UP);
    expect(bright.atmosphere.exposure).toBeLessThan(dim.atmosphere.exposure);
    const dusk = setup();
    dusk.atmosphere.setSun({ x: 1, y: -0.1, z: 0 });
    expect(dusk.atmosphere.exposure).toBeGreaterThan(dim.atmosphere.exposure);
  });

  it('rejects a non-finite exposure compensation', () => {
    const { atmosphere } = setup();
    expect(() => atmosphere.setExposureCompensation(Number.NaN)).toThrow(
      RangeError
    );
  });

  // The sun light is the model's colour and intensity, scaled by the scene's
  // sun intensity and the exposure: the SAME scale the sky is drawn with.
  //
  // Stated as an INDEPENDENT formula: colour × intensity (what three
  // multiplies) must equal sunIntensity × exposure × T / lum(T_ref), the scale
  // the sky is drawn with. Comparing the light with sunLight()'s own output,
  // as the first version did, confirmed a light 0.55× too dim at golden hour.
  it('drives a DirectionalLight on the same scale as the sky', () => {
    const { atmosphere } = setup({ sunIntensity: 1.1 });
    atmosphere.setSun(LOW);
    atmosphere.setExposureCompensation(0.5);
    const light = new THREE.DirectionalLight();
    atmosphere.applySunLight(light);
    const params = { visibilityKm: atmosphere.visibilityKm };
    const r = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;
    const t = transmittanceToTop(r, LOW.y, params);
    const tRef = transmittanceToTop(
      r,
      Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
      params
    );
    const scale = (1.1 * atmosphere.exposure) / luminance(tRef);
    expect(light.color.r * light.intensity).toBeCloseTo(t[0] * scale, 8);
    expect(light.color.g * light.intensity).toBeCloseTo(t[1] * scale, 8);
    expect(light.color.b * light.intensity).toBeCloseTo(t[2] * scale, 8);
  });

  // WIRING: horizonColour is horizonAverage of the readback (which samples
  // at the clamp height the sky and the haze use; the maths is tested in
  // atmosphere-exposure.test.ts) times the scene scale, with the observer's
  // own radius. A sky that varies by row, so reading any other row, or
  // passing another radius, gives a different value (M1 review finding 3; M3
  // moved the sample from the geometric-horizon row to the clamp height).
  it('takes the horizon colour at the clamp height, from the readback', () => {
    const scene = new THREE.Scene();
    const device = new FakeDevice();
    device.rowRadiance = (row) => 1 + row;
    const atmosphere = new SkyAtmosphere({
      scene,
      device,
      observerAltitudeKm: 1.5,
    });
    atmosphere.setSun(UP);
    const readback = device.readSkyView();
    if (readback === null) throw new Error('fake readback');
    const { width, height } = SKY_VIEW_LUT_SIZE;
    const expected = horizonAverage(
      readback,
      width,
      height,
      EARTH_ATMOSPHERE.groundRadiusKm + 1.5
    );
    expect(atmosphere.horizonColour().r).toBeCloseTo(
      expected[0] * atmosphere.radianceToScene,
      10
    );
    // ...and that is not the old geometric-horizon row.
    expect(expected[0]).not.toBeCloseTo(1 + (height / 2 - 1), 1);
  });

  // A preset change moves the sun AND the visibility. Doing that as two
  // setters rendered every LUT, read back and baked, then did the sky view,
  // readback and bake again (review finding 13).
  it('applies a sun and visibility change with one rebuild', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.configure({ sunDirection: LOW, visibilityKm: 20 });
    expect(device.renders.slice(3)).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
    expect(device.bakes).toBe(2);
  });

  // Boundary validation: a NaN intensity or altitude renders black without
  // an error, and a throw after the device exists must not leak it.
  it.each([
    [{ sunIntensity: Number.NaN }],
    [{ sunIntensity: 0 }],
    [{ observerAltitudeKm: -1 }],
    [{ observerAltitudeKm: 150 }],
    [{ visibilityKm: 0 }],
  ])('rejects %o and releases the device', (options) => {
    const device = new FakeDevice();
    expect(
      () => new SkyAtmosphere({ scene: new THREE.Scene(), device, ...options })
    ).toThrow(RangeError);
    expect(device.disposed).toBe(true);
  });

  // A phone driver may refuse the half-float readback. Without the sky's
  // measurement, exposure must stay bounded: the unguarded version would
  // expose a blue-hour scene ×5.6e5 (review finding 5).
  //
  // AND RIGHT, not only bounded (real-sun plan 2026-09-23-2149, review
  // finding 7, answered differently): a single illuminance floor gave EVERY
  // set sun one exposure, so a −1° sun and civil dusk looked alike (1e-3
  // was a −3.2° sun: −1° over-exposed, −6° 3 EV too dark). The CPU sky
  // estimate the fallback already uses is right at every sun; below −6° it
  // holds the civil-dusk value, which keeps the bound.
  it('exposes a failed readback from the CPU sky estimate at every sun down to −6°', () => {
    const { atmosphere, device } = setup();
    device.readbackFails = true;
    const params = { visibilityKm: atmosphere.visibilityKm };
    const at = (deg: number) => {
      const e = (deg * Math.PI) / 180;
      atmosphere.setSun({ x: Math.cos(e), y: Math.sin(e), z: 0 });
      return atmosphere.exposure;
    };
    for (const deg of [-1, -3, -6]) {
      const expected = autoExposure(
        skyIlluminanceCpu(Math.sin((deg * Math.PI) / 180), params)
      );
      expect(at(deg) / expected).toBeCloseTo(1, 9);
    }
    // Deeper suns hold the civil-dusk exposure: bounded, and finite.
    expect(at(-20)).toBeCloseTo(at(-6), 9);
    expect(at(-1)).toBeLessThan(at(-3));
    expect(at(-3)).toBeLessThan(at(-6));
  });

  // The horizon colour (for scene.fog, which colours unpatched materials) is
  // the sky-view LUT's horizon row in scene units, so fog and sky agree.
  it('derives the horizon colour from the horizon row, in scene units', () => {
    const { atmosphere } = setup();
    atmosphere.setSun(UP);
    const colour = atmosphere.horizonColour();
    expect(colour.r).toBeCloseTo(2 * atmosphere.radianceToScene, 10);
  });

  // Render-target contents do not survive a WebGL context loss. Headless
  // Chromium loses and restores the context at load in this repo
  // (gallery.ts.md), and phones do it on backgrounding.
  it('rebuilds everything after the WebGL context is restored', () => {
    const { device, atmosphere } = setup();
    atmosphere.setSun(UP);
    device.restoreContext();
    expect(device.renders.slice(3)).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
    expect(device.bakes).toBe(2);
  });

  // The sky is a mesh drawn first, never culled, writing no depth, so every
  // opaque object draws over it whatever the far plane.
  it('adds a sky mesh that is drawn first and never culled', () => {
    const { scene, atmosphere } = setup();
    expect(scene.children).toContain(atmosphere.sky);
    expect(atmosphere.sky.frustumCulled).toBe(false);
    expect(atmosphere.sky.renderOrder).toBeLessThan(-1000);
    expect((atmosphere.sky.material as THREE.Material).depthWrite).toBe(false);
  });

  // Leaving a disposed texture assigned is a use-after-free three does not
  // report (OsmDemo's first sky rig learned it). Dispose clears what it set.
  it('disposes everything and clears what it set on the scene', () => {
    const { device, atmosphere, scene } = setup();
    atmosphere.setSun(UP);
    atmosphere.dispose();
    expect(device.released).toBe(1);
    expect(device.disposed).toBe(true);
    expect(scene.environment).toBeNull();
    expect(scene.children).not.toContain(atmosphere.sky);
  });

  // environmentIntensity carries the exposure (×25 at golden hour). Left in
  // place after dispose, whatever lights the scene next is ×25 too (review
  // finding 7).
  it('restores the scene environment intensity it found', () => {
    const scene = new THREE.Scene();
    scene.environmentIntensity = 0.7;
    const atmosphere = new SkyAtmosphere({ scene, device: new FakeDevice() });
    atmosphere.setSun(LOW);
    expect(scene.environmentIntensity).not.toBe(0.7);
    atmosphere.dispose();
    expect(scene.environmentIntensity).toBe(0.7);
  });
});

describe('SkyAtmosphere clouds', () => {
  // Cloud cover changes what the environment reflects, so it re-bakes, but
  // the LUTs do not depend on clouds and are not re-rendered.
  it('re-bakes the environment, and only that, when the cover changes', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.setClouds({ cover: 0.5 });
    expect(device.renders.length).toBe(3);
    expect(device.bakes).toBe(2);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    expect(sky.uniforms.atmCloudCover!.value).toBe(0.5);
  });

  // An unchanged cover is free, like an unchanged sun.
  it('does nothing for an unchanged cover', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.setClouds({ cover: 0 });
    expect(device.bakes).toBe(1);
  });

  it.each([-0.1, 1.5, Number.NaN])('rejects cover %s', (cover) => {
    const { atmosphere } = setup();
    expect(() => atmosphere.setClouds({ cover })).toThrow(RangeError);
  });

  // Drift is a per-frame offset: it must never touch the GPU (an app that
  // animates clouds calls this every frame).
  it('drifts the clouds without GPU work', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const before = (sky.uniforms.atmCloudOffset!.value as THREE.Vector2).x;
    atmosphere.advanceClouds(10);
    expect((sky.uniforms.atmCloudOffset!.value as THREE.Vector2).x).not.toBe(
      before
    );
    expect(device.renders.length).toBe(3);
    expect(device.bakes).toBe(1);
  });

  // The environment bake and the visible sky must show the SAME clouds.
  it('shares the cloud uniforms between the sky and the bake', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const bake = (device.bakedScene!.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(bake.uniforms.atmCloudCover).toBe(sky.uniforms.atmCloudCover);
    expect(bake.uniforms.atmCloudOffset).toBe(sky.uniforms.atmCloudOffset);
  });
});

describe('SkyAtmosphere clouds (M2 review fixes)', () => {
  // A preset changes sun, visibility and cover together: one bake, not two
  // (review finding 13).
  it('applies sun, visibility and cloud cover with one bake', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.configure({
      sunDirection: LOW,
      visibilityKm: 20,
      cloudCover: 0.4,
    });
    expect(device.bakes).toBe(2);
    // ...and the cover was APPLIED: a count alone passed while configure
    // silently ignored the field.
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    expect(sky.uniforms.atmCloudCover!.value).toBe(0.4);
  });

  // Cover is uploaded as the THRESHOLD the shader compares the noise with:
  // finite, inside the noise range, lower for more cover.
  it('uploads a finite, cover-dependent threshold', () => {
    const { atmosphere } = setup();
    atmosphere.setSun(UP);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    atmosphere.setClouds({ cover: 0.2 });
    const few = sky.uniforms.atmCloudThreshold!.value as number;
    atmosphere.setClouds({ cover: 0.8 });
    const many = sky.uniforms.atmCloudThreshold!.value as number;
    expect(Number.isFinite(few)).toBe(true);
    expect(many).toBeLessThan(few);
    expect(few).toBeLessThanOrEqual(1);
  });

  // A NaN wind would make the offset NaN for good (review finding 10).
  it('ignores a non-finite wind', () => {
    const { atmosphere } = setup();
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const offset = sky.uniforms.atmCloudOffset!.value as THREE.Vector2;
    atmosphere.advanceClouds(1, Number.NaN);
    expect(Number.isFinite(offset.x)).toBe(true);
  });

  // The visible sky clamps below the horizon like the haze; the bake keeps
  // the ground's bounce light for undersides (review finding 3).
  it('clamps below the horizon in the visible sky only', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const bake = (device.bakedScene!.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(sky.uniforms.atmClampHorizon!.value).toBe(1);
    expect(bake.uniforms.atmClampHorizon!.value).toBe(0);
  });
});

describe('SkyAtmosphere cloud mode (fly-through sheet plan 2026-09-24-1010)', () => {
  const sheetIn = (scene: THREE.Scene) =>
    scene.getObjectByName('atmosphere-cloud-sheet') as THREE.Mesh | undefined;
  const threshold = (material: THREE.Material) =>
    (material as THREE.ShaderMaterial).uniforms.atmCloudThreshold!
      .value as number;
  const bakeMaterial = (device: FakeDevice) =>
    (device.bakedScene!.children[0] as THREE.Mesh).material as THREE.Material;

  // WHY: dome mode must stay exactly what OsmDemo and every other caller get
  // today: nothing added to their scene.
  it('adds nothing in the default dome mode', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudCover: 0.5 });
    expect(sheetIn(scene)).toBeUndefined();
  });

  // WHY (plan §2, review findings 9 and 13): one layer, not two, and the
  // lighting unchanged. The visible sky's clouds clear, the sheet draws them,
  // and the environment bake keeps the dome clouds, so reflections and the
  // diffuse light do not change when the mode flips (no re-bake needed).
  it('draws the clouds on the sheet, clears them from the visible sky, keeps the bake', () => {
    const { atmosphere, scene, device } = setup();
    atmosphere.configure({ sunDirection: UP, cloudCover: 0.5 });
    const real = threshold(atmosphere.sky.material as THREE.Material);
    expect(real).toBeLessThan(2);
    const bakes = device.bakes;
    atmosphere.configure({ cloudMode: 'sheet' });
    const sheet = sheetIn(scene)!;
    expect(sheet).toBeDefined();
    expect(threshold(atmosphere.sky.material as THREE.Material)).toBe(2);
    expect(threshold(sheet.material as THREE.Material)).toBe(real);
    expect(threshold(bakeMaterial(device))).toBe(real);
    expect(device.bakes).toBe(bakes);
    // The sheet reads the sky's own uniforms (one update reaches both).
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const sheetUniforms = (sheet.material as THREE.ShaderMaterial).uniforms;
    expect(sheetUniforms.atmSunDirection).toBe(sky.uniforms.atmSunDirection);
    expect(sheetUniforms.atmRadianceToScene).toBe(
      sky.uniforms.atmRadianceToScene
    );
    expect(sheetUniforms.atmCloudOffset).toBe(sky.uniforms.atmCloudOffset);
  });

  it('follows cover changes on the sheet while the sky stays clear', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'sheet' });
    atmosphere.configure({ cloudCover: 0.7 });
    const sheet = sheetIn(scene)!;
    expect(threshold(sheet.material as THREE.Material)).toBeLessThan(2);
    expect(threshold(atmosphere.sky.material as THREE.Material)).toBe(2);
  });

  it('goes back to the dome, removing the sheet and restoring the sky', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudCover: 0.5 });
    const real = threshold(atmosphere.sky.material as THREE.Material);
    atmosphere.configure({ cloudMode: 'sheet' });
    atmosphere.configure({ cloudMode: 'dome' });
    expect(sheetIn(scene)).toBeUndefined();
    expect(threshold(atmosphere.sky.material as THREE.Material)).toBe(real);
    expect(atmosphere.cloudMode).toBe('dome');
  });

  it('rejects an unknown mode before changing anything', () => {
    const { atmosphere, scene } = setup();
    expect(() =>
      atmosphere.configure({
        cloudCover: 0.5,
        cloudMode: 'volume' as never,
      })
    ).toThrow(RangeError);
    expect(sheetIn(scene)).toBeUndefined();
    expect(
      (atmosphere.sky.material as THREE.ShaderMaterial).uniforms.atmCloudCover!
        .value
    ).toBe(0);
  });

  it('removes and frees the sheet on dispose', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'sheet' });
    const sheet = sheetIn(scene)!;
    let freed = 0;
    sheet.geometry.addEventListener('dispose', () => (freed += 1));
    (sheet.material as THREE.Material).addEventListener(
      'dispose',
      () => (freed += 1)
    );
    atmosphere.dispose();
    expect(sheetIn(scene)).toBeUndefined();
    expect(freed).toBe(2);
  });
});

describe('SkyAtmosphere cloud slab (plan 2026-09-24-1010 §11-§12)', () => {
  const byName = (scene: THREE.Scene, name: string) =>
    scene.getObjectByName(name) as THREE.Mesh | undefined;
  const slabIn = (scene: THREE.Scene) => byName(scene, 'atmosphere-cloud-slab');
  const threshold = (material: THREE.Material) =>
    (material as THREE.ShaderMaterial).uniforms.atmCloudThreshold!
      .value as number;
  const stepsOf = (mesh: THREE.Mesh) =>
    (mesh.material as THREE.ShaderMaterial).defines['ATM_SLAB_STEPS'];

  // WHY: the slab is the third way of drawing ONE layer. The visible sky
  // clears, the slab reads the real threshold and the sky's own uniforms,
  // and the bake keeps the dome clouds (the lighting does not change).
  it('draws the clouds in the slab, clears the visible sky, and shares the uniforms', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudCover: 0.5 });
    const real = threshold(atmosphere.sky.material as THREE.Material);
    atmosphere.configure({ cloudMode: 'slab' });
    const slab = slabIn(scene)!;
    expect(slab).toBeDefined();
    expect(threshold(atmosphere.sky.material as THREE.Material)).toBe(2);
    expect(threshold(slab.material as THREE.Material)).toBe(real);
    const sky = atmosphere.sky.material as THREE.ShaderMaterial;
    const uniforms = (slab.material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.atmSunDirection).toBe(sky.uniforms.atmSunDirection);
    expect(uniforms.atmCloudOffset).toBe(sky.uniforms.atmCloudOffset);
    // The default is 8 steps since the owner's round 2 (plan 2026-09-26-2055
    // M2: no difference worth the cost against 16-32 on the look-dev page).
    expect(stepsOf(slab)).toBe(8);
  });

  // WHY: switching between the two meshes must leave exactly one cloud
  // mesh, or the A/B draws both layers at once.
  it('keeps exactly one cloud mesh across sheet, slab and dome', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'sheet' });
    atmosphere.configure({ cloudMode: 'slab' });
    expect(byName(scene, 'atmosphere-cloud-sheet')).toBeUndefined();
    expect(slabIn(scene)).toBeDefined();
    atmosphere.configure({ cloudMode: 'sheet' });
    expect(slabIn(scene)).toBeUndefined();
    expect(byName(scene, 'atmosphere-cloud-sheet')).toBeDefined();
    atmosphere.configure({ cloudMode: 'slab' });
    atmosphere.configure({ cloudMode: 'dome' });
    expect(slabIn(scene)).toBeUndefined();
    expect(byName(scene, 'atmosphere-cloud-sheet')).toBeUndefined();
  });

  // WHY: the step count is the cost knob the owner turns; a bad value must
  // change nothing, and a value set before the slab exists must apply when
  // it is created.
  it('takes the step count, before or after the slab exists, and refuses one it is not built for', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudSlabSteps: 8 });
    atmosphere.configure({ cloudMode: 'slab' });
    const slab = slabIn(scene)!;
    expect(stepsOf(slab)).toBe(8);
    const material = slab.material as THREE.ShaderMaterial;
    const version = material.version;
    atmosphere.configure({ cloudSlabSteps: 32 });
    expect(stepsOf(slab)).toBe(32);
    expect(material.version).toBeGreaterThan(version);
    expect(() =>
      atmosphere.configure({ cloudMode: 'dome', cloudSlabSteps: 12 as never })
    ).toThrow(RangeError);
    expect(atmosphere.cloudMode).toBe('slab');
    expect(stepsOf(slab)).toBe(32);
  });

  it('removes and frees the slab on dispose', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'slab' });
    const slab = slabIn(scene)!;
    let freed = 0;
    slab.geometry.addEventListener('dispose', () => (freed += 1));
    (slab.material as THREE.Material).addEventListener(
      'dispose',
      () => (freed += 1)
    );
    atmosphere.dispose();
    expect(slabIn(scene)).toBeUndefined();
    expect(freed).toBe(2);
  });
});

describe('SkyAtmosphere sun through clouds (round-3 plan 2026-09-27-0532, DEC-FB3-6)', () => {
  const uniformsOf = (m: THREE.Material | THREE.Material[]) =>
    (m as THREE.ShaderMaterial).uniforms;

  // WHY: the disc and the glow change every app's sky; they must be OFF
  // until an app asks (the look-dev page does), so OsmDemo's sky is unchanged.
  it('is off by default', () => {
    const { atmosphere } = setup();
    expect(atmosphere.sunThroughClouds).toEqual({
      discExponent: 0,
      aureole: 0,
      silverLining: 0,
    });
    const sky = uniformsOf(atmosphere.sky.material);
    expect(sky.atmCloudDiscExponent!.value).toBe(0);
    expect(sky.atmCloudForward!.value).toEqual(new THREE.Vector2(0, 0));
  });

  // WHY: one update must reach the sky, the bake and the slab (shared
  // uniform objects), and a field not given keeps its value.
  it('reaches the sky, the bake and the slab, field by field', () => {
    const { atmosphere, device, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'slab' });
    atmosphere.configure({ sunThroughClouds: { discExponent: 4 } });
    atmosphere.configure({ sunThroughClouds: { aureole: 1 } });
    atmosphere.configure({ sunThroughClouds: { silverLining: 0.5 } });
    // Each knob on its own (the owner compares each effect alone).
    expect(atmosphere.sunThroughClouds).toEqual({
      discExponent: 4,
      aureole: 1,
      silverLining: 0.5,
    });
    const sky = uniformsOf(atmosphere.sky.material);
    const bake = uniformsOf(
      (device.bakedScene!.children[0] as THREE.Mesh).material
    );
    const slab = uniformsOf(
      (scene.getObjectByName('atmosphere-cloud-slab') as THREE.Mesh).material
    );
    for (const u of [bake, slab]) {
      expect(u.atmCloudDiscExponent).toBe(sky.atmCloudDiscExponent);
    }
    expect(slab.atmCloudForward).toBe(sky.atmCloudForward);
    // The bake keeps its own lobes at zero: the glow must not light the
    // scene through the environment (round-3 review, finding 4).
    expect(bake.atmCloudForward).not.toBe(sky.atmCloudForward);
    expect(bake.atmCloudForward!.value).toEqual(new THREE.Vector2(0, 0));
    expect(sky.atmCloudDiscExponent!.value).toBe(4);
    expect(sky.atmCloudForward!.value).toEqual(new THREE.Vector2(1, 0.5));
  });

  // WHY: a misspelt or retired key (the first cut had one "forward") would
  // otherwise be dropped silently and its effect never switch.
  it('refuses an unknown key before changing anything', () => {
    const { atmosphere } = setup();
    atmosphere.setSun(UP);
    expect(() =>
      atmosphere.configure({
        sunThroughClouds: { discExponent: 4, forward: 1 } as never,
      })
    ).toThrow(/no "forward"/);
    expect(atmosphere.sunThroughClouds.discExponent).toBe(0);
  });

  // WHY: in the slab (and sheet) mode the visible sky draws no clouds (its
  // threshold is 2), but the disc behind the slab must still see them: the
  // disc reads the REAL threshold, and the world-anchored column.
  it('lets the disc see the real clouds and their anchor in every mode', () => {
    const { atmosphere } = setup();
    atmosphere.configure({ sunDirection: UP, cloudCover: 0.5 });
    const sky = uniformsOf(atmosphere.sky.material);
    const real = sky.atmCloudThreshold!.value as number;
    expect(sky.atmCloudAnchored!.value).toBe(0);
    for (const mode of ['slab', 'sheet'] as const) {
      atmosphere.configure({ cloudMode: mode });
      expect(sky.atmCloudThreshold!.value).toBe(2);
      expect(sky.atmCloudSunThreshold!.value).toBe(real);
      expect(sky.atmCloudAnchored!.value).toBe(1);
    }
    atmosphere.configure({ cloudMode: 'dome' });
    expect(sky.atmCloudAnchored!.value).toBe(0);
  });

  // WHY: the bake has no disc and no glow (its lobes are its own zeros), so
  // no sun-through-cloud knob re-bakes; a glow in the bake had lit the
  // ground +17 levels at noon (round-3 review, finding 4).
  it('never re-bakes for the sun-through-cloud knobs', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    const bakes = device.bakes;
    atmosphere.configure({ sunThroughClouds: { discExponent: 4 } });
    atmosphere.configure({ sunThroughClouds: { aureole: 1 } });
    atmosphere.configure({ sunThroughClouds: { silverLining: 1 } });
    expect(device.bakes).toBe(bakes);
    const bake = (device.bakedScene!.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(bake.uniforms.atmCloudForward!.value).toEqual(
      new THREE.Vector2(0, 0)
    );
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s before changing anything',
    (bad) => {
      const { atmosphere } = setup();
      atmosphere.setSun(UP);
      expect(() =>
        atmosphere.configure({
          cloudCover: 0.5,
          sunThroughClouds: { discExponent: 4, silverLining: bad },
        })
      ).toThrow(RangeError);
      expect(atmosphere.sunThroughClouds.discExponent).toBe(0);
      expect(uniformsOf(atmosphere.sky.material).atmCloudCover!.value).toBe(0);
    }
  );

  // WHY: a uniform the shader declares but the material does not supply
  // reads 0 or an unbound texture, silently: the disc would never dim.
  it('supplies every uniform the sky, the bake and the slab declare', () => {
    const { atmosphere, device, scene } = setup();
    atmosphere.configure({ sunDirection: UP, cloudMode: 'slab' });
    const slab = scene.getObjectByName('atmosphere-cloud-slab') as THREE.Mesh;
    const bakeMesh = device.bakedScene!.children[0] as THREE.Mesh;
    for (const material of [
      atmosphere.sky.material,
      bakeMesh.material,
      slab.material,
    ] as THREE.ShaderMaterial[]) {
      const declared = [
        ...material.fragmentShader.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm),
      ].map((m) => m[1]!);
      expect(declared.length).toBeGreaterThan(0);
      for (const name of declared) {
        expect(
          material.uniforms[name],
          `${material.name}: ${name}`
        ).toBeDefined();
      }
    }
  });
});

describe('SkyAtmosphere.cloudTransmittanceToward (round-3 DEC-FB3-7)', () => {
  // WHY: the look-dev page dims the sun light by the clouds as a whole
  // through this; it must be the column model on the sky's OWN noise,
  // cover and drift (the twin, computed here independently), 1 when clear.
  it('is the column toward the sun on the sky’s own noise, cover and drift', () => {
    const { atmosphere } = setup();
    const sun = { x: 0.3, y: 0.8, z: -0.52 };
    atmosphere.configure({ sunDirection: sun, cloudCover: 0.6 });
    atmosphere.advanceClouds(500);
    const l = Math.hypot(sun.x, sun.y, sun.z);
    const dir: [number, number, number] = [sun.x / l, sun.y / l, sun.z / l];
    const u = atmosphere.cloudUniforms;
    const data = cloudNoise(CLOUD_TEXTURE_SIZE, 1);
    const values: number[] = [];
    for (const p of [
      [0, 0, 0],
      [4000, 0, -2500],
      [-900, 12, 7000],
    ] as [number, number, number][]) {
      const expected = cloudColumnTransmittanceToward(
        p,
        dir,
        u.atmCloudThreshold.value,
        (a, b) => cloudNoiseSample(data, CLOUD_TEXTURE_SIZE, a, b),
        [u.atmCloudOffset.value.x, u.atmCloudOffset.value.y],
        {
          camera: p,
          anchored: false,
          farFadeM: [CLOUD_SHEET.farFadeStartM, CLOUD_SHEET.farFadeEndM],
        }
      );
      expect(atmosphere.cloudTransmittanceToward(p)).toBeCloseTo(expected, 9);
      values.push(expected);
    }
    // A cover this heavy puts cloud over some of the points, not none.
    expect(Math.min(...values)).toBeLessThan(0.9);
  });

  // WHY (round-3 review, finding 1): at a 5° sun the column toward the sun
  // is read ~22 km out, past the slab's 21 km far fade, where the sky draws
  // no cloud. The view-weighted value (the whole-scene sun-light dimming,
  // which follows what the camera sees) must then read 1 in the slab,
  // although the unweighted column is thick. The ground shadows do NOT use
  // this weight (cloudShadowToward, owner bug report 2026-09-28).
  it('sees no cloud where the sky draws none (a low sun in the slab mode)', () => {
    const { atmosphere } = setup();
    const el = (5 * Math.PI) / 180;
    const sun = { x: Math.cos(el), y: Math.sin(el), z: 0 };
    atmosphere.configure({ sunDirection: sun, cloudCover: 0.9 });
    const u = atmosphere.cloudUniforms;
    const data = cloudNoise(CLOUD_TEXTURE_SIZE, 1);
    const raw = (p: [number, number, number]) =>
      cloudColumnTransmittanceToward(
        p,
        [sun.x, sun.y, sun.z],
        u.atmCloudThreshold.value,
        (a, b) => cloudNoiseSample(data, CLOUD_TEXTURE_SIZE, a, b),
        [u.atmCloudOffset.value.x, u.atmCloudOffset.value.y]
      );
    const points: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) points.push([i * 700, 0, i * 300]);
    // The unweighted column darkens most of these points at this cover.
    expect(points.filter((p) => raw(p) < 0.5).length).toBeGreaterThan(3);
    atmosphere.configure({ cloudMode: 'slab' });
    for (const p of points) {
      expect(atmosphere.cloudTransmittanceToward(p, p)).toBeGreaterThan(0.999);
    }
    // The dome draws its low clouds (horizon fade ~0.84 at 5°): it still
    // shades, as its disc is hidden.
    atmosphere.configure({ cloudMode: 'dome' });
    expect(
      points.filter((p) => atmosphere.cloudTransmittanceToward(p, p) < 0.5)
        .length
    ).toBeGreaterThan(3);
  });

  // WHY (owner bug report 2026-09-28): the ground's cloud shadow is the
  // same from every viewpoint, so its CPU twin takes no viewer: at a 5° sun
  // in the slab (where the view-weighted value above reads 1 everywhere)
  // the thick columns still shade, exactly as the unweighted column says.
  it('cloudShadowToward is the unweighted column, the same for every viewer', () => {
    const { atmosphere } = setup();
    const el = (5 * Math.PI) / 180;
    const sun = { x: Math.cos(el), y: Math.sin(el), z: 0 };
    atmosphere.configure({
      sunDirection: sun,
      cloudCover: 0.9,
      cloudMode: 'slab',
    });
    const u = atmosphere.cloudUniforms;
    const data = cloudNoise(CLOUD_TEXTURE_SIZE, 1);
    const points: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) points.push([i * 700, 0, i * 300]);
    for (const p of points) {
      const raw = cloudColumnTransmittanceToward(
        p,
        [sun.x, sun.y, sun.z],
        u.atmCloudThreshold.value,
        (a, b) => cloudNoiseSample(data, CLOUD_TEXTURE_SIZE, a, b),
        [u.atmCloudOffset.value.x, u.atmCloudOffset.value.y]
      );
      expect(atmosphere.cloudShadowToward(p)).toBeCloseTo(raw, 9);
    }
    expect(
      points.filter((p) => atmosphere.cloudShadowToward(p) < 0.5).length
    ).toBeGreaterThan(3);
    // No viewer and no draw weight: every cloud mode gives the same column.
    const slab = points.map((p) => atmosphere.cloudShadowToward(p));
    for (const mode of ['dome', 'sheet'] as const) {
      atmosphere.configure({ cloudMode: mode });
      points.forEach((p, i) => {
        expect(atmosphere.cloudShadowToward(p)).toBeCloseTo(slab[i], 12);
      });
    }
    expect(atmosphere.cloudShadowToward([0, 0, 0])).toBeLessThanOrEqual(1);
    expect(() => atmosphere.cloudShadowToward([Number.NaN, 0, 0])).toThrow(
      RangeError
    );
  });

  it('is 1 before a sun and in a clear sky, and refuses a non-finite point', () => {
    const { atmosphere } = setup();
    expect(atmosphere.cloudTransmittanceToward([0, 0, 0])).toBe(1);
    atmosphere.configure({ sunDirection: UP, cloudCover: 0 });
    expect(atmosphere.cloudTransmittanceToward([0, 0, 0])).toBe(1);
    expect(() =>
      atmosphere.cloudTransmittanceToward([Number.NaN, 0, 0])
    ).toThrow(RangeError);
  });
});

describe('SkyAtmosphere.setObserverAltitudeKm (globe F2 plan 2026-10-03-1922, F2b)', () => {
  const GROUND = EARTH_ATMOSPHERE.groundRadiusKm;

  // The globe lab's descent moves the observer from 100 km to the ground:
  // the sky must follow its height, synchronously like the sun's setter
  // (an on-demand page might never run a deferred rebuild).
  it('moves the observer and re-renders only the sky view, with one bake', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.setObserverAltitudeKm(40);
    expect(atmosphere.observerAltitudeKm).toBe(40);
    expect(atmosphere.sharedUniforms.atmObserverRadius.value).toBe(GROUND + 40);
    // The transmittance and multi-scattering tables do not depend on the
    // observer (they are tabulated over every radius).
    expect(device.renders.slice(3)).toEqual(['skyView']);
    expect(device.bakes).toBe(2);
  });

  // The scale follows: the sun-relative unit is the reference sun's
  // transmittance from the OBSERVER, so it changes with the height.
  it('rescales the sky to the new observer', () => {
    const { atmosphere } = setup();
    atmosphere.setSun(UP);
    const before = atmosphere.radianceToScene / atmosphere.exposure;
    atmosphere.setObserverAltitudeKm(60);
    const after = atmosphere.radianceToScene / atmosphere.exposure;
    const reference = (km: number) =>
      luminance(
        transmittanceToTop(
          GROUND + km,
          Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
          { visibilityKm: atmosphere.visibilityKm, observerAltitudeKm: km }
        )
      );
    expect(after / before).toBeCloseTo(
      reference(EARTH_ATMOSPHERE.defaultObserverAltitudeKm) / reference(60),
      9
    );
  });

  // An unchanged height must cost nothing (the lab quantises and calls it
  // every frame), and before the first sun nothing is built yet.
  it('does no GPU work for an unchanged height, or before the first sun', () => {
    const { atmosphere, device } = setup();
    atmosphere.setObserverAltitudeKm(10);
    expect(device.renders).toEqual([]);
    atmosphere.setSun(UP);
    const renders = device.renders.length;
    atmosphere.setObserverAltitudeKm(10);
    expect(device.renders.length).toBe(renders);
    expect(device.bakes).toBe(1);
  });

  // The model's atmosphere is 100 km thick: a height at or above its top,
  // negative or non-finite would render a black or wrong sky. Refused
  // before anything changes.
  it.each([-1, 100, 150, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s km and keeps the height it had',
    (km) => {
      const { atmosphere } = setup();
      atmosphere.setSun(UP);
      expect(() => atmosphere.setObserverAltitudeKm(km)).toThrow(RangeError);
      expect(atmosphere.observerAltitudeKm).toBe(
        EARTH_ATMOSPHERE.defaultObserverAltitudeKm
      );
    }
  );
});

describe('SkyAtmosphere staged rebuild (globe F2 plan 2026-10-03-1922, F2b)', () => {
  function staged() {
    const scene = new THREE.Scene();
    const device = new FakeDevice();
    const atmosphere = new SkyAtmosphere({ scene, device, rebuild: 'staged' });
    return { scene, device, atmosphere };
  }

  /** Steps until idle; returns the stages done, in order. */
  function drain(atmosphere: SkyAtmosphere): string[] {
    const stages: string[] = [];
    for (let s = atmosphere.stepRebuild(); s !== 'idle';) {
      stages.push(s);
      s = atmosphere.stepRebuild();
    }
    return stages;
  }

  // A page that renders every frame cannot afford a rebuild in one frame:
  // the tables, a synchronous readback (a full GPU wait) and a new PMREM
  // target. Staged, a setter only records the change, and each frame's
  // step does at most one stage: the tables, then the read, then the bake.
  it('does no GPU work in a setter, then one stage per step', () => {
    const { atmosphere, device, scene } = staged();
    atmosphere.setSun(UP);
    expect(device.renders).toEqual([]);
    expect(atmosphere.rebuildPending).toBe(true);
    expect(atmosphere.stepRebuild()).toBe('luts');
    expect(device.renders).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
    expect(device.asyncReads).toBe(1);
    expect(atmosphere.stepRebuild()).toBe('waiting');
    expect(atmosphere.stepRebuild()).toBe('read');
    expect(device.reusedBakes).toBe(0);
    expect(atmosphere.stepRebuild()).toBe('bake');
    expect(device.reusedBakes).toBe(1);
    expect(device.bakes).toBe(0);
    expect(scene.environment).toBe(device.reusedTexture);
    expect(atmosphere.rebuildPending).toBe(false);
    expect(atmosphere.stepRebuild()).toBe('idle');
  });

  // The staged read measures exactly what the synchronous one does: the
  // same exposure and horizon from the same sky.
  it('exposes the staged sky exactly as the synchronous one', () => {
    const { atmosphere } = staged();
    const { atmosphere: immediate } = setup();
    atmosphere.setSun(LOW);
    immediate.setSun(LOW);
    drain(atmosphere);
    expect(atmosphere.exposure).toBe(immediate.exposure);
    expect(atmosphere.radianceToScene).toBe(immediate.radianceToScene);
    expect(atmosphere.horizonColour()).toEqual(immediate.horizonColour());
  });

  // The PMREM target is reused, not allocated per bake: a descent of ~100
  // rebuilds must not allocate ~100 targets, and the one in use is never
  // disposed under the scene.
  it('bakes every rebuild into the one reused target', () => {
    const { atmosphere, device, scene } = staged();
    for (const km of [0.2, 10, 20, 30]) {
      atmosphere.setObserverAltitudeKm(km);
      atmosphere.setSun(km === 20 ? UP : LOW);
      drain(atmosphere);
    }
    expect(device.reusedBakes).toBe(4);
    expect(device.bakes).toBe(0);
    expect(device.released).toBe(0);
    expect(scene.environment).toBe(device.reusedTexture);
  });

  // A change while a rebuild is in flight finishes that rebuild (so the
  // bake is never starved by a change every frame) and then runs once
  // more from the latest values, not once per change.
  it('finishes the rebuild in flight, then rebuilds once for every change since', () => {
    const { atmosphere, device } = staged();
    atmosphere.setSun(UP);
    expect(atmosphere.stepRebuild()).toBe('luts');
    atmosphere.setObserverAltitudeKm(30);
    atmosphere.setObserverAltitudeKm(40);
    atmosphere.setSun(LOW);
    expect(drain(atmosphere)).toEqual([
      'waiting',
      'read',
      'bake',
      'luts',
      'waiting',
      'read',
      'bake',
    ]);
    // The second pass is the sky view alone: the medium did not change.
    expect(device.renders.slice(3)).toEqual(['skyView']);
    expect(device.reusedBakes).toBe(2);
    expect(atmosphere.sharedUniforms.atmObserverRadius.value).toBe(
      EARTH_ATMOSPHERE.groundRadiusKm + 40
    );
  });

  // The visibility changes the medium: the next pass renders every table.
  it('renders every table when the medium changed since the last pass', () => {
    const { atmosphere, device } = staged();
    atmosphere.setSun(UP);
    drain(atmosphere);
    atmosphere.setVisibilityKm(20);
    expect(atmosphere.stepRebuild()).toBe('luts');
    expect(device.renders.slice(3)).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
  });

  // A device without the asynchronous read (an older implementation of the
  // interface) still stages: the read stage reads synchronously, and the
  // bake is a new target each time, the old one disposed.
  it('stages on a device without the asynchronous read or the reused bake', () => {
    const { atmosphere, device } = staged();
    (device as { beginSkyViewRead?: unknown }).beginSkyViewRead = undefined;
    (device as { bakeEnvironmentReused?: unknown }).bakeEnvironmentReused =
      undefined;
    atmosphere.setSun(UP);
    expect(drain(atmosphere)).toEqual(['luts', 'read', 'bake']);
    expect(device.bakes).toBe(1);
    atmosphere.setSun(LOW);
    drain(atmosphere);
    expect(device.bakes).toBe(2);
    expect(device.released).toBe(1);
  });

  // A failed staged read keeps the exposure bounded exactly as a failed
  // synchronous one does (the CPU sky estimate).
  it('takes a failed read from the CPU sky estimate', () => {
    const { atmosphere, device } = staged();
    const { atmosphere: immediate, device: immediateDevice } = setup();
    device.readbackFails = true;
    immediateDevice.readbackFails = true;
    atmosphere.setSun(LOW);
    immediate.setSun(LOW);
    drain(atmosphere);
    expect(atmosphere.skyReadbackFailed).toBe(true);
    expect(atmosphere.exposure).toBe(immediate.exposure);
  });

  // A restored context lost every table: staged, it starts a full pass.
  it('starts a full staged rebuild after the WebGL context is restored', () => {
    const { atmosphere, device } = staged();
    atmosphere.setSun(UP);
    drain(atmosphere);
    device.restoreContext();
    expect(device.renders.length).toBe(3);
    expect(atmosphere.stepRebuild()).toBe('luts');
    expect(device.renders.slice(3)).toEqual([
      'transmittance',
      'multiScattering',
      'skyView',
    ]);
  });

  // A read in flight holds a GPU buffer and a fence: dispose releases it.
  it('cancels a read in flight on dispose', () => {
    const { atmosphere, device } = staged();
    atmosphere.setSun(UP);
    atmosphere.stepRebuild();
    atmosphere.dispose();
    expect(device.cancelledReads).toBe(1);
  });

  // OsmDemo renders on demand and must stay on today's path: the immediate
  // default never touches the staged device calls.
  it('never uses the staged device calls by default', () => {
    const { atmosphere, device } = setup();
    atmosphere.setSun(UP);
    atmosphere.setObserverAltitudeKm(20);
    expect(device.asyncReads).toBe(0);
    expect(device.reusedBakes).toBe(0);
    expect(atmosphere.rebuildPending).toBe(false);
    expect(atmosphere.stepRebuild()).toBe('idle');
  });

  it('refuses an unknown rebuild option and releases the device', () => {
    const device = new FakeDevice();
    expect(
      () =>
        new SkyAtmosphere({
          scene: new THREE.Scene(),
          device,
          rebuild: 'lazy' as 'staged',
        })
    ).toThrow(RangeError);
    expect(device.disposed).toBe(true);
  });
});

describe('SkyAtmosphere.setCloudSceneDepth (globe F2 plan 2026-10-03-1922, F2c)', () => {
  const slabOf = (scene: THREE.Scene) =>
    scene.children.find((c) => c.name === 'atmosphere-cloud-slab') as
      THREE.Mesh | undefined;

  // The globe lab hands the relief's depth to the slab so the march ends at
  // the ground. The slab exists only in slab mode, so the depth is kept and
  // reaches a slab made later, and survives a switch away and back.
  it('hands the depth to the slab, now and after a mode switch', () => {
    const { atmosphere, scene } = setup();
    const depth = new THREE.DepthTexture(4, 4);
    atmosphere.setCloudSceneDepth(depth);
    atmosphere.configure({ cloudMode: 'slab' });
    const slab = slabOf(scene)!;
    const m = slab.material as THREE.ShaderMaterial;
    expect(m.uniforms['atmSlabSceneDepth']!.value).toBe(depth);
    expect(m.defines['ATM_SLAB_SCENE_DEPTH']).toBe(1);
    atmosphere.configure({ cloudMode: 'dome' });
    atmosphere.configure({ cloudMode: 'slab' });
    const again = slabOf(scene)!.material as THREE.ShaderMaterial;
    expect(again.uniforms['atmSlabSceneDepth']!.value).toBe(depth);
  });

  it('takes the depth away from a slab that has one', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ cloudMode: 'slab' });
    atmosphere.setCloudSceneDepth(new THREE.DepthTexture(4, 4));
    atmosphere.setCloudSceneDepth(null);
    const m = slabOf(scene)!.material as THREE.ShaderMaterial;
    expect(m.defines['ATM_SLAB_SCENE_DEPTH']).toBeUndefined();
    expect(m.depthTest).toBe(true);
  });

  // The sheet and the dome have no march to end: the depth is only kept.
  it('does nothing to the sheet', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ cloudMode: 'sheet' });
    atmosphere.setCloudSceneDepth(new THREE.DepthTexture(4, 4));
    const sheet = scene.children.find(
      (c) => c.name === 'atmosphere-cloud-sheet'
    ) as THREE.Mesh;
    expect(
      (sheet.material as THREE.ShaderMaterial).uniforms['atmSlabSceneDepth']
    ).toBeUndefined();
  });
});

describe('SkyAtmosphere coverage map and disc (globe volume-cloud plan 2026-10-05-0016, C1)', () => {
  const slabOf = (scene: THREE.Scene) =>
    scene.children.find((c) => c.name === 'atmosphere-cloud-slab') as
      THREE.Mesh | undefined;
  const coverage = {
    glsl: 'uniform float uFlat;\nfloat atmCloudCoverageAt(vec2 xz) { return uFlat; }',
    uniforms: { uFlat: { value: 0.5 } },
  };

  // The globe lab hands the slab the globe's cloud map and a disc around the
  // camera; the slab exists only in slab mode, so both are kept and reach a
  // slab made later, as the scene depth does.
  it('hands the coverage and the disc to the slab, now and after a mode switch', () => {
    const { atmosphere, scene } = setup();
    atmosphere.setCloudCoverage(coverage);
    atmosphere.setCloudDiscRadius(20_000);
    atmosphere.configure({ cloudMode: 'slab' });
    const m = slabOf(scene)!.material as THREE.ShaderMaterial;
    expect(m.defines['ATM_CLOUD_COVERAGE']).toBe(1);
    expect(m.defines['ATM_CLOUD_DISC']).toBe(1);
    expect(m.uniforms['atmCoverDiscM']!.value).toBe(20_000);
    atmosphere.configure({ cloudMode: 'dome' });
    atmosphere.configure({ cloudMode: 'slab' });
    const again = slabOf(scene)!.material as THREE.ShaderMaterial;
    expect(again.defines['ATM_CLOUD_COVERAGE']).toBe(1);
    expect(again.uniforms['uFlat']!.value).toBe(0.5);
  });

  it('takes them away again', () => {
    const { atmosphere, scene } = setup();
    atmosphere.configure({ cloudMode: 'slab' });
    atmosphere.setCloudCoverage(coverage);
    atmosphere.setCloudDiscRadius(20_000);
    atmosphere.setCloudCoverage(null);
    atmosphere.setCloudDiscRadius(null);
    const m = slabOf(scene)!.material as THREE.ShaderMaterial;
    expect(m.defines['ATM_CLOUD_COVERAGE']).toBeUndefined();
    expect(m.defines['ATM_CLOUD_DISC']).toBeUndefined();
  });

  it('refuses a bad radius before keeping it', () => {
    const { atmosphere } = setup();
    expect(() => atmosphere.setCloudDiscRadius(-5)).toThrow(RangeError);
  });
});
