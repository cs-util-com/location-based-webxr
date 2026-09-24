/**
 * A physically based sky for a three.js scene: the visible sky, the scene's
 * image-based light, the sun's colour, and the horizon colour for fog, all
 * from ONE atmosphere (Hillaire 2020; plan 2026-09-23-0048).
 *
 * ONE SCALE FOR EVERYTHING NATURAL. The sky mesh, the baked environment map and
 * the sun light are all expressed in scene units by the same factor:
 *
 *     radianceToScene = sunIntensity × exposure / (T_ref · ATMOSPHERE_RADIANCE_SCALE)
 *
 * where `sunIntensity` is the intensity the caller's `DirectionalLight` should
 * have with the sun at the reference elevation (and exposure 1). So the lit
 * scene and the sky behind it are provably the same sky.
 *
 * EXPOSURE FOLLOWS THE LIGHT. After every sky rebuild the sky-view LUT is read
 * back (it is needed for the horizon colour anyway), the illuminance on a
 * horizontal surface is measured (direct sun + sky), and a partially adapting
 * auto-exposure picks the exposure (`atmosphere-exposure.ts`). The caller adds
 * a compensation in EV. Exposure scales all NATURAL light and never
 * `renderer.toneMappingExposure`, which would also move emissive materials
 * (OsmDemo's heat grid, DEC-R4-5).
 *
 * GPU WORK ONLY ON CHANGE. The transmittance and multi-scattering LUTs depend
 * only on the medium (visibility); the sky-view LUT and the environment bake
 * on the sun too; exposure compensation on nothing. An unchanged value does
 * nothing, which is what an on-demand renderer needs.
 *
 * WHAT IT DOES NOT TOUCH: `scene.background` (the sky mesh replaces it) and
 * `renderer.toneMapping` (the caller's grading decision).
 *
 * @see sky-atmosphere.ts.md
 */

import * as THREE from 'three';

import {
  autoExposure,
  horizonAverage,
  skyIrradiance,
} from './atmosphere-exposure.js';
import {
  ATMOSPHERE_RADIANCE_SCALE,
  SKY_FRAGMENT_GLSL,
  SKY_VERTEX_GLSL,
} from './atmosphere-glsl.js';
import { skyIlluminanceCpu } from './atmosphere-fallback.js';
import { SKY_VIEW_LUT_SIZE } from './atmosphere-lut-mapping.js';
import {
  CLOUD_LAYER,
  cloudThreshold,
  createCloudTexture,
} from './cloud-layer.js';
import {
  CLOUD_MODES,
  createCloudSheet,
  type CloudMode,
} from './cloud-sheet.js';
import {
  type AtmosphereDevice,
  type AtmosphereUniforms,
  type LutName,
  WebGlAtmosphereDevice,
} from './atmosphere-luts.js';
import {
  EARTH_ATMOSPHERE,
  mieExtinctionForVisibility,
  sunLight,
  transmittanceToTop,
  luminance,
  type Rgb,
  type AtmosphereParams,
} from './atmosphere-model.js';

/** A direction in the render frame, +y up. */
export interface DirectionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Thrown when the device cannot render float targets; keep the fallback sky. */
export class SkyAtmosphereUnsupportedError extends Error {
  constructor() {
    super(
      'SkyAtmosphere needs EXT_color_buffer_half_float or EXT_color_buffer_float'
    );
    this.name = 'SkyAtmosphereUnsupportedError';
  }
}

export interface SkyAtmosphereOptions {
  readonly scene: THREE.Scene;
  /** Used to build the default WebGL device. Required unless `device` is given. */
  readonly renderer?: THREE.WebGLRenderer;
  /** The GPU half; tests inject a fake. */
  readonly device?: AtmosphereDevice;
  /** Meteorological visibility, km. Default 60. */
  readonly visibilityKm?: number;
  /** Observer height above sea level, km. Default 0.2. */
  readonly observerAltitudeKm?: number;
  /** The sun light's intensity at the reference elevation. Default 1. */
  readonly sunIntensity?: number;
}

/**
 * The gain the environment is baked with, divided back out of
 * `scene.environmentIntensity` (real-sun plan 2026-09-23-2149, review
 * finding 6). The bake is exposure-free and sun-relative, and at civil
 * twilight (−6°) its values fall to ~1e-5, below the smallest NORMAL half
 * float (6.1e-5): a GPU may flush the half-float cube to zero there and the
 * dusk scene would get no environment light. A power of two, so the round
 * trip is exact; sized in `sky-atmosphere.test.ts` against both ends (the
 * twilight minimum stays normal, the noon Mie glow stays under
 * `ATMOSPHERE_MAX_SCENE_RADIANCE`). Measured there (60 km visibility): the
 * dimmest twilight value 6.8e-6 at −6° (×1024: 113× above the smallest
 * normal), the brightest glow 1.13 next to a 10° sun (×1024: 52× below the
 * cap); every gain from ~36 to ~53 000 passes both, 1024 is near the middle
 * on a log scale.
 */
export const ENVIRONMENT_BAKE_GAIN = 1024;

/**
 * When the sky readback fails, the sky illuminance comes from the CPU
 * estimate (`skyIlluminanceCpu`, the fallback sky's), evaluated for a sun no
 * lower than this: civil dusk, −6°. Right at every sun down to −6°, and the
 * civil-dusk exposure below it, which keeps the exposure bounded (an
 * unguarded blue hour reaches ×5.6e5). It replaced a single illuminance
 * floor of 1e-3, which gave every set sun one exposure (a −3.2° sun's: a
 * −1° sun 3.5× over-exposed, civil dusk ~3 EV too dark; real-sun plan
 * 2026-09-23-2149, review finding 7).
 */
const READBACK_FAILED_MIN_SUN_Y = Math.sin((-6 * Math.PI) / 180);

/** Throws RangeError for options that would silently render a black or wrong sky. */
function validateOptions(options: SkyAtmosphereOptions): void {
  mieExtinctionForVisibility(options.visibilityKm ?? 60);
  const altitude = options.observerAltitudeKm;
  const thickness =
    EARTH_ATMOSPHERE.topRadiusKm - EARTH_ATMOSPHERE.groundRadiusKm;
  if (
    altitude !== undefined &&
    !(Number.isFinite(altitude) && altitude >= 0 && altitude < thickness)
  ) {
    throw new RangeError(
      `observerAltitudeKm must be in [0, ${thickness}), got ${altitude}`
    );
  }
  const intensity = options.sunIntensity;
  if (
    intensity !== undefined &&
    !(Number.isFinite(intensity) && intensity > 0)
  ) {
    throw new RangeError(
      `sunIntensity must be a positive finite number, got ${intensity}`
    );
  }
}

export class SkyAtmosphere {
  /** The visible sky. Added to the scene; drawn first, at the far plane. */
  readonly sky: THREE.Mesh;
  private readonly scene: THREE.Scene;
  private readonly device: AtmosphereDevice;
  private readonly uniforms: AtmosphereUniforms;
  /**
   * The bake's scale: LUT radiance → sun-relative units × the bake gain,
   * WITHOUT exposure or `sunIntensity` (both are in environmentIntensity).
   */
  private readonly bakeScale: THREE.IUniform<number> = { value: 0 };
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeMaterial: THREE.ShaderMaterial;
  private readonly observerAltitudeKm: number;
  private readonly sunIntensity: number;
  private readonly unsubscribeRestore: () => void;
  private visibility: number;
  private compensationEv = 0;
  private autoExposureValue = 1;
  /**
   * Sky irradiance (sun-relative): from the last readback, or from the CPU
   * estimate when the readback failed.
   */
  private skyIlluminance = 0;
  private readbackFailed = false;
  /**
   * Restored by `dispose()`: this object overwrites it with
   * sunIntensity × exposure ÷ the bake gain.
   */
  private readonly previousEnvironmentIntensity: number;
  private sun: THREE.Vector3 | undefined;
  private environment: { texture: THREE.Texture; dispose(): void } | undefined;
  private horizon: Rgb = [0, 0, 0];
  /** The cloud layer's uniforms, shared by the sky and the bake. */
  private readonly clouds = {
    atmCloudTexture: { value: createCloudTexture() as THREE.Texture },
    atmCloudCover: { value: 0 },
    /** The noise threshold for the cover; 2 (above any noise) = clear. */
    atmCloudThreshold: { value: 2 },
    atmCloudOffset: { value: new THREE.Vector2() },
  };
  /**
   * The VISIBLE sky's cloud threshold: the real one in dome mode, 2 (clear)
   * in sheet mode, where the sheet draws the clouds. The bake keeps the real
   * one either way, so the lighting does not change with the mode (plan
   * 2026-09-24-1010 §2).
   */
  private readonly visibleCloudThreshold = { value: 2 };
  private mode: CloudMode = 'dome';
  /** The fly-through sheet, while `cloudMode` is 'sheet'. */
  private sheet: THREE.Mesh | undefined;

  constructor(options: SkyAtmosphereOptions) {
    try {
      validateOptions(options);
    } catch (error) {
      // The caller handed over a device; a constructor that throws must not
      // leak it (review finding 12).
      options.device?.dispose();
      throw error;
    }
    this.previousEnvironmentIntensity = options.scene.environmentIntensity;
    const device =
      options.device ??
      (options.renderer
        ? new WebGlAtmosphereDevice(options.renderer)
        : undefined);
    if (device === undefined) {
      throw new TypeError('SkyAtmosphere needs a renderer or a device');
    }
    if (!device.supported) {
      device.dispose();
      throw new SkyAtmosphereUnsupportedError();
    }
    this.device = device;
    this.scene = options.scene;
    this.visibility = options.visibilityKm ?? 60;
    this.observerAltitudeKm =
      options.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm;
    this.sunIntensity = options.sunIntensity ?? 1;

    this.uniforms = {
      atmMieExtinction: { value: mieExtinctionForVisibility(this.visibility) },
      atmTransmittanceLut: { value: device.transmittance },
      atmMultiScatteringLut: { value: device.multiScattering },
      atmSkyViewLut: { value: device.skyView },
      atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      atmSunCosZenith: { value: 1 },
      atmObserverRadius: {
        value: EARTH_ATMOSPHERE.groundRadiusKm + this.observerAltitudeKm,
      },
      atmRadianceToScene: { value: 0 },
    };
    this.updateScale();

    const geometry = new THREE.BoxGeometry(2, 2, 2);
    this.sky = new THREE.Mesh(
      geometry,
      this.skyMaterial(
        'atmosphere-sky',
        1,
        this.uniforms.atmRadianceToScene,
        1,
        this.visibleCloudThreshold
      )
    );
    this.sky.name = 'atmosphere-sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1e6;
    this.scene.add(this.sky);

    // The environment is baked from the sky WITHOUT the sun disc (a 14 700×
    // radiance spike in a 64² cube would make every glossy surface mirror one
    // texel; the sun's share comes from the light) and WITHOUT exposure, which
    // `scene.environmentIntensity` applies, once.
    this.bakeMaterial = this.skyMaterial(
      'atmosphere-sky-bake',
      0,
      this.bakeScale,
      0,
      this.clouds.atmCloudThreshold
    );
    const bakeMesh = new THREE.Mesh(geometry, this.bakeMaterial);
    bakeMesh.frustumCulled = false;
    this.bakeScene.add(bakeMesh);

    this.unsubscribeRestore = device.onContextRestored(() =>
      this.rebuild(true)
    );
  }

  private skyMaterial(
    name: string,
    sunDisc: number,
    scale: THREE.IUniform<number>,
    clampHorizon: number,
    threshold: THREE.IUniform<number>
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name,
      vertexShader: SKY_VERTEX_GLSL,
      fragmentShader: SKY_FRAGMENT_GLSL,
      // Spread, not cloned: every material reads the SAME uniform objects, so
      // one update reaches the sky, the bake and (later) the haze.
      uniforms: {
        ...this.uniforms,
        ...this.clouds,
        atmCloudThreshold: threshold,
        atmSunDiscEnabled: { value: sunDisc },
        atmClampHorizon: { value: clampHorizon },
        atmRadianceToScene: scale,
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
  }

  /** The current visibility, km. */
  get visibilityKm(): number {
    return this.visibility;
  }

  /** The exposure in effect: auto-exposure × 2^compensation. */
  get exposure(): number {
    return this.autoExposureValue * 2 ** this.compensationEv;
  }

  /** Scene units per unit of LUT radiance, exposure included. */
  get radianceToScene(): number {
    return this.uniforms.atmRadianceToScene.value;
  }

  /**
   * True when the last sky-view readback failed (a driver that refuses the
   * half-float read): the horizon colour is stale and the sky illuminance
   * comes from the CPU estimate.
   */
  get skyReadbackFailed(): boolean {
    return this.readbackFailed;
  }

  /** The shared uniforms (for the haze patch). */
  get sharedUniforms(): AtmosphereUniforms {
    return this.uniforms;
  }

  private params(): AtmosphereParams {
    return {
      visibilityKm: this.visibility,
      observerAltitudeKm: this.observerAltitudeKm,
    };
  }

  /** LUT radiance → sun-relative units (sun at the reference elevation = 1). */
  private lutToRelative(): number {
    const r = EARTH_ATMOSPHERE.groundRadiusKm + this.observerAltitudeKm;
    const reference = transmittanceToTop(
      r,
      Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
      this.params()
    );
    return 1 / (luminance(reference) * ATMOSPHERE_RADIANCE_SCALE);
  }

  private updateScale(): void {
    // The bake carries neither the exposure nor `sunIntensity` (an unbounded
    // option): both go into environmentIntensity, so the gain's measured
    // half-float window holds for any intensity, and a lit surface still
    // receives bake × intensity = radianceToScene.
    const relative = this.lutToRelative();
    this.bakeScale.value = relative * ENVIRONMENT_BAKE_GAIN;
    this.uniforms.atmRadianceToScene.value =
      this.sunIntensity * relative * this.exposure;
    this.scene.environmentIntensity =
      (this.sunIntensity * this.exposure) / ENVIRONMENT_BAKE_GAIN;
  }

  /**
   * Point the sun (a direction toward it, any length). Renders every LUT the
   * first time, then only the sky view; does nothing if the sun has not moved.
   */
  setSun(direction: DirectionLike): void {
    this.configure({ sunDirection: direction });
  }

  /** Set the meteorological visibility, km. Rebuilds every LUT. */
  setVisibilityKm(visibilityKm: number): void {
    this.configure({ visibilityKm });
  }

  /**
   * Change the sun and/or the visibility with ONE rebuild. Both values are
   * validated before anything changes, so a bad one never half-applies. A
   * preset change moves both; two separate setters rebuilt twice.
   */
  configure(change: {
    sunDirection?: DirectionLike;
    visibilityKm?: number;
    cloudCover?: number;
    /** Dome (the sky's own layer) or the fly-through sheet. */
    cloudMode?: CloudMode;
  }): void {
    // Validate everything before changing anything.
    const mode = this.changedMode(change.cloudMode);
    const mie = this.changedMie(change.visibilityKm);
    const sun = this.movedSun(change.sunDirection);
    const cover = this.changedCover(change.cloudCover);
    const firstSun = this.sun === undefined && sun !== undefined;
    if (cover !== undefined) this.applyCover(cover);
    this.applyMode(mode);
    if (mie !== undefined) {
      this.visibility = change.visibilityKm!;
      this.uniforms.atmMieExtinction.value = mie;
      this.updateScale();
    }
    if (sun !== undefined) {
      this.sun = sun;
      this.uniforms.atmSunDirection.value.copy(sun);
      this.uniforms.atmSunCosZenith.value = sun.y;
    }
    if (this.sun === undefined) return;
    const skyChanged = mie !== undefined || sun !== undefined;
    // The LUTs do not depend on clouds: a cover-only change just re-bakes.
    if (skyChanged) this.rebuild(mie !== undefined || firstSun);
    else if (cover !== undefined) this.rebake();
  }

  /** The new cover, or undefined if unchanged. Validates. */
  private changedCover(cover: number | undefined): number | undefined {
    if (cover === undefined) return undefined;
    if (!(Number.isFinite(cover) && cover >= 0 && cover <= 1)) {
      throw new RangeError(`cloud cover must be in [0, 1], got ${cover}`);
    }
    return cover === this.clouds.atmCloudCover.value ? undefined : cover;
  }

  private applyCover(cover: number): void {
    this.clouds.atmCloudCover.value = cover;
    // Cover 0 gives an infinite threshold; 2 is above any noise value and
    // keeps the uniform finite.
    this.clouds.atmCloudThreshold.value = Math.min(cloudThreshold(cover), 2);
    this.syncVisibleClouds();
  }

  /** The current cloud mode. */
  get cloudMode(): CloudMode {
    return this.mode;
  }

  /** The new mode, or undefined if unchanged. Validates. */
  private changedMode(mode: CloudMode | undefined): CloudMode | undefined {
    if (mode === undefined) return undefined;
    if (!(CLOUD_MODES as readonly string[]).includes(mode)) {
      throw new RangeError(
        `cloud mode must be one of ${CLOUD_MODES.join(', ')}, got ${String(mode)}`
      );
    }
    return mode === this.mode ? undefined : mode;
  }

  /**
   * Adds or removes the sheet (undefined: unchanged). No re-bake: the bake keeps the dome clouds in
   * both modes, so only the visible clouds change.
   */
  private applyMode(mode: CloudMode | undefined): void {
    if (mode === undefined) return;
    this.mode = mode;
    if (mode === 'sheet') {
      // Spread, not cloned: the sheet reads the SAME uniform objects as the
      // sky (LUTs, sun, scale, cloud cover, offset and the real threshold).
      this.sheet = createCloudSheet({ ...this.uniforms, ...this.clouds });
      this.scene.add(this.sheet);
    } else {
      this.removeSheet();
    }
    this.syncVisibleClouds();
  }

  private syncVisibleClouds(): void {
    this.visibleCloudThreshold.value =
      this.mode === 'sheet' ? 2 : this.clouds.atmCloudThreshold.value;
  }

  private removeSheet(): void {
    if (this.sheet === undefined) return;
    this.scene.remove(this.sheet);
    this.sheet.geometry.dispose();
    (this.sheet.material as THREE.Material).dispose();
    this.sheet = undefined;
  }

  /** The new sea-level Mie extinction, or undefined if unchanged. Validates. */
  private changedMie(visibilityKm: number | undefined): number | undefined {
    if (visibilityKm === undefined) return undefined;
    const mie = mieExtinctionForVisibility(visibilityKm);
    return visibilityKm === this.visibility ? undefined : mie;
  }

  /** The normalised new sun, or undefined if it has not moved. Validates. */
  private movedSun(
    direction: DirectionLike | undefined
  ): THREE.Vector3 | undefined {
    if (direction === undefined) return undefined;
    const next = new THREE.Vector3(direction.x, direction.y, direction.z);
    const finite = [next.x, next.y, next.z].every(Number.isFinite);
    if (!finite || next.lengthSq() === 0) {
      throw new RangeError('the sun direction must be finite and non-zero');
    }
    next.normalize();
    const moved =
      this.sun === undefined || this.sun.distanceToSquared(next) >= 1e-14;
    return moved ? next : undefined;
  }

  /** Exposure compensation in EV on top of the auto-exposure. No GPU work. */
  setExposureCompensation(ev: number): void {
    if (!Number.isFinite(ev)) {
      throw new RangeError(`exposure compensation must be finite, got ${ev}`);
    }
    this.compensationEv = ev;
    this.updateScale();
  }

  /**
   * Cloud cover, 0 (clear) … 1 (overcast). Re-bakes the environment (it
   * reflects the clouds); the LUTs do not depend on clouds.
   */
  setClouds(clouds: { cover: number }): void {
    this.configure({ cloudCover: clouds.cover });
  }

  /**
   * Drift the clouds by `seconds` of wind. No GPU work: an app that animates
   * clouds calls this per frame; an on-demand renderer (OsmDemo) never needs
   * to. The bake keeps the clouds where they were when it ran.
   */
  advanceClouds(seconds: number, windKmPerSecond = 0.012): void {
    if (!Number.isFinite(seconds) || !Number.isFinite(windKmPerSecond)) return;
    const step = (windKmPerSecond * seconds) / CLOUD_LAYER.tileKm;
    const offset = this.clouds.atmCloudOffset.value;
    offset.set((offset.x + step) % 1, (offset.y + 0.35 * step) % 1);
  }

  /** Colour and intensity for the caller's sun light, on the same scale as the sky. */
  applySunLight(light: THREE.DirectionalLight): void {
    const s = sunLight(this.sun?.y ?? 1, this.params());
    light.color.setRGB(s.colour[0], s.colour[1], s.colour[2]);
    light.intensity = this.sunIntensity * this.exposure * s.intensity;
  }

  /**
   * The sky just above the horizon, averaged over azimuth, in scene units: a
   * colour for `scene.fog`, so unpatched materials fade to the sky's own
   * horizon instead of a constant.
   */
  horizonColour(): THREE.Color {
    const scale = this.uniforms.atmRadianceToScene.value;
    return new THREE.Color(
      this.horizon[0] * scale,
      this.horizon[1] * scale,
      this.horizon[2] * scale
    );
  }

  /** One LUT texel, for the look-dev page's GPU/CPU parity check. */
  readLutTexel(lut: LutName, x: number, y: number): [number, number, number] {
    return this.device.readTexel(lut, x, y);
  }

  private rebuild(medium: boolean): void {
    if (medium) {
      this.device.render('transmittance', this.uniforms);
      this.device.render('multiScattering', this.uniforms);
    }
    this.device.render('skyView', this.uniforms);
    this.measure(this.device.readSkyView());
    this.updateScale();
    this.rebake();
  }

  /** Bake the environment from the current sky; generate, then dispose the old. */
  private rebake(): void {
    // Generate BEFORE disposing, so a throw leaves the previous environment in
    // place rather than none (the rule OsmDemo's first sky rig established).
    const next = this.device.bakeEnvironment(this.bakeScene);
    this.environment?.dispose();
    this.environment = next;
    this.scene.environment = next.texture;
  }

  /**
   * Horizon colour and horizontal illuminance from the sky-view LUT. A failed
   * readback (null) keeps the previous horizon colour and takes the sky
   * illuminance from the CPU estimate instead (see
   * `READBACK_FAILED_MIN_SUN_Y`), so exposure stays right and bounded.
   */
  private measure(skyView: Float32Array | null): void {
    const { width, height } = SKY_VIEW_LUT_SIZE;
    this.readbackFailed = skyView === null;
    if (skyView !== null) {
      const r = EARTH_ATMOSPHERE.groundRadiusKm + this.observerAltitudeKm;
      this.horizon = horizonAverage(skyView, width, height, r);
      this.skyIlluminance =
        luminance(skyIrradiance(skyView, width, height, r)) *
        this.lutToRelative();
    }
    const y = this.sun?.y ?? 1;
    if (skyView === null) {
      this.skyIlluminance = skyIlluminanceCpu(
        Math.max(y, READBACK_FAILED_MIN_SUN_Y),
        this.params()
      );
    }
    const s = sunLight(y, this.params());
    // The luminance the light actually delivers (colour × intensity), on a
    // horizontal surface.
    const direct = luminance(s.colour) * s.intensity * Math.max(0, y);
    // Sun-relative horizontal illuminance: the auto-exposure's input.
    const illuminance = this.skyIlluminance + direct;
    this.autoExposureValue = autoExposure(illuminance);
  }

  /** Release every GPU resource and clear what this set on the scene. */
  dispose(): void {
    this.unsubscribeRestore();
    this.scene.remove(this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.bakeMaterial.dispose();
    this.removeSheet();
    if (this.environment !== undefined) {
      if (this.scene.environment === this.environment.texture)
        this.scene.environment = null;
      this.environment.dispose();
      this.environment = undefined;
    }
    this.scene.environmentIntensity = this.previousEnvironmentIntensity;
    this.clouds.atmCloudTexture.value.dispose();
    this.device.dispose();
  }
}
