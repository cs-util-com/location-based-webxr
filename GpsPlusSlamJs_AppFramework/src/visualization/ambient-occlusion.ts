/**
 * Screen-space ambient occlusion for the 3D apps: three's own `GTAOPass`,
 * computed after the frame is drawn and MULTIPLIED onto it in place, so a
 * frame with the AO switched off is the frame the app always drew.
 *
 * Composition rather than a subclass: it uses only the pass's public members
 * (`render` with `OUTPUT.Off`, `depthTexture`, `pdRenderTarget`,
 * `pdNoiseTexture`, `pdMaterial`) and does its own exclusion and restore
 * around the pass.
 *
 * @see ambient-occlusion.ts.md
 */

import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { smoothstep } from '../utils/smoothstep.js';

/** The AO parameters, in view-space metres where they are lengths. */
export interface AoParams {
  /** Sampling radius, metres. */
  readonly radius: number;
  readonly distanceExponent: number;
  /** Depth thickness a sample may sit behind and still occlude, metres. */
  readonly thickness: number;
  readonly distanceFallOff: number;
  /** The AO's strength inside the pass. */
  readonly scale: number;
  readonly samples: number;
  readonly screenSpaceRadius: boolean;
  /** How much of the AO reaches the frame, 0 (none) to 1 (all). */
  readonly intensity: number;
  /** View depth where the AO starts fading out, metres. */
  readonly fadeStartM: number;
  /** View depth from which the AO is gone, metres. */
  readonly fadeEndM: number;
}

/** The Poisson denoise parameters (`radius` in pixels). */
export interface AoDenoise {
  readonly radius: number;
  readonly lumaPhi: number;
  readonly depthPhi: number;
  readonly normalPhi: number;
  readonly samples: number;
  readonly rings: number;
  readonly radiusExponent: number;
}

/**
 * The AO at the scene's metre scale. A repo-config test holds every field
 * except the fade window equal to the design system's look-dev values; the
 * apps pass their own fade window.
 */
export const AO_PARAMS: Readonly<AoParams> = Object.freeze({
  radius: 5,
  distanceExponent: 1,
  thickness: 8,
  distanceFallOff: 1,
  scale: 1,
  samples: 16,
  screenSpaceRadius: false,
  intensity: 1,
  fadeStartM: 300,
  fadeEndM: 700,
});

export const AO_DENOISE: Readonly<AoDenoise> = Object.freeze({
  radius: 8,
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
  samples: 16,
  rings: 2,
  radiusExponent: 2,
});

/** The denoise noise's seed, so the AO looks the same on every load. */
export const AO_NOISE_SEED = 1;

/**
 * The exponent that carries the linear AO factor into the display-encoded
 * framebuffer the blend multiplies (a gamma-2.2 fit of the sRGB curve). The
 * frame is already tone-mapped and encoded when the AO is applied, so the
 * linear factor would darken too much; `1` stays `1` exactly.
 */
const AO_DISPLAY_EXPONENT = 1 / 2.2;

/**
 * A seeded generator in [0, 1) (mulberry32).
 *
 * @throws RangeError for a seed that is not an integer.
 */
export function aoNoiseRandom(seed: number): () => number {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`AO noise seed must be an integer, got ${seed}`);
  }
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The denoise noise three builds from `Math.random`, built from a seed:
 * four simplex channels over a 64 x 64 repeating RGBA8 texture.
 *
 * @throws RangeError for a seed that is not an integer.
 */
export function aoNoiseTexture(
  seed: number = AO_NOISE_SEED
): THREE.DataTexture {
  const simplex = new SimplexNoise({ random: aoNoiseRandom(seed) });
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const channel = (x: number, y: number): number =>
    (simplex.noise(x, y) * 0.5 + 0.5) * 255;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const k = (i * size + j) * 4;
      data[k] = channel(i, j);
      data[k + 1] = channel(i + size, j);
      data[k + 2] = channel(i, j + size);
      data[k + 3] = channel(i + size, j + size);
    }
  }
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Whether the AO's normal/depth pass must leave `object` out: sprites, lines
 * and points, and a mesh none of whose materials is visible, opaque and
 * depth-writing (the sky, transparent overlays). Anything not drawn itself
 * (a group) is never left out: its children decide.
 */
export function hiddenFromAoNormals(object: THREE.Object3D): boolean {
  const flags = object as unknown as Record<string, unknown>;
  if (
    flags['isSprite'] === true ||
    flags['isPoints'] === true ||
    flags['isLine'] === true ||
    flags['isLine2'] === true
  ) {
    return true;
  }
  if (flags['isMesh'] !== true) return false;
  const material = (object as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : [material];
  return !materials.some(
    (m) => m !== undefined && m.visible && !m.transparent && m.depthWrite
  );
}

/**
 * The linear factor the blend multiplies a pixel by: the AO, weakened by
 * `intensity` and faded out between `fadeStartM` and `fadeEndM` of view
 * depth. The shader computes the same expression.
 */
export function aoBlendFactor(
  ao: number,
  intensity: number,
  viewDepthM: number,
  fadeStartM: number,
  fadeEndM: number
): number {
  const keep = 1 - smoothstep(fadeStartM, fadeEndM, viewDepthM);
  return 1 + (ao - 1) * intensity * keep;
}

const BLEND_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLEND_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float intensity;
uniform float fadeStart;
uniform float fadeEnd;
uniform float displayExponent;
varying vec2 vUv;
void main() {
  float depth = texture2D(tDepth, vUv).r;
  float viewDepth = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  float keep = 1.0 - smoothstep(fadeStart, fadeEnd, viewDepth);
  float factor = 1.0 + (texture2D(tAo, vUv).r - 1.0) * intensity * keep;
  gl_FragColor = vec4(vec3(pow(max(factor, 0.0), displayExponent)), 1.0);
}`;

/** A material that multiplies the framebuffer by its output, alpha kept. */
function createBlendMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tAo: { value: null },
      tDepth: { value: null },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      intensity: { value: 1 },
      fadeStart: { value: AO_PARAMS.fadeStartM },
      fadeEnd: { value: AO_PARAMS.fadeEndM },
      displayExponent: { value: AO_DISPLAY_EXPONENT },
    },
    vertexShader: BLEND_VERTEX,
    fragmentShader: BLEND_FRAGMENT,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export interface AmbientOcclusionOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Merged over `AO_PARAMS`. */
  readonly params?: Partial<AoParams>;
  /** Merged over `AO_DENOISE`. */
  readonly denoise?: Partial<AoDenoise>;
  /** The AO targets' size against the drawing buffer, in (0, 1] (default 1). */
  readonly resolutionScale?: number;
  /** The denoise noise's seed (default `AO_NOISE_SEED`). */
  readonly noiseSeed?: number;
  /** Whether `render` draws (default true). */
  readonly enabled?: boolean;
}

export interface AmbientOcclusion {
  /** Whether `render` draws. Switching needs no rebuild. */
  enabled: boolean;
  /** Whether the pass exists (built on the first enabled `render`). */
  readonly built: boolean;
  /** The pass, or null before the first enabled `render` and after dispose. */
  readonly pass: GTAOPass | null;
  readonly params: Readonly<AoParams>;
  /**
   * Multiply the AO onto the frame just drawn to the renderer's current
   * target (call right after `renderer.render(scene, camera)`). Returns
   * whether it drew; nothing at all happens while off or after dispose.
   */
  render(): boolean;
  dispose(): void;
}

function checkParams(p: AoParams): void {
  for (const [key, value] of Object.entries(p)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`AO param ${key} must be finite, got ${value}`);
    }
  }
  if (p.intensity < 0 || p.intensity > 1) {
    throw new RangeError(`AO intensity must be in [0, 1], got ${p.intensity}`);
  }
  if (p.fadeStartM < 0 || p.fadeEndM <= p.fadeStartM) {
    throw new RangeError(
      `AO fade window must satisfy 0 <= start < end, got ${p.fadeStartM}-${p.fadeEndM}`
    );
  }
}

export function createAmbientOcclusion(
  options: AmbientOcclusionOptions
): AmbientOcclusion {
  const { renderer, scene, camera } = options;
  if (!(scene instanceof THREE.Scene)) {
    throw new TypeError('createAmbientOcclusion needs a THREE.Scene');
  }
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    throw new TypeError('createAmbientOcclusion needs a PerspectiveCamera');
  }
  const params: AoParams = Object.freeze({ ...AO_PARAMS, ...options.params });
  checkParams(params);
  const denoise: AoDenoise = { ...AO_DENOISE, ...options.denoise };
  const scale = options.resolutionScale ?? 1;
  if (!(scale > 0 && scale <= 1)) {
    throw new RangeError(`AO resolution scale must be in (0, 1], got ${scale}`);
  }
  const seed = options.noiseSeed ?? AO_NOISE_SEED;
  aoNoiseRandom(seed); // validates the seed before anything is built

  let enabled = options.enabled ?? true;
  let disposed = false;
  let pass: GTAOPass | null = null;
  let blend: THREE.ShaderMaterial | null = null;
  let quad: FullScreenQuad | null = null;
  const bufferSize = new THREE.Vector2();
  const hidden: Array<[THREE.Object3D, boolean]> = [];

  const build = (width: number, height: number): GTAOPass => {
    const built = new GTAOPass(scene, camera, width, height);
    built.output = GTAOPass.OUTPUT.Off;
    built.updateGtaoMaterial({
      radius: params.radius,
      distanceExponent: params.distanceExponent,
      thickness: params.thickness,
      distanceFallOff: params.distanceFallOff,
      scale: params.scale,
      samples: params.samples,
      screenSpaceRadius: params.screenSpaceRadius,
    });
    built.updatePdMaterial({ ...denoise });
    const unseeded = built.pdNoiseTexture;
    built.pdNoiseTexture = aoNoiseTexture(seed);
    built.pdMaterial.uniforms['tNoise']!.value = built.pdNoiseTexture;
    unseeded.dispose();
    blend = createBlendMaterial();
    quad = new FullScreenQuad(blend);
    return built;
  };

  const render = (): boolean => {
    if (!enabled || disposed) return false;
    renderer.getDrawingBufferSize(bufferSize);
    const width = Math.max(1, Math.round(bufferSize.x * scale));
    const height = Math.max(1, Math.round(bufferSize.y * scale));
    if (pass === null) pass = build(width, height);
    else if (pass.width !== width || pass.height !== height) {
      pass.setSize(width, height);
    }
    const target = renderer.getRenderTarget();
    const shadows = renderer.shadowMap;
    const autoUpdate = shadows.autoUpdate;
    const needsUpdate = shadows.needsUpdate;
    hidden.length = 0;
    scene.traverse((object) => {
      if (object.visible && hiddenFromAoNormals(object)) {
        hidden.push([object, object.visible]);
        object.visible = false;
      }
    });
    const autoClear = renderer.autoClear;
    try {
      shadows.autoUpdate = false;
      shadows.needsUpdate = false;
      pass.render(
        renderer,
        null as unknown as THREE.WebGLRenderTarget,
        null as unknown as THREE.WebGLRenderTarget,
        0,
        false
      );
      const u = blend!.uniforms;
      u['tAo']!.value = pass.pdRenderTarget.texture;
      u['tDepth']!.value = pass.depthTexture;
      u['cameraNear']!.value = camera.near;
      u['cameraFar']!.value = camera.far;
      u['intensity']!.value = params.intensity;
      u['fadeStart']!.value = params.fadeStartM;
      u['fadeEnd']!.value = params.fadeEndM;
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      quad!.render(renderer);
    } finally {
      for (const [object, visible] of hidden) object.visible = visible;
      hidden.length = 0;
      shadows.autoUpdate = autoUpdate;
      shadows.needsUpdate = needsUpdate;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(target);
    }
    return true;
  };

  const dispose = (): void => {
    disposed = true;
    if (pass !== null) {
      // three's own dispose leaves the GTAO material behind.
      pass.gtaoMaterial.dispose();
      pass.dispose();
      pass = null;
    }
    blend?.dispose();
    quad?.dispose();
    blend = null;
    quad = null;
  };

  return {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on === true;
    },
    get built() {
      return pass !== null;
    },
    get pass() {
      return pass;
    },
    params,
    render,
    dispose,
  };
}
