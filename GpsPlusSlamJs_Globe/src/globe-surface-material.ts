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

import { SKY_FILL, SKY_LEVEL_GLSL } from "./sky-level.js";

/** The patch's tunables (lab parameters; the phone round sets them). */
export const GLOBE_SURFACE_TUNING = {
  /**
   * Night-light radiance per unit of the (sRGB-decoded) map: 0.7, the
   * owner's look (round-4 plan 2026-09-28-2105 DEC-GL4-1; 1 before).
   */
  nightGain: 0.7,
  /** Water's roughness, where the mask says water and no cloud covers it. */
  waterRoughness: 0.35,
  /** How far a full cloud whitens the ground. */
  cloudOpacity: 0.8,
  /**
   * The sky fill's share of the diffuse light (DEC-GL5-11): 1 - the
   * relief's direct share, the terrain lab's 0.8 (DEC-GL5-5). The rest is
   * the sun's direct diffuse.
   */
  skyShare: 1 - 0.8,
} as const;

/**
 * The clouds' eastward drift, in degrees of longitude per scene second: a
 * lab parameter, sized so the layer visibly moves within a few seconds at
 * real time (about 1 px/s on a phone-sized globe; 0.75 x the first 0.5 by
 * the owner's choice, round-6 plan DEC-G6-5). Real weather moves about
 * a degree an hour; this is for reading the clouds as a layer, not physics.
 */
export const GLOBE_CLOUD_DRIFT_DEG_PER_S = 0.375;

/** Every tile's program is the same one: three shares it by this key. */
export const GLOBE_SURFACE_CACHE_KEY = "gps-plus-slam-globe-surface-v10";

/** The one uniforms object every tile's shader reads. */
export interface GlobeSurfaceUniforms {
  readonly uSunEcef: { value: THREE.Vector3 };
  /**
   * The same sun in WORLD space (the tiles' placement applied), kept by the
   * surface; the cloud shading projects it with the view matrix, which
   * maps world directions (review 2026-10-01, m4).
   */
  readonly uSunWorld: { value: THREE.Vector3 };
  readonly uNight: { value: THREE.Texture };
  readonly uClouds: { value: THREE.Texture };
  readonly uNightGain: { value: number };
  readonly uWaterRoughness: { value: number };
  readonly uCloudOpacity: { value: number };
  /** How far east the clouds have drifted, radians in [0, 2π). */
  readonly uCloudLonOffset: { value: number };
  /**
   * The reference image's looks (round-4 plan 2026-09-28-2105 DEC-GL4-8),
   * each 0 (off, the look before) to 1: a cool blue grade over the
   * ground (item 1); clouds with blue-grey thin edges and a lit side
   * (item 2, the shading only); a soft blue-grey night side, a softer
   * terminator and warm city lights (item 3).
   */
  readonly uGrade: { value: number };
  readonly uCloudRelief: { value: number };
  readonly uTwilight: { value: number };
  /**
   * The sky fill (DEC-GL5-11): its floor (`SKY_FILL.floor`; 0 is the look
   * before, the fill then being the flat globe's own direct term) and its
   * share of the diffuse light (`GLOBE_SURFACE_TUNING.skyShare`).
   */
  readonly uSkyFloor: { value: number };
  readonly uSkyShare: { value: number };
  /**
   * The relief's share of the pixels in the altitude band (one-scene plan
   * §3.2; `carrierShareAt`): 0 draws the globe alone, 1 the relief alone.
   */
  readonly uCarrierShare: { value: number };
  /**
   * The sun light's radiance (its colour times intensity), kept by the
   * surface every time the sun is set: the sky fill's light, by role rather
   * than as the scene's first directional light.
   */
  readonly uSunRadiance: { value: THREE.Vector3 };
  /**
   * The clouds' paint in the ground's colour (round-6 plan G6-2): 1 paints
   * them into the surface (the look before), 0 leaves the ground its own
   * colour for a page that draws them on their own shell
   * (`globe-cloud-shell.ts`).
   */
  readonly uCloudInSurface: { value: number };
  /**
   * The flat cloud layer's share by altitude (round-2 plan DEC-FR2-5,
   * `globe-cloud-flat-fade.ts`), 1 the look before: the water's glint is
   * masked only by this much of the cloud (`uCloudInSurface` and the shell
   * already carry it).
   */
  readonly uCloudFlat: { value: number };
  /**
   * The soft cloud shadow on the ground (DEC-G6-4), 0 (none) to 1: the
   * share of the diffuse colour a full cloud on the shell toward the sun
   * takes away.
   */
  readonly uCloudShadow: { value: number };
  /** The cloud shell's height above the ground (m), for the shadow's offset. */
  readonly uCloudShellM: { value: number };
}

/**
 * How the patch is compiled: `band` for a page that draws a relief;
 * `fill` (with `band`) when the globe fills the relief's gaps through the
 * stencil (round-6 plan G6-1), where it never discards.
 */
export interface GlobeSurfacePatchOptions {
  readonly band?: boolean;
  readonly fill?: boolean;
}

/**
 * The shared uniforms, over the two global maps (equirect, north at the
 * top). The maps live ONLY here, never on a material: the tile renderer
 * disposes every texture it finds on a tile's material when the tile
 * unloads, which would blank them for every other tile. The water mask is
 * not a map: it is each imagery tile's alpha (round-4 plan 2026-09-28-2105
 * DEC-GL4-6).
 */
export function createGlobeSurfaceUniforms(textures: {
  night: THREE.Texture;
  clouds: THREE.Texture;
}): GlobeSurfaceUniforms {
  return {
    uSunEcef: { value: new THREE.Vector3(1, 0, 0) },
    uSunWorld: { value: new THREE.Vector3(1, 0, 0) },
    uNight: { value: textures.night },
    uClouds: { value: textures.clouds },
    uNightGain: { value: GLOBE_SURFACE_TUNING.nightGain },
    uWaterRoughness: { value: GLOBE_SURFACE_TUNING.waterRoughness },
    uCloudOpacity: { value: GLOBE_SURFACE_TUNING.cloudOpacity },
    uCloudLonOffset: { value: 0 },
    uGrade: { value: 0 },
    uCloudRelief: { value: 0 },
    uTwilight: { value: 0 },
    uSkyFloor: { value: SKY_FILL.floor },
    uSkyShare: { value: GLOBE_SURFACE_TUNING.skyShare },
    uCarrierShare: { value: 0 },
    uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
    uCloudInSurface: { value: 1 },
    uCloudFlat: { value: 1 },
    uCloudShadow: { value: 0 },
    uCloudShellM: { value: 0 },
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

/**
 * Which carrier keeps a pixel in the band's cross-fade, for a dither value
 * `d` in [0, 1) and the relief's `share`: the globe (`side` 0) keeps
 * `d >= share`, the relief (`side` 1) keeps `d < share`, so every pixel
 * goes to exactly one. The shader's `globeFadeKeeps`.
 */
export function globeFadeKeeps(d: number, share: number, side: 0 | 1): boolean {
  return side === 0 ? d >= share : d < share;
}

/**
 * The band's dither (one-scene plan §3.2): interleaved gradient noise of
 * the pixel's position (Jimenez 2014), a fixed pattern in [0, 1) that
 * spreads any share evenly over the screen, and the split
 * `globeFadeKeeps`. The side is the define `GLOBE_FADE_SIDE`: 0 (the
 * globe's tiles) unless a material defines 1 (the relief's tiles).
 */
export const GLOBE_FADE_GLSL = /* glsl */ `
#ifndef GLOBE_FADE_SIDE
#define GLOBE_FADE_SIDE 0
#endif
float globeFadeDither() {
  return fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
}
bool globeFadeKeeps( float d, float share ) {
#if GLOBE_FADE_SIDE == 0
  return d >= share;
#else
  return d < share;
#endif
}`;

/**
 * The band's code is compiled only where a relief exists: the globe's tiles
 * of a page with a relief (`GLOBE_BAND`) and the relief's own tiles
 * (`GLOBE_FADE_SIDE` 1). The plain globe draws the program from before.
 */
const BAND_GUARD = "#if defined( GLOBE_BAND ) || GLOBE_FADE_SIDE == 1";

/**
 * First in the fragment's work: a pixel the other carrier owns is dropped.
 * Not on a globe that fills the relief's gaps (`GLOBE_FILL`, round-6 plan
 * G6-1): it keeps every pixel the stencil lets through, and a discard would
 * turn off the GPU's early depth and stencil tests for its whole shader.
 */
const FRAGMENT_FADE = /* glsl */ `
#if ( defined( GLOBE_BAND ) && !defined( GLOBE_FILL ) ) || GLOBE_FADE_SIDE == 1
if ( !globeFadeKeeps( globeFadeDither(), uCarrierShare ) ) discard;
#endif`;

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
uniform vec3 uSunWorld;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform float uNightGain;
uniform float uWaterRoughness;
uniform float uCloudOpacity;
uniform float uCloudLonOffset;
uniform float uGrade;
uniform float uCloudRelief;
uniform float uTwilight;
uniform float uSkyFloor;
uniform float uSkyShare;
uniform float uCarrierShare;
uniform vec3 uSunRadiance;
uniform float uCloudInSurface;
uniform float uCloudFlat;
uniform float uCloudShadow;
uniform float uCloudShellM;
const vec3 GLOBE_WARM_LIGHTS = vec3( 1.4, 0.95, 0.5 );
${SKY_LEVEL_GLSL}
${GLOBE_FADE_GLSL}`;

/**
 * The clouds' sample and shade, shared by the surface and the cloud shell
 * (`globe-cloud-shell.ts`; DEC-H3): from the geodetic normal `vGeoNormal`
 * the latitude and longitude (the longitude's gradients by whichever of two
 * wraps changes less across the pixel, Tarini's method), the clouds read
 * `uCloudLonOffset` further west so they drift east, and their blue-grey
 * shade lit on the side facing the sun (`uCloudRelief`'s look).
 */
export const GLOBE_CLOUD_GLSL = /* glsl */ `
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
vec2 globeCloudGrad = vec2( dFdx( globeCloud ), dFdy( globeCloud ) );
vec2 globeSunView = ( viewMatrix * vec4( uSunWorld, 0.0 ) ).xy;
float globeCloudLit = clamp( 1.0 - 6.0 * dot( globeCloudGrad, globeSunView / max( length( globeSunView ), 1e-6 ) ), 0.65, 1.3 );
vec3 globeCloudShade = mix( vec3( 0.6, 0.68, 0.8 ), vec3( 1.0 ), smoothstep( 0.15, 0.85, globeCloud ) ) * globeCloudLit;
`;

/**
 * After the overlay's colour is in diffuseColor: the water from the tile's
 * alpha (round-4 plan 2026-09-28-2105 DEC-GL4-6: the imagery tiles carry
 * the water mask there, 1 on land and 0 on water, so the glint follows the
 * imagery's own coastline at the imagery's resolution; the alpha is then
 * set back to opaque), the shared cloud block (`GLOBE_CLOUD_GLSL`), and
 * the night map sampled with its gradients. The clouds are painted into
 * the ground's colour only by `uCloudInSurface`; a page with the cloud
 * shell sets it to 0 and the ground keeps its colour (round-6 plan G6-2).
 * The soft shadow (`uCloudShadow`, DEC-G6-4) reads the cloud where the
 * sun's ray through this point crosses the shell, `uCloudShellM` above:
 * the point moved toward the sun by h / (R sin(elevation)) radians, the
 * elevation floored at 0.05 so a low sun reaches no further than 20 h. By
 * day only, after the paint, before the grade.
 */
const FRAGMENT_SAMPLES = /* glsl */ `
float globeWater = 1.0 - diffuseColor.a;
diffuseColor.a = 1.0;
${GLOBE_CLOUD_GLSL}
vec3 globeNight = textureGrad( uNight, globeUv, globeDx, globeDy ).rgb;
diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 1.0 ), globeCloudShade, uCloudRelief ), globeCloud * uCloudOpacity * uCloudInSurface );
float globeSunUp = dot( globeN, uSunEcef );
float globeShellShadow = 0.0;
if ( uCloudShadow > 0.0 && globeSunUp > 0.0 ) {
  vec3 globeShellN = normalize( globeN + uSunEcef * ( uCloudShellM / ( 6371000.0 * max( globeSunUp, 0.05 ) ) ) );
  vec2 globeShellUv = vec2( atan( globeShellN.y, globeShellN.x ) * 0.15915494309189535 + 0.5, asin( clamp( globeShellN.z, -1.0, 1.0 ) ) * 0.3183098861837907 + 0.5 );
  globeShellShadow = textureGrad( uClouds, globeShellUv - vec2( uCloudLonOffset * 0.15915494309189535, 0.0 ), globeDx, globeDy ).r * uCloudOpacity;
}
diffuseColor.rgb *= 1.0 - uCloudShadow * globeShellShadow;
float globeLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, globeLuma * vec3( 0.7, 0.88, 1.2 ), uGrade * 0.7 );`;

/** Water, where no cloud covers it, is smooth: the sun's glint. */
const FRAGMENT_GLINT = /* glsl */ `
roughnessFactor = mix( roughnessFactor, uWaterRoughness, globeWater * ( 1.0 - globeCloud * uCloudFlat ) );`;

/**
 * The twilight look (DEC-GL4-8 item 3) on a diffuse colour, by the sun's
 * height `globeNdl` (the cosine of its zenith angle at the normal): a faint
 * blue-grey night side and a soft band just past the terminator. Shared by
 * the surface and the cloud shell (DEC-H3).
 */
export const GLOBE_TWILIGHT_GLSL = /* glsl */ `
totalEmissiveRadiance += uTwilight * diffuseColor.rgb * ( vec3( 0.06, 0.09, 0.16 ) * ( 1.0 - smoothstep( -0.25, 0.05, globeNdl ) ) + vec3( 0.35, 0.3, 0.3 ) * smoothstep( -0.12, 0.0, globeNdl ) * ( 1.0 - smoothstep( 0.0, 0.12, globeNdl ) ) );`;

/**
 * The lights fade in across the terminator (sun 4.6° above to 6.9° below
 * the horizon) and dim under cloud; the twilight look (DEC-GL4-8 item 3)
 * warms them, lights the night side faintly blue-grey (from the ground's
 * own colour) and adds a soft band just past the terminator.
 */

const FRAGMENT_NIGHT = /* glsl */ `
float globeNdl = dot( globeN, uSunEcef );
totalEmissiveRadiance += globeNight * mix( vec3( 1.0 ), GLOBE_WARM_LIGHTS, uTwilight ) * uNightGain * ( 1.0 - smoothstep( -0.12, 0.08, globeNdl ) ) * ( 1.0 - 0.8 * globeCloud * uCloudInSurface );
${GLOBE_TWILIGHT_GLSL}`;

/**
 * The sky fill (DEC-GL5-11), the relief's light: the direct diffuse keeps
 * `1 - share` and the sky gives `share` x the shared sky level at the
 * geodetic sun height, in the sun's radiance, through three's Lambert. On
 * flat ground with the sun above the floor that is the direct term again;
 * below it the sky holds the floor and fades through the twilight. The
 * specular (the water's glint) is untouched. The relief's tiles take the
 * full `uSkyShare`; the globe's own tiles take it only as far as the
 * relief has the pixels (`uCarrierShare`), so the globe's look above the
 * band is the approved one and the two agree where they meet.
 */
const FRAGMENT_SKY_FILL = /* glsl */ `
${BAND_GUARD}
#if GLOBE_FADE_SIDE == 0
float globeSkyShare = uSkyShare * uCarrierShare;
#else
float globeSkyShare = uSkyShare;
#endif
reflectedLight.directDiffuse *= 1.0 - globeSkyShare;
reflectedLight.indirectDiffuse += globeSkyShare * skyLevelOf( globeNdl, uSkyFloor ) * uSunRadiance * BRDF_Lambert( material.diffuseContribution );
#endif`;

/**
 * `code` inserted right after `anchor` in a shader source. Throws, naming
 * the anchor, when it is missing or repeated (a three upgrade that renamed a
 * chunk), rather than silently dropping the code. Shared by the surface and
 * the cloud shell.
 */
export function afterChunk(
  source: string,
  anchor: string,
  code: string,
): string {
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
  options: GlobeSurfacePatchOptions = {},
): void {
  let vs = shader.vertexShader;
  vs = afterChunk(vs, "#include <common>", VERTEX_DECLARATIONS);
  vs = afterChunk(vs, "#include <beginnormal_vertex>", VERTEX_NORMAL);
  let fs = shader.fragmentShader;
  fs = afterChunk(fs, "#include <common>", FRAGMENT_DECLARATIONS);
  fs = afterChunk(fs, "#include <clipping_planes_fragment>", FRAGMENT_FADE);
  fs = afterChunk(fs, "#include <alphamap_fragment>", FRAGMENT_SAMPLES);
  fs = afterChunk(fs, "#include <roughnessmap_fragment>", FRAGMENT_GLINT);
  fs = afterChunk(fs, "#include <emissivemap_fragment>", FRAGMENT_NIGHT);
  fs = afterChunk(fs, "#include <lights_fragment_end>", FRAGMENT_SKY_FILL);
  shader.vertexShader = vs;
  const defines = [
    options.band ? "#define GLOBE_BAND" : "",
    options.band && options.fill ? "#define GLOBE_FILL" : "",
  ].filter(Boolean);
  shader.fragmentShader =
    defines.length > 0 ? `${defines.join("\n")}\n${fs}` : fs;
  Object.assign(shader.uniforms, uniforms);
}

/**
 * Makes `material` draw the globe's surface: the patch on compile, and one
 * program key for all of them (its own for a page with a relief, `band`).
 * Material.copy does not carry these hooks, so a clone needs this again.
 */
export function applyGlobeSurface(
  material: THREE.MeshStandardMaterial,
  uniforms: GlobeSurfaceUniforms,
  options: GlobeSurfacePatchOptions = {},
): void {
  material.onBeforeCompile = (shader) =>
    patchGlobeSurfaceShader(shader, uniforms, options);
  const key = options.band
    ? `${GLOBE_SURFACE_CACHE_KEY}-band${options.fill ? "-fill" : ""}`
    : GLOBE_SURFACE_CACHE_KEY;
  material.customProgramCacheKey = () => key;
}
