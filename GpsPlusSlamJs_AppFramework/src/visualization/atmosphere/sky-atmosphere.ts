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
  AUTO_EXPOSURE,
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
  cloudNoiseSample,
  cloudThreshold,
  createCloudTexture,
} from './cloud-layer.js';
import { CLOUD_NOISE_PERIOD_TILES, hexCloudThreshold } from './cloud-hex.js';
import { cloudColumnTransmittanceToward } from './cloud-column.js';
import {
  CLOUD_MODES,
  CLOUD_SHEET,
  createCloudSheet,
  type CloudMode,
} from './cloud-sheet.js';
import {
  CLOUD_SLAB,
  CLOUD_SLAB_STEPS,
  assertCloudSlabReach,
  createCloudSlab,
  setCloudSlabCoverage,
  setCloudSlabDiscCentre,
  setCloudSlabRadius,
  setCloudSlabReach,
  setCloudSlabSceneDepth,
  setCloudSlabSteps,
  type CloudSlabReach,
} from './cloud-slab.js';
import type { CloudDiscCentre } from './cloud-coverage.js';
import {
  type AtmosphereDevice,
  type AtmosphereUniforms,
  type LutName,
  type SkyViewRead,
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

/**
 * The sun through clouds (`cloud-sun.ts`, round-3 DEC-FB3-6), one knob per
 * effect so each can be judged alone (the owner's requirement). All off by
 * default, so no app's sky changes unasked; the look-dev page turns them on.
 */
export interface SunThroughClouds {
  /**
   * The disc's extinction exponent k: the disc behind a cloud keeps T^k of
   * itself, T the column's transmittance along the view. 0 = off (the disc
   * dims only as much as the sky behind the cloud); the page uses 4.
   */
  readonly discExponent: number;
  /**
   * The aureole's strength: the narrow forward lobe, thin cloud glowing a
   * few degrees around the sun (dome and slab). 0 = off, 1 = the model.
   */
  readonly aureole: number;
  /**
   * The silver lining's strength: the broad forward lobe, thin backlit
   * cloud edges brightened up to ~30° from the sun. 0 = off, 1 = the model.
   */
  readonly silverLining: number;
}

const SUN_THROUGH_CLOUDS_KEYS = ['discExponent', 'aureole', 'silverLining'];

/**
 * `change` over `current`, validated: an unknown key (a misspelling, or the
 * first cut's `forward`) would otherwise be dropped silently and its effect
 * never switch; every value must be a finite number ≥ 0.
 *
 * @throws RangeError for an unknown key or a bad value.
 */
function mergedSunThroughClouds(
  current: SunThroughClouds,
  change: Partial<SunThroughClouds>
): SunThroughClouds {
  for (const name of Object.keys(change)) {
    if (!SUN_THROUGH_CLOUDS_KEYS.includes(name)) {
      throw new RangeError(
        `sunThroughClouds has no "${name}"; one of ${SUN_THROUGH_CLOUDS_KEYS.join(', ')}`
      );
    }
  }
  const next = { ...current, ...change };
  for (const [name, value] of Object.entries(next)) {
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
      throw new RangeError(
        `sunThroughClouds.${name} must be a finite number ≥ 0, got ${String(value)}`
      );
    }
  }
  return next;
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
  /**
   * When a change rebuilds the sky. `'immediate'` (the default): before the
   * setter returns, as an on-demand renderer needs. `'staged'`: a setter
   * only records the change, and `stepRebuild()`, called once a frame by a
   * page that renders every frame, does at most one stage of the rebuild
   * (the tables, the asynchronous read, the bake), so no frame carries a
   * whole rebuild (globe F2 plan 2026-10-03-1922, F2b).
   */
  readonly rebuild?: 'immediate' | 'staged';
}

/**
 * What one `stepRebuild()` did: rendered the tables, waited for the read
 * (the GPU has not finished the copy), took the read and the exposure,
 * baked the environment, or nothing (no rebuild pending).
 */
export type RebuildStage = 'luts' | 'waiting' | 'read' | 'bake' | 'idle';

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

/** Throws RangeError for an observer outside the model's atmosphere. */
function validateObserverAltitude(altitude: number): void {
  const thickness =
    EARTH_ATMOSPHERE.topRadiusKm - EARTH_ATMOSPHERE.groundRadiusKm;
  if (!(Number.isFinite(altitude) && altitude >= 0 && altitude < thickness)) {
    throw new RangeError(
      `observerAltitudeKm must be in [0, ${thickness}), got ${altitude}`
    );
  }
}

/** Throws RangeError for options that would silently render a black or wrong sky. */
function validateOptions(options: SkyAtmosphereOptions): void {
  mieExtinctionForVisibility(options.visibilityKm ?? 60);
  if (options.observerAltitudeKm !== undefined) {
    validateObserverAltitude(options.observerAltitudeKm);
  }
  const rebuild = options.rebuild;
  if (
    rebuild !== undefined &&
    rebuild !== 'immediate' &&
    rebuild !== 'staged'
  ) {
    throw new RangeError(
      `rebuild must be 'immediate' or 'staged', got ${String(rebuild)}`
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
  private observerKm: number;
  private readonly sunIntensity: number;
  /** `rebuild: 'staged'`: setters record, `stepRebuild()` works. */
  private readonly staged: boolean;
  /** The staged rebuild's next pass (medium: every table), if one is due. */
  private pendingPass: { medium: boolean } | undefined;
  /** A staged bake due without a pass (a cloud cover change). */
  private pendingBake = false;
  /** Where the staged pass in flight is: its read, then its bake. */
  private stage: 'idle' | 'read' | 'bake' = 'idle';
  /** The pass's asynchronous read (null: the device reads synchronously). */
  private read: SkyViewRead | null = null;
  private readonly unsubscribeRestore: () => void;
  private visibility: number;
  private compensationEv = 0;
  private autoExposureValue = 1;
  /** The auto-exposure's adaptation (`setAutoExposureAdaptation`). */
  private adaptation: number = AUTO_EXPOSURE.adaptation;
  /** The last horizontal illuminance the exposure was computed from. */
  private illuminance = 1;
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
  /** The noise threshold for the cover; 2 (above any noise) = clear. */
  private readonly threshold = { value: 2 };
  /** The cloud layer's uniforms, shared by the sky, the bake and the meshes. */
  private readonly clouds = {
    atmCloudTexture: { value: createCloudTexture() as THREE.Texture },
    atmCloudCover: { value: 0 },
    atmCloudThreshold: this.threshold,
    atmCloudOffset: { value: new THREE.Vector2() },
    /** 1: the big-shape octave hex-tiled (`configure({ cloudHex })`). */
    atmCloudHex: { value: 0 },
    /** The disc's view of the clouds: the real threshold in every mode. */
    atmCloudSunThreshold: this.threshold,
    atmCloudFarFadeM: {
      value: new THREE.Vector2(
        CLOUD_SHEET.farFadeStartM,
        CLOUD_SHEET.farFadeEndM
      ),
    },
    atmCloudDiscExponent: { value: 0 },
    /** The forward lobes' strengths: x the aureole, y the silver lining. */
    atmCloudForward: { value: new THREE.Vector2() },
  };
  /**
   * Where the VISIBLE sky's disc reads the clouds: camera-centred at the
   * origin (0, the dome) or in the world (1, the sheet and the slab). The
   * bake has no disc and keeps 0.
   */
  private readonly cloudAnchored = { value: 0 };
  /**
   * The VISIBLE sky's cloud threshold: the real one in dome mode, 2 (clear)
   * in sheet and slab mode, where the sheet or the slab draws the clouds. The bake keeps the real
   * one either way, so the lighting does not change with the mode (plan
   * 2026-09-24-1010 §2).
   */
  private readonly visibleCloudThreshold = { value: 2 };
  private mode: CloudMode = 'dome';
  /** The fly-through sheet or slab, while `cloudMode` is 'sheet' or 'slab'. */
  private cloudMesh: THREE.Mesh | undefined;
  /** The slab's march steps (`configure({ cloudSlabSteps })`), kept across modes. */
  private slabSteps: number = CLOUD_SLAB.defaultSteps;
  /** The scene's depth for the slab (`setCloudSceneDepth`), kept across modes. */
  private sceneDepth: THREE.Texture | null = null;
  /** The slab's coverage map and disc (`setCloudCoverage`, `setCloudDiscRadius`). */
  private coverage: Parameters<typeof setCloudSlabCoverage>[1] = null;
  private discRadiusM: number | null = null;
  /** The slab's reach (`setCloudReach`), kept across modes; null the default. */
  /** The disc's centre (`setCloudDiscCentre`), kept across modes; null: the camera. */
  private discCentre: CloudDiscCentre | null = null;
  private reach: CloudSlabReach | null = null;

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
    this.observerKm =
      options.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm;
    this.sunIntensity = options.sunIntensity ?? 1;
    this.staged = options.rebuild === 'staged';

    this.uniforms = {
      atmMieExtinction: { value: mieExtinctionForVisibility(this.visibility) },
      atmTransmittanceLut: { value: device.transmittance },
      atmMultiScatteringLut: { value: device.multiScattering },
      atmSkyViewLut: { value: device.skyView },
      atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      atmSunCosZenith: { value: 1 },
      atmObserverRadius: {
        value: EARTH_ATMOSPHERE.groundRadiusKm + this.observerKm,
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
        this.visibleCloudThreshold,
        this.cloudAnchored
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
      this.clouds.atmCloudThreshold,
      { value: 0 }
    );
    // The glow stays out of the environment: in the bake it lit every
    // surface's image-based light too (+17 levels on lit ground at noon,
    // round-3 review finding 4), so the lobes switched the whole scene.
    this.bakeMaterial.uniforms['atmCloudForward'] = {
      value: new THREE.Vector2(0, 0),
    };
    const bakeMesh = new THREE.Mesh(geometry, this.bakeMaterial);
    bakeMesh.frustumCulled = false;
    this.bakeScene.add(bakeMesh);

    this.unsubscribeRestore = device.onContextRestored(() => {
      // The tables are gone, and so is any staged pass's read.
      this.abandonPass();
      this.rebuild(true);
    });
  }

  private skyMaterial(
    name: string,
    sunDisc: number,
    scale: THREE.IUniform<number>,
    clampHorizon: number,
    threshold: THREE.IUniform<number>,
    anchored: THREE.IUniform<number>
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
        atmCloudAnchored: anchored,
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

  /** The observer's height above sea level, km. */
  get observerAltitudeKm(): number {
    return this.observerKm;
  }

  /** Whether a staged rebuild has work left (always false when immediate). */
  get rebuildPending(): boolean {
    return (
      this.stage !== 'idle' ||
      this.pendingPass !== undefined ||
      this.pendingBake
    );
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

  /**
   * The cloud layer's uniforms (for the cloud shadow patch): the noise
   * texture, the REAL threshold in every mode (2 when clear), the drift
   * offset and the hex switch. The objects themselves: the offset moves in
   * place as the clouds drift.
   */
  get cloudUniforms(): {
    readonly atmCloudTexture: THREE.IUniform<THREE.Texture>;
    readonly atmCloudThreshold: THREE.IUniform<number>;
    readonly atmCloudOffset: THREE.IUniform<THREE.Vector2>;
    readonly atmCloudHex: THREE.IUniform<number>;
    readonly atmCloudAnchored: THREE.IUniform<number>;
    readonly atmCloudFarFadeM: THREE.IUniform<THREE.Vector2>;
  } {
    return { ...this.clouds, atmCloudAnchored: this.cloudAnchored };
  }

  /** The sun through clouds in effect (`configure({ sunThroughClouds })`). */
  get sunThroughClouds(): SunThroughClouds {
    return {
      discExponent: this.clouds.atmCloudDiscExponent.value,
      aureole: this.clouds.atmCloudForward.value.x,
      silverLining: this.clouds.atmCloudForward.value.y,
    };
  }

  /**
   * The share of the sun reaching the world point `point` (metres, the
   * scene frame) through the clouds: the cloud column the sun's ray
   * crosses, read on the CPU from the sky's own noise texture, cover and
   * drift, weighted by how much of that cloud the sky draws for a camera at
   * `viewer` (the mode's far fade or horizon fade, and the aerial melt;
   * `cloudColumnTransmittanceToward`). 1 before the first sun, for a sun at
   * or below the horizon and in a clear sky. For dimming a light by the
   * clouds as a whole as the camera sees them (the look-dev page's "sun
   * light dims" switch); the per-pixel ground shadows are `CloudShadow`'s,
   * with no view weight (their twin: `cloudShadowToward`).
   *
   * @throws RangeError for a non-finite point.
   */
  cloudTransmittanceToward(
    point: readonly [number, number, number],
    viewer: readonly [number, number, number] = point
  ): number {
    if (!point.every(Number.isFinite) || !viewer.every(Number.isFinite)) {
      throw new RangeError(
        `the point and the viewer must be finite, got ${point.join(', ')} / ${viewer.join(', ')}`
      );
    }
    const sun = this.sun;
    const threshold = this.clouds.atmCloudThreshold.value;
    if (sun === undefined || threshold >= 2) return 1;
    // The live texture's own data, not a second copy of the noise.
    const image = this.clouds.atmCloudTexture.value.image as {
      data: Uint8Array;
      width: number;
    };
    const offset = this.clouds.atmCloudOffset.value;
    const fade = this.clouds.atmCloudFarFadeM.value;
    return cloudColumnTransmittanceToward(
      point,
      [sun.x, sun.y, sun.z],
      threshold,
      (u, v) =>
        cloudNoiseSample(image.data, image.width, u, v, {
          hex: this.clouds.atmCloudHex.value === 1,
        }),
      [offset.x, offset.y],
      {
        camera: viewer,
        anchored: this.mode !== 'dome',
        farFadeM: [fade.x, fade.y],
      }
    );
  }

  /**
   * The share of the sun reaching `point` through the clouds, as
   * `CloudShadow` shades the ground: the column toward the sun alone, the
   * same from every viewpoint and in every cloud mode (no weight for how
   * much of that cloud a camera's sky draws; owner bug report 2026-09-28).
   * 1 before the first sun, for a sun at or below the horizon and in a
   * clear sky. The CPU twin of the cloud shadows.
   *
   * @throws RangeError for a non-finite point.
   */
  cloudShadowToward(point: readonly [number, number, number]): number {
    if (!point.every(Number.isFinite)) {
      throw new RangeError(`the point must be finite, got ${point.join(', ')}`);
    }
    const sun = this.sun;
    const threshold = this.clouds.atmCloudThreshold.value;
    if (sun === undefined || threshold >= 2) return 1;
    const image = this.clouds.atmCloudTexture.value.image as {
      data: Uint8Array;
      width: number;
    };
    const offset = this.clouds.atmCloudOffset.value;
    return cloudColumnTransmittanceToward(
      point,
      [sun.x, sun.y, sun.z],
      threshold,
      (u, v) =>
        cloudNoiseSample(image.data, image.width, u, v, {
          hex: this.clouds.atmCloudHex.value === 1,
        }),
      [offset.x, offset.y]
    );
  }

  /** The shared uniforms (for the haze patch). */
  get sharedUniforms(): AtmosphereUniforms {
    return this.uniforms;
  }

  private params(): AtmosphereParams {
    return {
      visibilityKm: this.visibility,
      observerAltitudeKm: this.observerKm,
    };
  }

  /** LUT radiance → sun-relative units (sun at the reference elevation = 1). */
  private lutToRelative(): number {
    const r = EARTH_ATMOSPHERE.groundRadiusKm + this.observerKm;
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

  /**
   * Move the observer, km above sea level, in [0, the atmosphere's
   * thickness). Re-renders the sky view and re-bakes (the other tables cover
   * every height); an unchanged height does nothing. Synchronous like the
   * sun's setter unless the rebuild is staged. Validated before any change.
   *
   * @throws RangeError for a height outside the atmosphere or non-finite.
   */
  setObserverAltitudeKm(km: number): void {
    validateObserverAltitude(km);
    if (km === this.observerKm) return;
    this.observerKm = km;
    this.uniforms.atmObserverRadius.value =
      EARTH_ATMOSPHERE.groundRadiusKm + km;
    this.updateScale();
    if (this.sun !== undefined) this.rebuild(false);
  }

  /**
   * Advance a staged rebuild by at most one stage (`rebuild: 'staged'`);
   * call once a frame. A pass renders the tables (every one when the medium
   * changed), takes the sky view's read once the GPU has finished it (the
   * horizon and the exposure follow), then bakes the environment into one
   * reused target. A change during a pass is applied by ONE further pass
   * after it, so a change every frame never starves the bake. Immediate
   * mode never has work: always `'idle'`.
   */
  stepRebuild(): RebuildStage {
    if (this.stage === 'read') {
      const read = this.read;
      if (read !== null && !read.ready()) return 'waiting';
      this.read = null;
      this.measure(read !== null ? read.take() : this.device.readSkyView());
      this.updateScale();
      this.stage = 'bake';
      return 'read';
    }
    if (this.stage === 'bake') {
      this.stage = 'idle';
      this.pendingBake = false;
      this.rebake();
      return 'bake';
    }
    const pass = this.pendingPass;
    if (pass !== undefined) {
      this.pendingPass = undefined;
      this.renderLuts(pass.medium);
      this.read = this.device.beginSkyViewRead?.() ?? null;
      this.stage = 'read';
      return 'luts';
    }
    if (this.pendingBake) {
      this.pendingBake = false;
      this.rebake();
      return 'bake';
    }
    return 'idle';
  }

  /** Drops the staged pass in flight (its read released). */
  private abandonPass(): void {
    this.read?.cancel();
    this.read = null;
    this.stage = 'idle';
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
    /** Dome (the sky's own layer), the fly-through sheet, or the slab. */
    cloudMode?: CloudMode;
    /** The slab's march steps, one of `CLOUD_SLAB_STEPS` (the cost knob). */
    cloudSlabSteps?: (typeof CLOUD_SLAB_STEPS)[number];
    /** The sun through clouds; the fields not given keep their value. */
    sunThroughClouds?: Partial<SunThroughClouds>;
    /**
     * The big-shape octave hex-tiled (hex-tiling plan H1): no repeat at
     * 24 km. A uniform (no new program), with the hex field's own cover
     * threshold; the bake follows, as for a cover change.
     */
    cloudHex?: boolean;
  }): void {
    // Validate everything before changing anything.
    const sunFx = this.changedSunThroughClouds(change.sunThroughClouds);
    const steps = this.changedSlabSteps(change.cloudSlabSteps);
    const mode = this.changedMode(change.cloudMode);
    const mie = this.changedMie(change.visibilityKm);
    const sun = this.movedSun(change.sunDirection);
    const cover = this.changedCover(change.cloudCover);
    const hex = this.changedHex(change.cloudHex);
    const firstSun = this.sun === undefined && sun !== undefined;
    const cloudsRebake = this.applyCloudLook(cover, sunFx, hex);
    this.applySlabSteps(steps);
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
    // The sun-through-cloud knobs never do: the bake has no disc, and no
    // glow (its own zero lobes, below).
    if (skyChanged) this.rebuild(mie !== undefined || firstSun);
    else if (cloudsRebake) {
      if (this.staged) this.pendingBake = true;
      else this.rebake();
    }
  }

  /**
   * Applies a validated cover, sun-through-clouds and hex change
   * (undefined: none); returns whether the bake must follow (a new cover or
   * a new switch).
   */
  private applyCloudLook(
    cover: number | undefined,
    sunFx: SunThroughClouds | undefined,
    hex: boolean | undefined
  ): boolean {
    if (hex !== undefined) this.clouds.atmCloudHex.value = hex ? 1 : 0;
    if (cover !== undefined || hex !== undefined) {
      this.applyCover(cover ?? this.clouds.atmCloudCover.value);
    }
    if (sunFx !== undefined) {
      this.clouds.atmCloudDiscExponent.value = sunFx.discExponent;
      this.clouds.atmCloudForward.value.set(sunFx.aureole, sunFx.silverLining);
    }
    return cover !== undefined || hex !== undefined;
  }

  /** The new hex switch, or undefined if unchanged. Validates. */
  private changedHex(hex: boolean | undefined): boolean | undefined {
    if (hex === undefined) return undefined;
    if (typeof hex !== 'boolean') {
      throw new RangeError(`cloudHex must be a boolean, got ${String(hex)}`);
    }
    return (this.clouds.atmCloudHex.value === 1) === hex ? undefined : hex;
  }

  /**
   * The sun through clouds after the change (fields not given keep their
   * value), or undefined if unchanged. Validates.
   */
  private changedSunThroughClouds(
    change: Partial<SunThroughClouds> | undefined
  ): SunThroughClouds | undefined {
    if (change === undefined) return undefined;
    const current = this.sunThroughClouds;
    const next = mergedSunThroughClouds(current, change);
    if (
      next.discExponent === current.discExponent &&
      next.aureole === current.aureole &&
      next.silverLining === current.silverLining
    ) {
      return undefined;
    }
    return next;
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
    // keeps the uniform finite. The hex field has its own thresholds.
    const threshold =
      this.clouds.atmCloudHex.value === 1
        ? hexCloudThreshold(cover)
        : cloudThreshold(cover);
    this.clouds.atmCloudThreshold.value = Math.min(threshold, 2);
    this.syncVisibleClouds();
  }

  /** The new slab step count, or undefined if unchanged. Validates. */
  private changedSlabSteps(steps: number | undefined): number | undefined {
    if (steps === undefined) return undefined;
    if (!(CLOUD_SLAB_STEPS as readonly number[]).includes(steps)) {
      throw new RangeError(
        `cloud slab steps must be one of ${CLOUD_SLAB_STEPS.join(', ')}, got ${String(steps)}`
      );
    }
    return steps === this.slabSteps ? undefined : steps;
  }

  private applySlabSteps(steps: number | undefined): void {
    if (steps === undefined) return;
    this.slabSteps = steps;
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabSteps(this.cloudMesh, steps);
    }
  }

  /**
   * The scene's depth for the cloud slab (globe F2 plan 2026-10-03-1922,
   * F2c), or null for none: the slab's march ends at the scene, so a ridge
   * in front of a cloud hides it and a deck over a valley ends at the
   * ground (`setCloudSlabSceneDepth`). Kept across modes and handed to a
   * slab made later; the sheet and the dome have no march and ignore it.
   * No GPU work.
   */
  setCloudSceneDepth(depth: THREE.Texture | null): void {
    this.sceneDepth = depth;
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabSceneDepth(this.cloudMesh, depth);
    }
  }

  /**
   * A coverage map for the cloud slab, or none (null): the caller's GLSL
   * defining `float atmCloudCoverageAt(vec2 xz)` and its uniforms (globe
   * volume-cloud plan 2026-10-05-0016, C1; `setCloudSlabCoverage`). Kept
   * across modes and handed to a slab made later; the sheet and the dome
   * ignore it. No GPU work.
   *
   * @throws RangeError as `setCloudSlabCoverage` (only once a slab exists).
   */
  setCloudCoverage(coverage: Parameters<typeof setCloudSlabCoverage>[1]): void {
    this.coverage = coverage;
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabCoverage(this.cloudMesh, coverage);
    }
  }

  /**
   * The cloud slab's disc around the camera (m), or none (null): its clouds
   * fade to clear from 0.7 r to r (C1; `setCloudSlabRadius`). Kept across
   * modes, like the coverage. Validated before it is kept.
   *
   * @throws RangeError for a radius that is not positive and finite.
   */
  setCloudDiscRadius(radiusM: number | null): void {
    if (radiusM !== null && !(radiusM > 0 && Number.isFinite(radiusM))) {
      throw new RangeError(`the disc radius must be positive, got ${radiusM}`);
    }
    this.discRadiusM = radiusM;
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabRadius(this.cloudMesh, radiusM);
    }
  }

  /**
   * How far out the cloud slab draws (globe volume-cloud plan 2026-10-05-0016
   * §13, R1; `setCloudSlabReach`), or the default (null). Kept across modes,
   * like the disc. Validated before it is kept.
   *
   * @throws RangeError for a reach that does not fade from 0 <= start < end.
   */
  setCloudReach(reach: CloudSlabReach | null): void {
    if (reach !== null) assertCloudSlabReach(reach);
    this.reach = reach;
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabReach(this.cloudMesh, reach);
    }
  }

  /**
   * The cloud slab's disc centre (globe volume-cloud plan 2026-10-05-0016
   * §15; `setCloudSlabDiscCentre`): a world point, or the camera (null, the
   * default). Kept across modes, like the disc. Validated before it is kept.
   *
   * @throws RangeError for a centre that is not finite.
   */
  setCloudDiscCentre(centre: CloudDiscCentre | null): void {
    if (
      centre !== null &&
      !(Number.isFinite(centre.x) && Number.isFinite(centre.z))
    ) {
      throw new RangeError(
        `the disc centre must be finite, got ${centre.x}, ${centre.z}`
      );
    }
    this.discCentre = centre === null ? null : { x: centre.x, z: centre.z };
    if (this.mode === 'slab' && this.cloudMesh !== undefined) {
      setCloudSlabDiscCentre(this.cloudMesh, this.discCentre);
    }
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
   * Swaps the cloud mesh for the mode (undefined: unchanged): the current
   * one goes first, so a switch never leaves two layers. No re-bake: the bake keeps the dome clouds in
   * both modes, so only the visible clouds change.
   */
  private applyMode(mode: CloudMode | undefined): void {
    if (mode === undefined) return;
    this.mode = mode;
    this.cloudAnchored.value = mode === 'dome' ? 0 : 1;
    this.removeCloudMesh();
    // Spread, not cloned: the mesh reads the SAME uniform objects as the
    // sky (LUTs, sun, scale, cloud cover, offset and the real threshold).
    const shared = { ...this.uniforms, ...this.clouds };
    if (mode === 'sheet') this.cloudMesh = createCloudSheet(shared);
    if (mode === 'slab') {
      this.cloudMesh = createCloudSlab(shared, this.slabSteps);
      this.applySlabSettings(this.cloudMesh);
    }
    if (this.cloudMesh !== undefined) this.scene.add(this.cloudMesh);
    this.syncVisibleClouds();
  }

  /**
   * Hands a slab made now everything set before it existed: the scene's
   * depth, the coverage map, the disc, its centre and the reach.
   */
  private applySlabSettings(slab: THREE.Mesh): void {
    if (this.sceneDepth !== null) setCloudSlabSceneDepth(slab, this.sceneDepth);
    if (this.coverage !== null) setCloudSlabCoverage(slab, this.coverage);
    if (this.discRadiusM !== null) setCloudSlabRadius(slab, this.discRadiusM);
    if (this.reach !== null) setCloudSlabReach(slab, this.reach);
    if (this.discCentre !== null) setCloudSlabDiscCentre(slab, this.discCentre);
  }

  private syncVisibleClouds(): void {
    this.visibleCloudThreshold.value =
      this.mode === 'dome' ? this.clouds.atmCloudThreshold.value : 2;
  }

  private removeCloudMesh(): void {
    if (this.cloudMesh === undefined) return;
    this.scene.remove(this.cloudMesh);
    this.cloudMesh.geometry.dispose();
    (this.cloudMesh.material as THREE.Material).dispose();
    this.cloudMesh = undefined;
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

  /** The auto-exposure's adaptation α (`autoExposure`); default 0.75. */
  get autoExposureAdaptation(): number {
    return this.adaptation;
  }

  /**
   * The auto-exposure's adaptation α in [0, 1] (0 a fixed exposure, 1 full
   * adaptation). Recomputes the exposure at the current illuminance. No GPU
   * work (OsmDemo's light dialog drags it). Validated before any change.
   *
   * @throws RangeError for a value outside [0, 1].
   */
  setAutoExposureAdaptation(adaptation: number): void {
    autoExposure(1, adaptation); // validates, throwing before any change
    this.adaptation = adaptation;
    this.autoExposureValue = autoExposure(this.illuminance, adaptation);
    this.updateScale();
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
    // At the noise's period, not at one tile: the hex-tiled octave repeats
    // only there, and a wrap anywhere else is a jump.
    const period = CLOUD_NOISE_PERIOD_TILES;
    offset.set((offset.x + step) % period, (offset.y + 0.35 * step) % period);
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

  /** Rebuild now, or (staged) record the pass for `stepRebuild()`. */
  private rebuild(medium: boolean): void {
    if (this.staged) {
      this.pendingPass = {
        medium: (this.pendingPass?.medium ?? false) || medium,
      };
      return;
    }
    this.renderLuts(medium);
    this.measure(this.device.readSkyView());
    this.updateScale();
    this.rebake();
  }

  private renderLuts(medium: boolean): void {
    if (medium) {
      this.device.render('transmittance', this.uniforms);
      this.device.render('multiScattering', this.uniforms);
    }
    this.device.render('skyView', this.uniforms);
  }

  /** Bake the environment from the current sky; generate, then dispose the old. */
  private rebake(): void {
    // Generate BEFORE disposing, so a throw leaves the previous environment in
    // place rather than none (the rule OsmDemo's first sky rig established).
    // Staged, into the device's one reused target where it has one.
    const reused = this.staged
      ? this.device.bakeEnvironmentReused?.(this.bakeScene)
      : undefined;
    const next = reused ?? this.device.bakeEnvironment(this.bakeScene);
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
      const r = EARTH_ATMOSPHERE.groundRadiusKm + this.observerKm;
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
    this.illuminance = illuminance;
    this.autoExposureValue = autoExposure(illuminance, this.adaptation);
  }

  /** Release every GPU resource and clear what this set on the scene. */
  dispose(): void {
    this.unsubscribeRestore();
    this.abandonPass();
    this.scene.remove(this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.bakeMaterial.dispose();
    this.removeCloudMesh();
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
