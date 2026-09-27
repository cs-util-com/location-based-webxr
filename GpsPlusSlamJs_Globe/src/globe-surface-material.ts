/**
 * The globe's surface patch (globe plan 2026-09-26-0539 §7.3, M3): night
 * lights on the dark side, a glint on the water, and the clouds, as one
 * string patch on three's physical shader, shared by every tile. The clouds
 * drift east over the ground with the globe's clock (round-2 plan
 * 2026-09-26-2055 M3f), so they read as a layer of their own.
 *
 * @see globe-surface-material.ts.md
 */
import * as THREE from "three";

/** The patch's tunables (lab parameters; the phone round sets them). */
export const GLOBE_SURFACE_TUNING = {
  /** Night-light radiance per unit of the (sRGB-decoded) map. */
  nightGain: 1,
  /** Water's roughness, where the mask says water and no cloud covers it. */
  waterRoughness: 0.35,
  /** How far a full cloud whitens the ground. */
  cloudOpacity: 0.8,
} as const;

/**
 * The clouds' eastward drift, in degrees of longitude per scene second: a
 * lab parameter, sized so the layer visibly moves within a few seconds at
 * real time (about 1 px/s on a phone-sized globe). Real weather moves about
 * a degree an hour; this is for reading the clouds as a layer, not physics.
 */
export const GLOBE_CLOUD_DRIFT_DEG_PER_S = 0.5;

/** Every tile's program is the same one: three shares it by this key. */
export const GLOBE_SURFACE_CACHE_KEY = "gps-plus-slam-globe-surface-v2";

/** The one uniforms object every tile's shader reads. */
export interface GlobeSurfaceUniforms {
  readonly uSunEcef: { value: THREE.Vector3 };
  readonly uNight: { value: THREE.Texture };
  readonly uWater: { value: THREE.Texture };
  readonly uClouds: { value: THREE.Texture };
  readonly uNightGain: { value: number };
  readonly uWaterRoughness: { value: number };
  readonly uCloudOpacity: { value: number };
  /** How far east the clouds have drifted, radians in [0, 2π). */
  readonly uCloudLonOffset: { value: number };
}

/**
 * The shared uniforms, over the three global maps (equirect, north at the
 * top). The maps live ONLY here, never on a material: the tile renderer
 * disposes every texture it finds on a tile's material when the tile
 * unloads, which would blank them for every other tile.
 */
export function createGlobeSurfaceUniforms(textures: {
  night: THREE.Texture;
  water: THREE.Texture;
  clouds: THREE.Texture;
}): GlobeSurfaceUniforms {
  return {
    uSunEcef: { value: new THREE.Vector3(1, 0, 0) },
    uNight: { value: textures.night },
    uWater: { value: textures.water },
    uClouds: { value: textures.clouds },
    uNightGain: { value: GLOBE_SURFACE_TUNING.nightGain },
    uWaterRoughness: { value: GLOBE_SURFACE_TUNING.waterRoughness },
    uCloudOpacity: { value: GLOBE_SURFACE_TUNING.cloudOpacity },
    uCloudLonOffset: { value: 0 },
  };
}

/**
 * The clouds' drift at a scene instant (epoch ms, the globe clock's), for a
 * rate in degrees per scene second: radians east, wrapped into [0, 2π). An
 * absolute function of the instant, so a pinned time gives the same clouds
 * on every load. Exact to about 1e-7 rad at today's epoch for rates up to
 * 10 °/s. RangeError for a non-finite instant or rate.
 */
export function cloudLonOffsetRad(sceneMs: number, degPerS: number): number {
  if (!Number.isFinite(sceneMs) || !Number.isFinite(degPerS)) {
    throw new RangeError(
      `cloud drift needs a finite instant and rate, got ${sceneMs}, ${degPerS}`,
    );
  }
  const deg = ((((degPerS * sceneMs) / 1000) % 360) + 360) % 360;
  // A tiny negative remainder can round up to exactly 360.
  return deg >= 360 ? 0 : (deg * Math.PI) / 180;
}

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vGeoNormal;`;

/**
 * The OBJECT-space normal: GeneratedSurfacePlugin writes the geodetic
 * ellipsoid normal there and gives a tile only a translation, so it is an
 * ECEF direction whatever tiles.group's placement in the world (phase 5
 * re-centres it; a world normal would then misplace the maps).
 */
const VERTEX_NORMAL = /* glsl */ `
vGeoNormal = objectNormal;`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vGeoNormal;
uniform vec3 uSunEcef;
uniform sampler2D uNight;
uniform sampler2D uWater;
uniform sampler2D uClouds;
uniform float uNightGain;
uniform float uWaterRoughness;
uniform float uCloudOpacity;
uniform float uCloudLonOffset;`;

/**
 * After the overlay's colour is in diffuseColor: the latitude and longitude
 * from the geodetic normal, the three maps sampled once, and the clouds.
 * The longitude wraps at 180°, where its derivative jumps and would pick
 * the coarsest mip for a 1-px line: the gradients come from whichever of
 * two wraps (seam at 180° or at 0°) changes less across the pixel
 * (Tarini's method), computed before any choice so they stay defined.
 * The clouds are read uCloudLonOffset further west, so they drift east: a
 * continuous shift of a repeat-wrapped map, so the same gradients serve.
 */
const FRAGMENT_SAMPLES = /* glsl */ `
vec3 globeN = normalize( vGeoNormal );
float globeU = atan( globeN.y, globeN.x ) * 0.15915494309189535 + 0.5;
float globeV = asin( clamp( globeN.z, -1.0, 1.0 ) ) * 0.3183098861837907 + 0.5;
float globeU2 = fract( globeU + 0.5 );
vec2 globeDx1 = vec2( dFdx( globeU ), dFdx( globeV ) );
vec2 globeDy1 = vec2( dFdy( globeU ), dFdy( globeV ) );
vec2 globeDx2 = vec2( dFdx( globeU2 ), globeDx1.y );
vec2 globeDy2 = vec2( dFdy( globeU2 ), globeDy1.y );
bool globeWrap = fwidth( globeU2 ) < fwidth( globeU );
vec2 globeDx = globeWrap ? globeDx2 : globeDx1;
vec2 globeDy = globeWrap ? globeDy2 : globeDy1;
vec2 globeUv = vec2( globeU, globeV );
float globeCloud = textureGrad( uClouds, globeUv - vec2( uCloudLonOffset * 0.15915494309189535, 0.0 ), globeDx, globeDy ).r;
float globeWater = textureGrad( uWater, globeUv, globeDx, globeDy ).g;
vec3 globeNight = textureGrad( uNight, globeUv, globeDx, globeDy ).rgb;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), globeCloud * uCloudOpacity );`;

/** Water, where no cloud covers it, is smooth: the sun's glint. */
const FRAGMENT_GLINT = /* glsl */ `
roughnessFactor = mix( roughnessFactor, uWaterRoughness, globeWater * ( 1.0 - globeCloud ) );`;

/**
 * The lights fade in across the terminator (sun 4.6° above to 6.9° below
 * the horizon) and dim under cloud.
 */
const FRAGMENT_NIGHT = /* glsl */ `
totalEmissiveRadiance += globeNight * uNightGain * ( 1.0 - smoothstep( -0.12, 0.08, dot( globeN, uSunEcef ) ) ) * ( 1.0 - 0.8 * globeCloud );`;

/** `source` with `code` after `anchor`, which must occur exactly once. */
function after(source: string, anchor: string, code: string): string {
  const parts = source.split(anchor);
  if (parts.length !== 2) {
    throw new Error(
      `globe surface: "${anchor}" occurs ${parts.length - 1} times in the shader, expected once`,
    );
  }
  return `${parts[0]}${anchor}${code}${parts[1]}`;
}

/**
 * Patches a physical-shader source in place: the uniforms, the geodetic
 * normal varying and the three terms, each after its chunk. Throws, naming
 * the chunk, when an anchor is missing or repeated (a three upgrade that
 * renamed one), rather than silently dropping a term.
 */
export function patchGlobeSurfaceShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: GlobeSurfaceUniforms,
): void {
  let vs = shader.vertexShader;
  vs = after(vs, "#include <common>", VERTEX_DECLARATIONS);
  vs = after(vs, "#include <beginnormal_vertex>", VERTEX_NORMAL);
  let fs = shader.fragmentShader;
  fs = after(fs, "#include <common>", FRAGMENT_DECLARATIONS);
  fs = after(fs, "#include <alphamap_fragment>", FRAGMENT_SAMPLES);
  fs = after(fs, "#include <roughnessmap_fragment>", FRAGMENT_GLINT);
  fs = after(fs, "#include <emissivemap_fragment>", FRAGMENT_NIGHT);
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
  Object.assign(shader.uniforms, uniforms);
}

/**
 * Makes `material` draw the globe's surface: the patch on compile, and one
 * program key for all of them. Material.copy does not carry these hooks,
 * so a clone needs this again.
 */
export function applyGlobeSurface(
  material: THREE.MeshStandardMaterial,
  uniforms: GlobeSurfaceUniforms,
): void {
  material.onBeforeCompile = (shader) =>
    patchGlobeSurfaceShader(shader, uniforms);
  material.customProgramCacheKey = () => GLOBE_SURFACE_CACHE_KEY;
}
