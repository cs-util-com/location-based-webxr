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
import { autoExposure } from './atmosphere-exposure.js';
import { fallbackSky, skyIlluminanceCpu } from './atmosphere-fallback.js';
import { ATMOSPHERE_MAX_SCENE_RADIANCE } from './atmosphere-glsl.js';
import { skyRadiance } from './atmosphere-scattering.js';
import { SKY_VIEW_LUT_SIZE } from './atmosphere-lut-mapping.js';
import {
  EARTH_ATMOSPHERE,
  luminance,
  transmittanceToTop,
} from './atmosphere-model.js';
import type { AtmosphereDevice, LutName } from './atmosphere-luts.js';
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
    expect(stepsOf(slab)).toBe(16);
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
