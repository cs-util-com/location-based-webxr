/**
 * Cloud shadows on three.js's own lit materials (round-3 plan 2026-09-27-0532,
 * stream D; DEC-FB3-7): the direct light of every directional light is
 * dimmed by the cloud column its ray crosses on the way to the fragment
 * (`cloud-column.ts`), one noise read per light and pixel, no shadow map.
 * The shadows move with the clouds' drift and are the same from every
 * viewpoint: a ground point's shadow is its column toward the light, with
 * no weight for how much of that cloud the camera's sky draws (owner bug
 * report 2026-09-28: a view-weighted shadow vanished with a low sun and
 * came back when the camera moved toward the sun).
 *
 * HOW. An `onBeforeCompile` patch, chained like the haze's
 * (`atmosphere-haze.ts`): just before the fragment's `void main() {` (after
 * every declaration: three's Lambert, Phong and Toon declare
 * `vViewPosition` after `lights_pars_begin`) it defines a wrapper of
 * `getDirectionalLightInfo` that multiplies the light's colour by the
 * column's transmittance toward it, and `#define`s the old name to the
 * wrapper, so three's light loop (in any rewrite of `lights_fragment_begin`,
 * such as the look-dev page's ring shadow) calls it unchanged. No chunk
 * text is copied; the anchors are `#include <lights_pars_begin>` (the sign
 * of a lit program) and `void main() {`.
 *
 * - Every directional light, along ITS OWN direction: no assumption about
 *   which light is the sun or how three orders them. A light of colour 0
 *   (the page's ring-shadow carrier) reads no noise.
 * - The world position comes from three's `vViewPosition` and the camera,
 *   so no varying is added.
 * - Owned uniforms, synced from an atmosphere (`sync`), like the haze, so a
 *   rebuilt atmosphere needs no re-patch. The drift offset and the texture
 *   are the atmosphere's objects, so the shadows drift with no per-frame
 *   call; the threshold (cover) is copied at each sync.
 *
 * Apply it BEFORE the haze (which is applied last, by its own contract);
 * either order compiles, as each patch detects its own text.
 *
 * @see cloud-shadow.ts.md
 */

import * as THREE from 'three';

import { CLOUD_LAYER } from './cloud-layer.js';
import {
  writeCloudDiscCentre,
  type CloudDiscCentre,
  CLOUD_COVERAGE_GLSL,
  type CloudCoverage,
  cloudCoverThresholds,
  cloudCoverageUniforms,
  withCloudCoverage,
} from './cloud-coverage.js';
import { CLOUD_COLUMN_GLSL } from './cloud-column.js';
import { glslFloat } from '../../utils/glsl-float.js';

/** Thrown when three's shader no longer contains the chunk the patch hooks. */
export class CloudShadowAnchorError extends Error {
  constructor(anchor: string) {
    super(
      `cloud shadow: three's shader has no "${anchor}" (renamed by a three upgrade?)`
    );
    this.name = 'CloudShadowAnchorError';
  }
}

/** A lit program has three's light declarations. */
const LIT = '#include <lights_pars_begin>';
/** The patch goes just before the fragment's main, after every declaration. */
const MAIN = 'void main() {';
/** A line the patch always adds: its presence means "already patched". */
const MARKER = 'uniform float atmShadowCloudOn;';

/**
 * The patch's fragment text, before the fragment's main. Only with
 * directional lights: the struct it wraps exists only then.
 */
const FRAGMENT = /* glsl */ `#if NUM_DIR_LIGHTS > 0
${MARKER}
uniform sampler2D atmShadowCloudTexture;
uniform float atmShadowCloudThreshold;
uniform vec2 atmShadowCloudOffset;
// The layer lifted by this (m: the volume's height, C3), and the global
// cover times the map's (C3; 1 without a map).
uniform float atmShadowLiftM;
uniform float atmShadowCover;
${CLOUD_COLUMN_GLSL}
${CLOUD_COVERAGE_GLSL}
const float ATM_SHADOW_OCTAVE2_FREQ = ${glslFloat(CLOUD_LAYER.secondOctaveFrequency)};
const float ATM_SHADOW_OCTAVE2_OFFSET = ${glslFloat(CLOUD_LAYER.secondOctaveOffset)};
const float ATM_SHADOW_OCTAVE1_WEIGHT = ${glslFloat(CLOUD_LAYER.firstOctaveWeight)};

// The sky's two-octave noise (atmCloudNoise), from this patch's own uniforms.
float atmShadowCloudNoise(vec2 uv) {
  return texture2D(atmShadowCloudTexture, uv).r * ATM_SHADOW_OCTAVE1_WEIGHT
    + texture2D(atmShadowCloudTexture, uv * ATM_SHADOW_OCTAVE2_FREQ + ATM_SHADOW_OCTAVE2_OFFSET).r
      * (1.0 - ATM_SHADOW_OCTAVE1_WEIGHT);
}

// three's getDirectionalLightInfo, then the cloud column toward the light.
// Every branch is uniform per light (uniforms and the light's own values),
// so the implicit-level reads are defined.
void atmShadowCloudLightInfo(const in DirectionalLight directionalLight, out IncidentLight light) {
  getDirectionalLightInfo(directionalLight, light);
#if defined(ATM_CLOUD_COVERAGE) || defined(ATM_CLOUD_DISC)
  bool atmShadowAny = true;
#else
  bool atmShadowAny = atmShadowCloudThreshold < 2.0;
#endif
  if (atmShadowCloudOn > 0.5 && atmShadowAny && dot(light.color, light.color) > 0.0) {
    // View space to world: the view matrix's rotation, transposed.
    vec3 toLight = (vec4(light.direction, 0.0) * viewMatrix).xyz;
    if (toLight.y > 0.0) {
      vec3 world = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
      // The point lowered by the lift, so the layer sits lifted above it.
      vec3 lifted = vec3(world.x, world.y - atmShadowLiftM, world.z);
      // The threshold where the light's line crosses the layer's middle:
      // the map's and the disc's (cloud-coverage.ts), else the sky's.
      vec2 crossing = lifted.xz + toLight.xz * atmColumnDistance(lifted.y, toLight.y);
      float threshold = atmCloudThresholdAt(crossing, atmShadowCloudThreshold, atmShadowCover);
      if (threshold < 2.0) {
        float noise = atmShadowCloudNoise(atmColumnUv(lifted, toLight, atmShadowCloudOffset));
        light.color *= exp(-atmColumnOpticalDepth(noise, threshold, lifted.y, toLight.y));
      }
    }
  }
}
#define getDirectionalLightInfo atmShadowCloudLightInfo
#endif
${MAIN}`;

/** The patch's uniforms: shared objects, read by every patched material. */
export interface CloudShadowUniforms {
  [name: string]: THREE.IUniform;
  atmShadowCloudOn: THREE.IUniform<number>;
  atmShadowCloudTexture: THREE.IUniform<THREE.Texture | null>;
  atmShadowCloudThreshold: THREE.IUniform<number>;
  atmShadowCloudOffset: THREE.IUniform<THREE.Vector2>;
}

/** What the patch reads from an atmosphere (`SkyAtmosphere` satisfies it). */
export interface CloudShadowSource {
  readonly cloudUniforms: {
    readonly atmCloudTexture: THREE.IUniform<THREE.Texture>;
    readonly atmCloudThreshold: THREE.IUniform<number>;
    readonly atmCloudOffset: THREE.IUniform<THREE.Vector2>;
  };
}

/** Which CloudShadow owns each patched material (one owner per material). */
const OWNER = new WeakMap<THREE.Material, CloudShadow>();

/** The lit families: the ones whose fragment has three's light loop. */
function isLit(material: THREE.Material): boolean {
  const m = material as THREE.Material & Record<string, unknown>;
  return (
    m.isMeshStandardMaterial === true ||
    m.isMeshLambertMaterial === true ||
    m.isMeshPhongMaterial === true ||
    m.isMeshToonMaterial === true
  );
}

export class CloudShadow {
  /** Shared objects: every patched material reads these. */
  readonly uniforms: CloudShadowUniforms = {
    atmShadowCloudOn: { value: 1 },
    atmShadowCloudTexture: { value: null },
    // 2 is above any noise: no cloud until a sync supplies the cover.
    atmShadowCloudThreshold: { value: 2 },
    atmShadowCloudOffset: { value: new THREE.Vector2() },
    atmShadowLiftM: { value: 0 },
    atmShadowCover: { value: 1 },
    ...cloudCoverageUniforms(),
  };
  /** The map and the disc (`configureMap`), fixed before the first patch. */
  private coverage: CloudCoverage | null = null;
  private disc = false;
  private patched = 0;

  /**
   * Take the atmosphere's clouds: its noise texture and drift offset (the
   * objects themselves, so the shadows drift with the sky), and its cover's
   * threshold (a copy: call again after a cover change).
   */
  sync(source: CloudShadowSource): void {
    const clouds = source.cloudUniforms;
    this.uniforms.atmShadowCloudTexture.value = clouds.atmCloudTexture.value;
    this.uniforms.atmShadowCloudOffset.value = clouds.atmCloudOffset.value;
    this.uniforms.atmShadowCloudThreshold.value =
      clouds.atmCloudThreshold.value;
  }

  /** The shadows on or off (a uniform: no recompile). */
  setEnabled(on: boolean): void {
    this.uniforms.atmShadowCloudOn.value = on ? 1 : 0;
  }

  /**
   * A coverage map and a disc for the shadows (globe volume-cloud plan
   * 2026-10-05-0016, C3): the shadow falls from the clouds the map gives
   * (the caller's chunk defining `atmCloudCoverageAt`,
   * `cloud-coverage.ts`), faded to clear at the disc around the camera, the
   * same rule the cloud slab draws by. Both change the shader text, so they
   * are fixed before the first patched material.
   *
   * @throws RangeError for a chunk without atmCloudCoverageAt, Error after
   *   the first patched material.
   */
  configureMap(options: {
    coverage?: CloudCoverage | null;
    disc?: boolean;
  }): void {
    if (this.patched > 0) {
      throw new Error(
        'cloud shadow: the map and the disc are fixed once a material is patched'
      );
    }
    const coverage = options.coverage ?? null;
    if (coverage !== null) {
      withCloudCoverage(FRAGMENT, coverage.glsl); // validates
      Object.assign(this.uniforms, coverage.uniforms);
      this.uniforms['atmCoverThresholds']!.value = [...cloudCoverThresholds()];
    }
    this.coverage = coverage;
    this.disc = options.disc ?? false;
  }

  /**
   * The layer's lift (m): the shadow's clouds sit this much above the
   * column's own height (the volume drawn at the shell's height). A uniform.
   *
   * @throws RangeError for a non-finite lift.
   */
  setLiftM(liftM: number): void {
    if (!Number.isFinite(liftM)) {
      throw new RangeError(`the lift must be finite, got ${liftM}`);
    }
    this.uniforms['atmShadowLiftM']!.value = liftM;
  }

  /**
   * The disc's radius (m) with `configureMap({ disc: true })`. A uniform.
   *
   * @throws RangeError for a radius that is not positive and finite.
   */
  setDiscRadiusM(radiusM: number): void {
    if (!(radiusM > 0 && Number.isFinite(radiusM))) {
      throw new RangeError(`the disc radius must be positive, got ${radiusM}`);
    }
    this.uniforms['atmCoverDiscM']!.value = radiusM;
  }

  /**
   * The disc's centre with `configureMap({ disc: true })` (volume-cloud plan
   * §15): a world point (x, z), or the camera (null, the default). A
   * uniform.
   *
   * @throws RangeError for a centre that is not finite.
   */
  setDiscCentre(centre: CloudDiscCentre | null): void {
    writeCloudDiscCentre(
      this.uniforms['atmCoverDiscCentre'] as THREE.IUniform<THREE.Vector3>,
      centre
    );
  }

  /**
   * The global cover the map's is multiplied by (1 by default). A uniform.
   *
   * @throws RangeError for a cover that is negative or not finite.
   */
  setCover(cover: number): void {
    if (!(cover >= 0 && Number.isFinite(cover))) {
      throw new RangeError(`the cover must be >= 0, got ${cover}`);
    }
    this.uniforms['atmShadowCover']!.value = cover;
  }

  /**
   * The patch's fragment text for this shadow's map and disc (their defines
   * and the caller's chunk), and the program key's suffix that names them.
   */
  private patchText(): { fragment: string; suffix: string } {
    const map = this.coverage !== null;
    const defines =
      (map ? '#define ATM_CLOUD_COVERAGE\n' : '') +
      (this.disc ? '#define ATM_CLOUD_DISC\n' : '');
    const body =
      this.coverage === null
        ? FRAGMENT
        : withCloudCoverage(FRAGMENT, this.coverage.glsl);
    return {
      fragment: defines + body,
      suffix: (map ? '-map' : '') + (this.disc ? '-disc' : ''),
    };
  }

  /** True while the shadows are on. */
  get enabled(): boolean {
    return this.uniforms.atmShadowCloudOn.value > 0.5;
  }

  /**
   * Patch one lit material; chains its existing onBeforeCompile and names
   * the patch in the program cache key. Idempotent: ownership is kept in a
   * WeakMap, not by comparing hooks (a later chaining patch, the haze, wraps
   * this one; lessons-learned 2026-09-26).
   *
   * @throws TypeError for a material without three's light loop, Error for
   *   a material another CloudShadow owns.
   */
  apply(material: THREE.Material): void {
    const owner = OWNER.get(material);
    if (owner === this) return;
    if (owner !== undefined) {
      throw new Error(
        `material "${material.name || material.type}" already has another CloudShadow; a material belongs to one`
      );
    }
    if (!isLit(material)) {
      throw new TypeError(
        `cloud shadow: "${material.name || material.type}" has no light loop (a Lambert, Phong, Standard, Physical or Toon material is needed)`
      );
    }
    const previousHook = material.onBeforeCompile.bind(material);
    // An own key describes what was there; three's default (on the
    // prototype) returns the hook's source, which after this patch would be
    // this wrapper's for every material.
    const previousKey: () => string = Object.hasOwn(
      material,
      'customProgramCacheKey'
    )
      ? material.customProgramCacheKey.bind(material)
      : (() => {
          const source = material.onBeforeCompile.toString();
          return () => source;
        })();
    const uniforms = this.uniforms;
    const { fragment, suffix } = this.patchText();
    this.patched += 1;
    material.onBeforeCompile = function (shader, renderer) {
      previousHook(shader, renderer);
      if (shader.fragmentShader.includes(MARKER)) return;
      for (const anchor of [LIT, MAIN]) {
        if (!shader.fragmentShader.includes(anchor)) {
          throw new CloudShadowAnchorError(anchor);
        }
      }
      shader.fragmentShader = shader.fragmentShader.replace(MAIN, fragment);
      Object.assign(shader.uniforms, uniforms);
    };
    material.customProgramCacheKey = () =>
      `${previousKey()}|cloud-shadow${suffix}`;
    OWNER.set(material, this);
    material.needsUpdate = true;
  }

  /**
   * Patch every lit material under `root` not yet patched (others are left
   * alone). Returns how many were newly patched.
   */
  applyToObject(root: THREE.Object3D): number {
    let patched = 0;
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material === undefined) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (!isLit(m) || OWNER.get(m) === this) continue;
        this.apply(m);
        patched += 1;
      }
    });
    return patched;
  }
}
