/**
 * Cloud shadows on three.js's own lit materials (round-3 plan 2026-09-27-0532,
 * stream D; DEC-FB3-7): the direct light of every directional light is
 * dimmed by the cloud column its ray crosses on the way to the fragment
 * (`cloud-column.ts`), one noise read per light and pixel, no shadow map.
 * The shadows move with the clouds' drift and fall where the sky draws the
 * clouds (the sheet and the slab exactly; the camera-centred dome within
 * the camera's offset from the origin).
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
uniform float atmShadowCloudAnchored;
uniform vec2 atmShadowCloudFarFadeM;
${CLOUD_COLUMN_GLSL}
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
  if (atmShadowCloudOn > 0.5 && atmShadowCloudThreshold < 2.0 && dot(light.color, light.color) > 0.0) {
    // View space to world: the view matrix's rotation, transposed.
    vec3 toLight = (vec4(light.direction, 0.0) * viewMatrix).xyz;
    if (toLight.y > 0.0) {
      vec3 world = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
      float noise = atmShadowCloudNoise(atmColumnUv(world, toLight, atmShadowCloudOffset));
      // Only as much cloud as the sky draws there (the disc's own weight).
      vec3 fromCamera = world + toLight * atmColumnDistance(world.y, toLight.y) - cameraPosition;
      float drawn = atmColumnDrawn(length(fromCamera), length(fromCamera.xz), toLight.y,
        atmShadowCloudAnchored, atmShadowCloudFarFadeM);
      light.color *= exp(-atmColumnOpticalDepth(noise, atmShadowCloudThreshold, world.y, toLight.y) * drawn);
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
  atmShadowCloudAnchored: THREE.IUniform<number>;
  atmShadowCloudFarFadeM: THREE.IUniform<THREE.Vector2>;
}

/** What the patch reads from an atmosphere (`SkyAtmosphere` satisfies it). */
export interface CloudShadowSource {
  readonly cloudUniforms: {
    readonly atmCloudTexture: THREE.IUniform<THREE.Texture>;
    readonly atmCloudThreshold: THREE.IUniform<number>;
    readonly atmCloudOffset: THREE.IUniform<THREE.Vector2>;
    /** 1 while the clouds are world-anchored (the sheet, the slab), 0 on the dome. */
    readonly atmCloudAnchored: THREE.IUniform<number>;
    /** The sheet's and the slab's far fade, start and end (m). */
    readonly atmCloudFarFadeM: THREE.IUniform<THREE.Vector2>;
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
    // The dome until a sync says otherwise; the far fade is the sky's.
    atmShadowCloudAnchored: { value: 0 },
    atmShadowCloudFarFadeM: { value: new THREE.Vector2(14_000, 21_000) },
  };

  /**
   * Take the atmosphere's clouds: its noise texture and drift offset (the
   * objects themselves, so the shadows drift with the sky), and its cover's
   * threshold (a copy: call again after a cover change).
   */
  sync(source: CloudShadowSource): void {
    const clouds = source.cloudUniforms;
    this.uniforms.atmShadowCloudTexture.value = clouds.atmCloudTexture.value;
    this.uniforms.atmShadowCloudOffset.value = clouds.atmCloudOffset.value;
    this.uniforms.atmShadowCloudFarFadeM.value = clouds.atmCloudFarFadeM.value;
    this.uniforms.atmShadowCloudAnchored.value = clouds.atmCloudAnchored.value;
    this.uniforms.atmShadowCloudThreshold.value =
      clouds.atmCloudThreshold.value;
  }

  /** The shadows on or off (a uniform: no recompile). */
  setEnabled(on: boolean): void {
    this.uniforms.atmShadowCloudOn.value = on ? 1 : 0;
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
    material.onBeforeCompile = function (shader, renderer) {
      previousHook(shader, renderer);
      if (shader.fragmentShader.includes(MARKER)) return;
      for (const anchor of [LIT, MAIN]) {
        if (!shader.fragmentShader.includes(anchor)) {
          throw new CloudShadowAnchorError(anchor);
        }
      }
      shader.fragmentShader = shader.fragmentShader.replace(MAIN, FRAGMENT);
      Object.assign(shader.uniforms, uniforms);
    };
    material.customProgramCacheKey = () => `${previousKey()}|cloud-shadow`;
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
