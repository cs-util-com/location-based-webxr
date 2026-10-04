/**
 * Sky-matched aerial perspective for three.js's own materials (plan
 * 2026-09-23-0048, DEC-SKY-5): distant geometry fades toward the sky's colour
 * IN ITS OWN VIEW DIRECTION (warm toward the sun, blue away from it), with the
 * air's per-channel extinction, replacing the one-colour fog.
 *
 * HOW. An `onBeforeCompile` patch of three's fog chunks, applied per material:
 *
 * - vertex: a view-space position varying next to three's `vFogDepth`;
 * - fragment: the haze runs BEFORE `<tonemapping_fragment>`, in scene-linear
 *   light. (three applies its own fog AFTER tone mapping and the output
 *   colour-space conversion, i.e. in display space; aerial perspective is a
 *   physical mix and belongs in linear light.)
 *
 * The fade is `keep = T(d) · (1 − boundary)`, where `T = exp(−σ·d)` is the
 * physical transmittance and `boundary` is three's linear-fog ramp from
 * `fog.near` to `fog.far`. So `scene.fog` stays a `THREE.Fog` and keeps
 * carrying near/far: the fade still COMPLETES at the far plane (OsmDemo's
 * `setFarPlane` invariant), onto the same sky that is drawn behind the clip.
 *
 * THE THREE SILENT FAILURES THIS FILE GUARDS (plan review findings 1 and 2):
 *
 * - **Missing anchors throw `HazeAnchorError`** at compile time rather than
 *   leaving a haze-less material.
 * - **The program cache key keeps the previous patch's identity.** three's
 *   default key is `onBeforeCompile.toString()`; wrapping every material in
 *   the same haze function would otherwise make materials with DIFFERENT
 *   inner patches share one program.
 * - **Modes, for AR.** OsmDemo's AR reparents the same material instances into
 *   a second WebGL context, where the desktop sky's LUT render target does not
 *   exist. `setMode('fog')` selects three's stock fog and binds a neutral 1×1
 *   texture in the LUT's place; `'atmosphere'` restores it.
 *
 * Apply the haze LAST: a later plain assignment of `onBeforeCompile` replaces
 * it (it cannot be prevented from here).
 *
 * @see atmosphere-haze.ts.md
 */

import * as THREE from 'three';

import { ATMOSPHERE_COMMON_GLSL } from './atmosphere-glsl.js';
import type { AtmosphereUniforms } from './atmosphere-luts.js';
import {
  EARTH_ATMOSPHERE,
  mediumAt,
  mieExtinctionForVisibility,
  type Rgb,
} from './atmosphere-model.js';
import { smoothstep } from '../../utils/smoothstep.js';

/** Thrown when three's shader no longer contains a chunk the patch hooks. */
export class HazeAnchorError extends Error {
  constructor(anchor: string) {
    super(
      `atmosphere haze: three's shader has no "${anchor}" (renamed by a three upgrade?)`
    );
    this.name = 'HazeAnchorError';
  }
}

/** The medium's extinction at the observer, per METRE (scene units). */
export function hazeExtinctionPerMetre(
  visibilityKm: number,
  observerAltitudeKm: number
): Rgb {
  const e = mediumAt(
    observerAltitudeKm,
    mieExtinctionForVisibility(visibilityKm)
  ).extinction;
  return [e[0] / 1000, e[1] / 1000, e[2] / 1000];
}

/** exp(−σ·d) per channel: the GLSL's physical term. */
export function hazeTransmittance(distanceM: number, extinctionPerM: Rgb): Rgb {
  return [
    Math.exp(-extinctionPerM[0] * distanceM),
    Math.exp(-extinctionPerM[1] * distanceM),
    Math.exp(-extinctionPerM[2] * distanceM),
  ];
}

/**
 * three's linear-fog ramp (GLSL `smoothstep(near, far, depth)`), which the
 * haze keeps as its boundary fade: 0 at `near`, exactly 1 at and beyond `far`.
 */
export function hazeBoundaryFade(
  depth: number,
  near: number,
  far: number
): number {
  if (!(far > near)) return depth >= far ? 1 : 0;
  return smoothstep(near, far, depth);
}

const VERTEX_PARS = /* glsl */ `#include <fog_pars_vertex>
#ifdef USE_FOG
varying vec3 vAtmViewPosition;
#endif`;

const VERTEX = /* glsl */ `#include <fog_vertex>
#ifdef USE_FOG
vAtmViewPosition = mvPosition.xyz;
#endif`;

const FRAGMENT_PARS = /* glsl */ `#include <fog_pars_fragment>
#ifdef USE_FOG
varying vec3 vAtmViewPosition;
uniform float atmHazeMode;
uniform vec3 atmHazeExtinction;
uniform sampler2D atmHazeSkyView;
uniform vec3 atmSunDirection;
uniform float atmObserverRadius;
uniform float atmRadianceToScene;
${ATMOSPHERE_COMMON_GLSL}
#endif`;

const FRAGMENT_HAZE = /* glsl */ `#ifdef USE_FOG
if (atmHazeMode > 0.5) {
  // View direction in WORLD space: view-space position times the (rotation
  // part of the) view matrix transposed.
  vec3 atmViewDir = normalize((vec4(vAtmViewPosition, 0.0) * viewMatrix).xyz);
  // The in-scatter colour is the sky in this direction, clamped just above
  // the horizon: below it the sky-view LUT holds the GROUND.
  vec3 atmDir = atmHorizonClampedDir(atmViewDir);
  vec3 atmHazeSky = texture2D(atmHazeSkyView, atmSkyViewUv(atmObserverRadius, atmDir, atmSunDirection)).rgb
    * atmRadianceToScene;
  #ifdef FOG_EXP2
    float atmBoundary = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float atmBoundary = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 atmHazeKeep = exp(-atmHazeExtinction * length(vAtmViewPosition)) * (1.0 - atmBoundary);
  gl_FragColor.rgb = gl_FragColor.rgb * atmHazeKeep + atmHazeSky * (1.0 - atmHazeKeep);
}
#endif
#include <tonemapping_fragment>`;

const FRAGMENT_FOG = /* glsl */ `#ifdef USE_FOG
if (atmHazeMode < 0.5) {
#include <fog_fragment>
}
#endif`;

function replaceAnchor(
  source: string,
  anchor: string,
  replacement: string
): string {
  if (!source.includes(anchor)) throw new HazeAnchorError(anchor);
  return source.replace(anchor, replacement);
}

/**
 * The haze's uniforms. OWNED by the haze, never borrowed from an atmosphere:
 * patched materials capture these objects for good, so an atmosphere that is
 * disposed and rebuilt (the look-dev page's baseline switch, an app rebuilding
 * its sky) only needs a `sync`, never a re-patch.
 */
export interface HazeUniforms {
  [name: string]: THREE.IUniform;
  atmHazeMode: THREE.IUniform<number>;
  atmHazeExtinction: THREE.IUniform<THREE.Vector3>;
  atmHazeSkyView: THREE.IUniform<THREE.Texture>;
  atmMieExtinction: THREE.IUniform<number>;
  atmSunDirection: THREE.IUniform<THREE.Vector3>;
  atmObserverRadius: THREE.IUniform<number>;
  atmRadianceToScene: THREE.IUniform<number>;
}

/** What the haze reads from an atmosphere (`SkyAtmosphere` satisfies it). */
export interface HazeSource {
  readonly sharedUniforms: AtmosphereUniforms;
  readonly visibilityKm: number;
}

export interface AtmosphereHazeOptions {
  readonly visibilityKm: number;
  readonly observerAltitudeKm?: number;
  /** Multiplier on the physical extinction; 1 = physical. */
  readonly densityScale?: number;
}

/**
 * Which haze owns each patched material, and the hook and key it installed.
 * A material belongs to ONE haze: its compiled program captured that haze's
 * uniform objects, so a second haze must not silently skip it (M2 review,
 * finding 7). The installed hook and key are what let a re-apply notice
 * that someone ASSIGNED a new `onBeforeCompile` after the haze (M3).
 */
interface Patch {
  readonly haze: AtmosphereHaze;
  readonly hook: THREE.Material['onBeforeCompile'];
  readonly key: () => string;
}
const OWNER = new WeakMap<THREE.Material, Patch>();

/** A line the fragment patch always adds: its presence means "already hazed". */
const HAZE_MARKER = 'uniform float atmHazeMode;';

const ATMOSPHERE_THICKNESS_KM =
  EARTH_ATMOSPHERE.topRadiusKm - EARTH_ATMOSPHERE.groundRadiusKm;

function validAltitude(km: number): number {
  if (!(Number.isFinite(km) && km >= 0 && km < ATMOSPHERE_THICKNESS_KM)) {
    throw new RangeError(
      `observer altitude must be in [0, ${ATMOSPHERE_THICKNESS_KM}) km, got ${km}`
    );
  }
  return km;
}

export class AtmosphereHaze {
  /** Shared objects: every patched material reads these. */
  readonly uniforms: HazeUniforms;
  private readonly neutral: THREE.DataTexture;
  private visibility: number;
  private observerAltitudeKm: number;
  private densityScale: number;
  private requested: 'atmosphere' | 'fog' = 'atmosphere';
  private skyView: THREE.Texture | undefined;

  constructor(options: AtmosphereHazeOptions) {
    mieExtinctionForVisibility(options.visibilityKm);
    this.visibility = options.visibilityKm;
    this.observerAltitudeKm = validAltitude(
      options.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm
    );
    this.densityScale = options.densityScale ?? 1;
    this.neutral = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.neutral.needsUpdate = true;
    this.uniforms = {
      atmHazeMode: { value: 0 },
      atmHazeExtinction: { value: new THREE.Vector3() },
      atmHazeSkyView: { value: this.neutral },
      atmMieExtinction: { value: mieExtinctionForVisibility(this.visibility) },
      atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      atmObserverRadius: {
        value: EARTH_ATMOSPHERE.groundRadiusKm + this.observerAltitudeKm,
      },
      atmRadianceToScene: { value: 0 },
    };
    this.updateExtinction();
  }

  /**
   * Copy the current atmosphere's state into the haze. Call after the
   * atmosphere changes (sun, visibility, exposure) or is replaced.
   */
  sync(source: HazeSource): void {
    const shared = source.sharedUniforms;
    this.uniforms.atmMieExtinction.value = shared.atmMieExtinction.value;
    this.uniforms.atmSunDirection.value.copy(shared.atmSunDirection.value);
    this.uniforms.atmObserverRadius.value = shared.atmObserverRadius.value;
    this.uniforms.atmRadianceToScene.value = shared.atmRadianceToScene.value;
    this.skyView = shared.atmSkyViewLut.value;
    // The observer's altitude comes from the atmosphere, like everything
    // else: the Mie term is ~3× thicker at 0.2 km than at 1.5 km.
    const altitude = validAltitude(
      shared.atmObserverRadius.value - EARTH_ATMOSPHERE.groundRadiusKm
    );
    mieExtinctionForVisibility(source.visibilityKm);
    if (
      source.visibilityKm !== this.visibility ||
      altitude !== this.observerAltitudeKm
    ) {
      this.visibility = source.visibilityKm;
      this.observerAltitudeKm = altitude;
      this.updateExtinction();
    }
    this.applyMode();
  }

  /**
   * `'atmosphere'` = sky-matched haze; `'fog'` = three's stock fog (AR, or no
   * atmosphere yet). Atmosphere mode takes effect only once a sync has
   * supplied a sky-view LUT; until then the haze stays on the stock fog.
   */
  setMode(mode: 'atmosphere' | 'fog'): void {
    this.requested = mode;
    this.applyMode();
  }

  /** The requested mode (in effect once a sync has supplied a LUT). */
  get mode(): 'atmosphere' | 'fog' {
    return this.requested;
  }

  private applyMode(): void {
    const atmosphere =
      this.requested === 'atmosphere' && this.skyView !== undefined;
    this.uniforms.atmHazeMode.value = atmosphere ? 1 : 0;
    this.uniforms.atmHazeSkyView.value = atmosphere
      ? this.skyView!
      : this.neutral;
  }

  /** Scale the physical extinction (a demo's taste knob). */
  setDensityScale(scale: number): void {
    if (!(Number.isFinite(scale) && scale >= 0)) {
      throw new RangeError(
        `haze density scale must be a finite number ≥ 0, got ${scale}`
      );
    }
    this.densityScale = scale;
    this.updateExtinction();
  }

  private updateExtinction(): void {
    const e = hazeExtinctionPerMetre(this.visibility, this.observerAltitudeKm);
    this.uniforms.atmHazeExtinction.value
      .set(e[0], e[1], e[2])
      .multiplyScalar(this.densityScale);
  }

  /**
   * Patch one material; chains an existing onBeforeCompile. Idempotent while
   * the patch is intact. SELF-HEALING: if `onBeforeCompile` was assigned
   * after the haze (which drops it), a re-apply patches again, chaining the
   * new hook, with a cache key that names it. Re-apply before rendering
   * wherever installers assign hooks late.
   */
  apply(material: THREE.Material): void {
    const patch = OWNER.get(material);
    if (patch !== undefined && patch.haze !== this) {
      throw new Error(
        `material "${material.name || material.type}" is already patched by another AtmosphereHaze; a material belongs to one haze`
      );
    }
    if (patch !== undefined && material.onBeforeCompile === patch.hook) return;
    const previousHook = material.onBeforeCompile.bind(material);
    // A custom key is an OWN property (three's default lives on the
    // prototype and returns onBeforeCompile's source, which after this patch
    // would be the haze wrapper's for every material). Capture the identity
    // of what was there BEFORE the patch. On a heal, the haze's own key is
    // still installed and describes the OLD hook, so it is not a prefix.
    const ownKey =
      Object.hasOwn(material, 'customProgramCacheKey') &&
      material.customProgramCacheKey !== patch?.key;
    const previousKey: () => string = ownKey
      ? material.customProgramCacheKey.bind(material)
      : (() => {
          const source = material.onBeforeCompile.toString();
          return () => source;
        })();
    const uniforms = this.uniforms;
    const hook: THREE.Material['onBeforeCompile'] = function (
      shader,
      renderer
    ) {
      previousHook(shader, renderer);
      // A CHAINING installer that ran after the haze already called the
      // haze's earlier hook; patching again would declare its varyings and
      // uniforms twice, a compile error three only logs (M3 review,
      // finding 2). The uniforms it attached are this haze's own objects.
      if (shader.fragmentShader.includes(HAZE_MARKER)) return;
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <fog_pars_vertex>',
        VERTEX_PARS
      );
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <fog_vertex>',
        VERTEX
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <fog_pars_fragment>',
        FRAGMENT_PARS
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <tonemapping_fragment>',
        FRAGMENT_HAZE
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <fog_fragment>',
        FRAGMENT_FOG
      );
      Object.assign(shader.uniforms, uniforms);
    };
    const key = () => `${previousKey()}|atmosphere-haze`;
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    OWNER.set(material, { haze: this, hook, key });
    material.needsUpdate = true;
  }

  /** True when `material` carries this haze's patch, unreplaced. */
  private holds(material: THREE.Material): boolean {
    const patch = OWNER.get(material);
    return patch?.haze === this && material.onBeforeCompile === patch.hook;
  }

  /**
   * Patch every fog-capable material under `root` (materials with
   * `fog: false`, and ShaderMaterials, are left alone). Returns how many
   * materials were newly patched or healed.
   */
  applyToObject(root: THREE.Object3D): number {
    let patched = 0;
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material === undefined) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        const fogCapable =
          (m as THREE.Material & { fog?: boolean }).fog === true;
        // toneMapped:false materials hold display-referred values; fading
        // them toward a scene-linear sky would overshoot (review finding 12).
        const eligible =
          fogCapable && m.toneMapped && !(m instanceof THREE.ShaderMaterial);
        if (!eligible || this.holds(m)) continue;
        this.apply(m);
        patched += 1;
      }
    });
    return patched;
  }

  /** Release the neutral texture. Patched materials keep their patch. */
  dispose(): void {
    this.neutral.dispose();
  }
}
