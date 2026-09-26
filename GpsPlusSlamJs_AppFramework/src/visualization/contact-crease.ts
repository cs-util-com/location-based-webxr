/**
 * The contact crease (city shadows and contact crease plan 2026-09-26-0549,
 * M2): the ambient light at the foot of a wall is darkened, `1 - k·exp(-h/r)`
 * with h the metres above the ground, so buildings sit ON the ground instead
 * of floating on it. The sky that the wall and the ground hide from each
 * other is what goes missing there, so only INDIRECT light is darkened, after
 * three's own ambient occlusion; the sun is untouched (its shadows are the
 * shadow map's job). Mapbox GL's fake-AO defaults: k 0.3, r 3 m.
 *
 * HOW. An `onBeforeCompile` patch, per material, computed per FRAGMENT
 * (walls have vertices only at the base and the top): a world-height varying
 * in the vertex shader (instance and batching matrices included), the factor
 * after `<aomap_fragment>`. k, r and the ground height are uniforms, so a
 * slider never recompiles. The patch chains an earlier `onBeforeCompile` and
 * keeps its identity in the program cache key; apply it BEFORE the
 * atmosphere haze, which chains in turn and must stay last.
 *
 * @see contact-crease.ts.md
 */

import * as THREE from 'three';

/** Defaults (Mapbox GL's fake ambient occlusion). */
export const CONTACT_CREASE = {
  /** k: the share of ambient light removed at the very base. */
  strength: 0.3,
  /** r: the height over which the crease fades (to 1/e of its depth). */
  radiusM: 3,
} as const;

const MARKER = '// contact-crease';

function assertStrength(k: number): void {
  if (!(Number.isFinite(k) && k >= 0 && k <= 1)) {
    throw new RangeError(`crease strength must be in [0, 1], got ${k}`);
  }
}

function assertRadius(r: number): void {
  if (!(Number.isFinite(r) && r > 0)) {
    throw new RangeError(`crease radius must be positive, got ${r}`);
  }
}

/**
 * The factor on ambient light at `heightM` above the ground: `1 - k` at and
 * below the base, rising to 1. The shader's twin.
 *
 * @throws RangeError for k outside [0, 1], r ≤ 0 or a non-finite height.
 */
export function contactCreaseFactor(
  heightM: number,
  strength: number,
  radiusM: number
): number {
  assertStrength(strength);
  assertRadius(radiusM);
  if (Number.isNaN(heightM)) {
    throw new RangeError('crease height must be a number, got NaN');
  }
  return 1 - strength * Math.exp(-Math.max(heightM, 0) / radiusM);
}

const VERTEX_PARS = /* glsl */ `#include <common>
varying float vCreaseWorldY;`;

const VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 creasePos = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    creasePos = batchingMatrix * creasePos;
  #endif
  #ifdef USE_INSTANCING
    creasePos = instanceMatrix * creasePos;
  #endif
  vCreaseWorldY = ( modelMatrix * creasePos ).y;
}`;

const FRAGMENT_PARS = /* glsl */ `#include <common>
${MARKER}
varying float vCreaseWorldY;
uniform float creaseStrength;
uniform float creaseRadius;
uniform float creaseBase;`;

const FRAGMENT = /* glsl */ `#include <aomap_fragment>
{
  float creaseHeight = max( vCreaseWorldY - creaseBase, 0.0 );
  float crease = 1.0 - creaseStrength * exp( - creaseHeight / creaseRadius );
  reflectedLight.indirectDiffuse *= crease;
  reflectedLight.indirectSpecular *= crease;
}`;

function replaceAnchor(source: string, anchor: string, patch: string): string {
  if (!source.includes(anchor)) {
    throw new Error(
      `contact crease: three's shader has no "${anchor}" (renamed by a three upgrade?)`
    );
  }
  return source.replace(anchor, patch);
}

/** Which crease patched a material (a material carries at most one). */
const OWNER = new WeakMap<THREE.Material, ContactCrease>();

export interface ContactCreaseOptions {
  readonly strength?: number;
  readonly radiusM?: number;
  /** The ground's height in world metres (0 on the look-dev page). */
  readonly baseHeightM?: number;
}

export class ContactCrease {
  readonly uniforms: {
    readonly creaseStrength: THREE.IUniform<number>;
    readonly creaseRadius: THREE.IUniform<number>;
    readonly creaseBase: THREE.IUniform<number>;
  };

  /** @throws RangeError for a strength, radius or base out of range. */
  constructor(options: ContactCreaseOptions = {}) {
    const strength = options.strength ?? CONTACT_CREASE.strength;
    const radiusM = options.radiusM ?? CONTACT_CREASE.radiusM;
    const base = options.baseHeightM ?? 0;
    assertStrength(strength);
    assertRadius(radiusM);
    ContactCrease.assertBase(base);
    this.uniforms = {
      creaseStrength: { value: strength },
      creaseRadius: { value: radiusM },
      creaseBase: { value: base },
    };
  }

  private static assertBase(y: number): void {
    if (!Number.isFinite(y)) {
      throw new RangeError(`crease base height must be finite, got ${y}`);
    }
  }

  /** k in [0, 1]; 0 switches the crease off without a recompile. */
  setStrength(k: number): void {
    assertStrength(k);
    this.uniforms.creaseStrength.value = k;
  }

  setRadius(r: number): void {
    assertRadius(r);
    this.uniforms.creaseRadius.value = r;
  }

  setBaseHeight(y: number): void {
    ContactCrease.assertBase(y);
    this.uniforms.creaseBase.value = y;
  }

  /** Patch one material, chaining an earlier `onBeforeCompile`. Idempotent. */
  apply(material: THREE.Material): void {
    if (this.holds(material)) return;
    const previousHook = material.onBeforeCompile.bind(material);
    // A custom key is an OWN property; three's default (on the prototype)
    // returns onBeforeCompile's source, which after this patch would be the
    // same wrapper for every material. Capture what was there before.
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
    const hook: THREE.Material['onBeforeCompile'] = (shader, renderer) => {
      previousHook(shader, renderer);
      // A chaining installer that ran after us already called this hook;
      // a second patch would declare every name twice.
      if (shader.fragmentShader.includes(MARKER)) return;
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <common>',
        VERTEX_PARS
      );
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <project_vertex>',
        VERTEX
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <common>',
        FRAGMENT_PARS
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <aomap_fragment>',
        FRAGMENT
      );
      Object.assign(shader.uniforms, uniforms);
    };
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = () => `${previousKey()}|contact-crease`;
    OWNER.set(material, this);
    material.needsUpdate = true;
  }

  /**
   * True when this crease patched `material`, including when a later
   * installer (the haze) chained its own hook on top. A later PLAIN
   * assignment of `onBeforeCompile` drops the crease without this knowing;
   * install the crease before such code.
   */
  holds(material: THREE.Material): boolean {
    return OWNER.get(material) === this;
  }

  /**
   * Patch the materials of every MESH under `root` (sprites, lines and
   * points have no ambient light to crease, and a sprite's shader has no
   * `<aomap_fragment>`; ShaderMaterials are left alone). Returns how many
   * were newly patched.
   */
  applyToObject(root: THREE.Object3D): number {
    let patched = 0;
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      // instanceof narrows to Mesh<any, any>: name the material's type.
      const { material } = node as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (m instanceof THREE.ShaderMaterial || this.holds(m)) continue;
        this.apply(m);
        patched += 1;
      }
    });
    return patched;
  }
}
