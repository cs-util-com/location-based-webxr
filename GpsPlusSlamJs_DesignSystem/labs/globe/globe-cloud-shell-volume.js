/**
 * The spherical cloud volume in the globe lab (round-4 plan 2026-10-11-0122,
 * R4d / V1; DEC-R4-5 as reconciled with DEC-R3-6 in its §6 item 8): ONE
 * full-screen ray march through a cloud shell around the Earth, from about
 * 700 km down to the slab's ceiling, so the clouds the flat layer drew
 * between 700 and 30 km are volumes; `cloudShellVolume=1`, off by default.
 *
 * - **The geometry**: the atmosphere pass's scaffold (`globe-atmosphere.js`):
 *   each pixel's ray in the model frame (the ellipsoid as the atmosphere's
 *   ground sphere, km), intersected analytically with the deck's top and
 *   base spheres, ending at the relief's depth when it is drawn this frame.
 * - **The clouds**: the slab's column model (`cloud-slab.ts`: a column's
 *   thickness from the noise above the cover's threshold, its exact optical
 *   depth, the sun through the column above, the top and underside light),
 *   the deck scaled in height by the law's `thicknessScale` with the
 *   extinction divided by it (a vertical column keeps its opacity, so the
 *   cover keeps meaning share of sky). The cover from the cloud map at the
 *   point's true latitude and longitude (B-spline at level 0, mips by the
 *   footprint); the noise from N1's live field on an azimuthal chart around
 *   the frame's origin, which is the slab's local frame near it, through
 *   the same carried anchor (`globe-cloud-shell-volume.ts`).
 * - **The layers**: the law's parameter sets by altitude (steps, octaves,
 *   cells, thickness); between two stations two fields of fixed cell
 *   scales mixed with weights whose squares sum to 1 (no dip, but a
 *   morph over the band: R4d review, finding 3).
 * - **The light** per sample point's own sun (the shell spans the
 *   terminator): the sun's transmittance from the atmosphere pass's table
 *   at the cloud, and the zenith sky as ambient from a small table of the
 *   framework's CPU sky by the sun's cosine.
 * - **The mix** with the slab: the slab drawn into its own target at its
 *   full share, then ONE composite of both, premultiplied and weighted
 *   (the shell 1 - the slab's share, the slab its share): mixed, never
 *   stacked, so the hand-over keeps the opacity.
 *
 * @see globe-cloud-shell-volume.js.md
 */
import * as THREE from "three";

import { glslFloat } from "/fw/utils/glsl-float.js";
import {
  ATMOSPHERE_COMMON_GLSL,
  ATMOSPHERE_MAX_SCENE_RADIANCE,
  ATMOSPHERE_RADIANCE_SCALE,
} from "/fw/visualization/atmosphere/atmosphere-glsl.js";
import { EARTH_ATMOSPHERE } from "/fw/visualization/atmosphere/atmosphere-model.js";
import { CLOUD_LAYER } from "/fw/visualization/atmosphere/cloud-layer.js";
import { cloudCoverThresholds } from "/fw/visualization/atmosphere/cloud-coverage.js";
import {
  CLOUD_LIVE_NOISE_GLSL,
  cloudLiveBasis,
} from "/fw/visualization/atmosphere/cloud-live-noise.js";
import { CLOUD_SHEET } from "/fw/visualization/atmosphere/cloud-sheet.js";
import {
  CLOUD_SLAB,
  cloudSlabThresholdThicknessM,
} from "/fw/visualization/atmosphere/cloud-slab.js";
import {
  CLOUD_SHELL_VOLUME,
  GLOBE_CLOUD_SHELL_GLSL,
  cloudShellFieldWeights,
  cloudShellFrame,
  cloudShellVolumeLaw,
} from "/globe/globe-cloud-shell-volume.js";
import { GLOBE_CLOUD_FILTER_GLSL } from "/globe/globe-cloud-filter.js";

import { ZENITH_MU, ZENITH_TABLE } from "./globe-cloud-shell-light.js";

const VERTEX = /* glsl */ `
uniform mat4 uInverseProjection;
uniform mat3 uViewToModel;
varying vec3 vDirection;
void main() {
  vec4 view = uInverseProjection * vec4( position.xy, 1.0, 1.0 );
  vDirection = uViewToModel * ( view.xyz / view.w );
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const MAX_STEPS = CLOUD_SHELL_VOLUME.maxSteps;

/**
 * The march. Twin of the slab's (`cloud-slab.ts` CLOUD_SLAB_FRAGMENT_GLSL)
 * on a sphere: the nodes uniform with a per-pixel jitter (the slab's
 * spacing from above), the column read at each node, per segment the part
 * under the linear top (the secant step), its exact optical depth through
 * the height's slope along the ray, the sun's depth through the column
 * above both ends and the light integrated in closed form.
 */
const FRAGMENT = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
${CLOUD_LIVE_NOISE_GLSL}
${GLOBE_CLOUD_FILTER_GLSL}
${GLOBE_CLOUD_SHELL_GLSL}
uniform vec3 uCamera;
uniform vec3 uSun;
uniform float uRadiance;
uniform mat3 uViewToModel;
uniform sampler2D uSceneDepth;
uniform mat4 uSceneInverseProjection;
uniform float uSceneDepthWeight;
uniform vec2 uTargetSize;
uniform float uPixelAngle;
// The deck: its base and top over the model sphere (km), its thickness's
// scale (the extinction divided by it), the law's steps, octaves, cells.
uniform float uDeckBaseKm;
uniform float uDeckTopKm;
uniform float uThickness;
uniform int uSteps;
uniform float uOctaves;
// The two fields' cell scales (the law's stations) and their mix's
// weights (cloudShellFieldWeights: the spread kept); the second unread at
// weight 0.
uniform vec2 uCells;
uniform vec2 uFieldWeights;
// The slab's aerial fade's share (1 at its station, 0 high up).
uniform float uAerial;
// The column's rise per unit of noise, times this (the law's noiseShare):
// below 1 flatter columns and soft, translucent edges, the cover kept.
uniform float uNoiseShare;
// The cover: the map, its opacity, the volume's gain, the shell's fade-in,
// and the live field's threshold table.
uniform sampler2D uClouds;
uniform float uCloudOpacity;
uniform float uCoverGain;
uniform float uShellIn;
// The slab's share and its disc (model km): the shell gives up the share
// only where the slab draws (R4d review, finding 1).
uniform float uSlabShare;
uniform vec3 uDiscCentre;
uniform float uDiscRadiusKm;
uniform float uCoverThresholds[33];
// The live field: lattice, the shell's basis (the slab's, its anchor over
// the cell scale), the amplitudes.
uniform sampler2D uLattice;
uniform vec4 uBasis[ATM_LIVE_OCTAVES];
uniform vec4 uBasisB[ATM_LIVE_OCTAVES];
uniform float uAmp[ATM_LIVE_OCTAVES];
uniform vec3 uZenith[${ZENITH_MU.entries}];
varying vec3 vDirection;

const int SHELL_MAX_STEPS = ${MAX_STEPS};
const float SHELL_SIGMA = ${glslFloat(CLOUD_SLAB.extinctionPerM)};
const float SHELL_SOFT = ${glslFloat(CLOUD_SLAB.baseSoftM)};
const float SHELL_HEIGHT_SCALE = ${glslFloat(CLOUD_SLAB.heightScaleM)};
const float SHELL_T0 = ${glslFloat(cloudSlabThresholdThicknessM())};
const float SHELL_SUN_DEPTH = ${glslFloat(CLOUD_SLAB.sunDepthScale)};
const float SHELL_SUN_MU_FLOOR = ${glslFloat(CLOUD_SLAB.sunMuFloor)};
const float SHELL_EARLY_EXIT = ${glslFloat(CLOUD_SLAB.earlyExitTransmittance)};
const float SHELL_LIGHT_SERIES = ${glslFloat(CLOUD_SLAB.lightSeriesX)};
const float SHELL_EDGE = ${glslFloat(CLOUD_LAYER.edgeHalfWidth)};
const float SHELL_SUN_AMBIENT = ${glslFloat(CLOUD_LAYER.sunAmbient)};
const float SHELL_FORWARD = ${glslFloat(CLOUD_LAYER.forwardStrength)};
const float SHELL_FORWARD_POWER = ${glslFloat(CLOUD_LAYER.forwardPower)};
const float SHELL_THICKNESS_DARK = ${glslFloat(CLOUD_LAYER.thicknessDarkening)};
const float SHELL_SKY_AMBIENT = ${glslFloat(CLOUD_LAYER.skyAmbient)};
const float SHELL_TOP_ALBEDO = ${glslFloat(CLOUD_SHEET.topAlbedo)};
const float SHELL_ZENITH_FROM = ${glslFloat(ZENITH_MU.from)};
const float SHELL_ZENITH_TO = ${glslFloat(ZENITH_MU.to)};
const float SHELL_MAX_RADIANCE = ${glslFloat(ATMOSPHERE_MAX_SCENE_RADIANCE)};
const float SHELL_AERIAL_KM = ${glslFloat(CLOUD_LAYER.aerialKm)};
// The ray's slope (the sine of its angle below the deck's horizontal) at
// which the limb fade is complete: 0.03, about 1.7 degrees.
const float SHELL_LIMB_SLOPE = 0.03;

// Twin of cloudSlabCumulativeM.
float shellCumulative( float h ) {
  if ( h <= 0.0 ) return 0.0;
  return h < SHELL_SOFT ? h * h / ( 2.0 * SHELL_SOFT ) : h - 0.5 * SHELL_SOFT;
}

// Twin of cloudThresholdForCover on the live table.
float shellThreshold( float cover ) {
  float c = clamp( cover, 0.0, 1.0 ) * 32.0;
  int k = int( min( floor( c ), 31.0 ) );
  return mix( uCoverThresholds[k], uCoverThresholds[k + 1], c - float( k ) );
}

// The map at a footprint (km): the B-spline at level 0 (every reader's),
// handing over to the mips once a texel is smaller than the footprint. A
// texel along the longitude spans the latitude's cosine of the equator's,
// so the level is taken from that (R4d review, finding 12: the equator's
// texel read one level too sharp at 60 degrees, aliasing toward the poles'
// limbs); floored where the meridians meet.
float shellMap( vec2 uv, float footprintKm, float cosLat ) {
  float texelKm = 40075.0 * max( cosLat, 0.02 ) / float( textureSize( uClouds, 0 ).x );
  float lod = log2( max( footprintKm / texelKm, 1e-4 ) );
  float fine = globeCloudCubicLod( uClouds, uv );
  if ( lod <= 0.0 ) return fine;
  return mix( fine, textureLod( uClouds, uv, lod ).r, smoothstep( 0.0, 1.0, lod ) );
}

// N1's live field (atmCloudLiveNoise) at the chart point p (km), its cells
// times cell (the basis is the anchor over it), the octaves capped at a
// fractional count (the last one in part, so the law's octaves never jump).
float shellField( vec2 pKm, float footprintKm, float cell, vec4 basis[ATM_LIVE_OCTAVES] ) {
  vec2 p = pKm / cell;
  float footprint = footprintKm / cell;
  float sum = 0.0;
  float spread = 0.0;
  for ( int k = 0; k < ATM_LIVE_OCTAVES; k++ ) {
    float cap = clamp( uOctaves - float( k ), 0.0, 1.0 );
    if ( cap <= 0.0 ) break;
    float w = cap * ( 1.0 - smoothstep( ATM_LIVE_AA_START, ATM_LIVE_AA_END, footprint / ATM_LIVE_CELL[k] ) );
    if ( w <= 0.0 ) break;
    vec4 b = basis[k];
    vec2 q = vec2( b.x * p.x - b.y * p.y, b.y * p.x + b.x * p.y ) + b.zw;
    vec2 i = floor( q );
    vec2 f = q - i;
    f = f * f * ( 3.0 - 2.0 * f );
    float v = textureLod( uLattice, ( i + f + 0.5 ) / ATM_LIVE_SIZE, 0.0 ).r;
    sum += uAmp[k] * w * ( v - ATM_LIVE_LATTICE_MEAN );
    spread += uAmp[k] * w * uAmp[k] * w;
  }
  if ( spread > 0.0 ) sum *= min( sqrt( ATM_LIVE_SPREAD0 / spread ), ATM_LIVE_MAX_GAIN );
  return ATM_LIVE_FIELD_MEAN + sum;
}

// The two stations' fields mixed by weights whose squares sum to 1, each
// at its own fixed scale (a scale moving with the altitude slides the
// ground-anchored clouds); one field at a station.
float shellNoise( vec2 pKm, float footprintKm ) {
  float d = 0.0;
  if ( uFieldWeights.x > 0.0 ) d += uFieldWeights.x * ( shellField( pKm, footprintKm, uCells.x, uBasis ) - ATM_LIVE_FIELD_MEAN );
  if ( uFieldWeights.y > 0.0 ) d += uFieldWeights.y * ( shellField( pKm, footprintKm, uCells.y, uBasisB ) - ATM_LIVE_FIELD_MEAN );
  return ATM_LIVE_FIELD_MEAN + d;
}

vec3 shellZenith( float mu ) {
  float x = clamp( ( mu - SHELL_ZENITH_FROM ) / ( SHELL_ZENITH_TO - SHELL_ZENITH_FROM ), 0.0, 1.0 ) * float( ${ZENITH_MU.entries - 1} );
  int k = int( min( floor( x ), float( ${ZENITH_MU.entries - 2} ) ) );
  return mix( uZenith[k], uZenith[k + 1], x - float( k ) );
}

// Twin of cloudSlabInStepLight.
highp float shellInStepLight( highp float tau, highp float sunA, highp float sunB ) {
  highp float x = tau - sunA + sunB;
  highp float ra = exp( -sunA );
  if ( abs( x ) < SHELL_LIGHT_SERIES ) return tau * ra * ( 1.0 - 0.5 * x + x * x / 6.0 );
  return tau * ( ra - exp( -sunB - tau ) ) / x;
}

// One node: the column's raw thickness (m, before its clamp, scaled), the
// deck height of the ray there (m), the noise and the threshold.
void shellNode( vec3 o, vec3 dir, float t, float stepKm, out float raw, out float height, out float noise, out float threshold ) {
  vec3 p = o + dir * t;
  float r = length( p );
  height = ( r - uShellGroundKm - uDeckBaseKm ) * 1000.0;
  float vertical = abs( dot( dir, p / r ) );
  float horizontal = sqrt( max( 0.0, 1.0 - vertical * vertical ) );
  float footprint = max( t * uPixelAngle, stepKm * horizontal );
  float cover = shellMap( globeShellMapUv( p ), footprint, length( normalize( p ).xy ) ) * uCloudOpacity * uCoverGain * uShellIn;
  threshold = cover > 0.0 ? shellThreshold( cover ) : 2.0;
  noise = shellNoise( globeShellChartKm( p ), footprint );
  raw = ( SHELL_T0 + SHELL_HEIGHT_SCALE * uNoiseShare * ( noise - threshold ) ) * uThickness;
}

// The shell's weight at a deck point: 1 - the slab's share x its disc's
// mask (unchanged within 0.7 r, cleared from r, the slab's own fade), by
// the arc from the disc's centre. Twin: cloudShellPixelWeight (without
// its shellIn, which the composite applies).
float shellPixelWeight( vec3 p ) {
  if ( uSlabShare <= 0.0 ) return 1.0;
  float d = uShellGroundKm * 2.0 * asin( min( 1.0, 0.5 * length( normalize( p ) - normalize( uDiscCentre ) ) ) );
  float mask = 1.0 - smoothstep( 0.7 * uDiscRadiusKm, uDiscRadiusKm, d );
  return 1.0 - uSlabShare * mask;
}

void main() {
  vec3 dir = normalize( vDirection );
  vec3 o = uCamera;
  float ro = length( o );
  float b = dot( o, dir );
  float topR = uShellGroundKm + uDeckTopKm;
  float baseR = uShellGroundKm + uDeckBaseKm;
  float discTop = b * b - ( ro - topR ) * ( ro + topR );
  if ( discTop <= 0.0 ) discard;
  float sTop = sqrt( discTop );
  float tTopOut = -b + sTop;
  if ( tTopOut <= 0.0 ) discard;
  float tIn = max( 0.0, -b - sTop );
  float tOut = tTopOut;
  // From above, the ray leaves the deck where it meets the base sphere;
  // from inside it leaves at the base or the top.
  float discBase = b * b - ( ro - baseR ) * ( ro + baseR );
  if ( discBase > 0.0 ) {
    float sBase = sqrt( discBase );
    float tBaseIn = -b - sBase;
    if ( tBaseIn > 0.0 ) tOut = min( tOut, tBaseIn );
    else if ( ro < baseR ) tIn = max( tIn, -b + sBase );
  }
  if ( uSceneDepthWeight > 0.0 ) {
    vec2 depthUv = gl_FragCoord.xy / uTargetSize;
    float sceneDepth = texture2D( uSceneDepth, depthUv ).r;
    if ( sceneDepth < 1.0 ) {
      vec4 viewPoint = uSceneInverseProjection * vec4( depthUv * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0 );
      float tScene = length( uViewToModel * ( viewPoint.xyz / viewPoint.w ) );
      tOut = mix( tOut, min( tOut, tScene ), uSceneDepthWeight );
    }
  }
  if ( tOut <= tIn ) discard;
  // The limb: a ray grazing the deck crosses up to thousands of km of it in
  // a few steps, which drew a dashed white line along the horizon from
  // 700 km. Faded out as the ray's slope through the deck goes to 0 (the
  // dome's horizon fade, cloudHorizonFade, in the deck's own vertical).
  float limb = smoothstep( 0.0, SHELL_LIMB_SLOPE, -dot( dir, normalize( o + dir * tIn ) ) );
  if ( limb <= 0.0 ) discard;
  float pixelWeight = shellPixelWeight( o + dir * tIn );
  if ( pixelWeight <= 0.0 ) discard;
  float lengthKm = tOut - tIn;
  // The light at the interval's middle: the sun's own elevation there.
  vec3 pMid = o + dir * ( 0.5 * ( tIn + tOut ) );
  vec3 up = normalize( pMid );
  float mu = dot( up, uSun );
  vec3 sunT = atmSampleTransmittance( atmTransmittanceLut, uShellGroundKm + 0.5 * ( uDeckBaseKm + uDeckTopKm ), mu );
  vec3 zenith = shellZenith( mu );
  float cosToSun = dot( dir, uSun );
  float forward = pow( max( cosToSun, 0.0 ), SHELL_FORWARD_POWER );
  vec3 top = ATM_RADIANCE_SCALE * sunT * max( mu, 0.0 ) * SHELL_TOP_ALBEDO / ATM_PI + zenith * SHELL_SKY_AMBIENT;
  vec3 sunUnder = ATM_RADIANCE_SCALE * sunT * ( SHELL_SUN_AMBIENT + SHELL_FORWARD * forward );
  vec3 skyUnder = zenith * SHELL_SKY_AMBIENT;
  highp float sunScale = SHELL_SIGMA * SHELL_SUN_DEPTH / max( mu, SHELL_SUN_MU_FLOOR );
  float deck = ( uDeckTopKm - uDeckBaseKm ) * 1000.0;
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float steps = float( uSteps );
  vec3 colour = vec3( 0.0 );
  float alpha = 0.0;
  float transmittance = 1.0;
  float ta = tIn;
  float ra; float ha; float na; float tha;
  shellNode( o, dir, ta, lengthKm / steps, ra, ha, na, tha );
  for ( int i = 0; i <= SHELL_MAX_STEPS; i++ ) {
    if ( i > uSteps ) break;
    float u = i == uSteps ? 1.0 : ( float( i ) + jitter ) / steps;
    float tb = tIn + u * lengthKm;
    float rb; float hb; float nb; float thb;
    shellNode( o, dir, tb, tb - ta, rb, hb, nb, thb );
    float da = ra - ha;
    float db = rb - hb;
    if ( tb > ta && ( da >= 0.0 || db >= 0.0 ) ) {
      float fa = da >= 0.0 ? 0.0 : da / ( da - db );
      float fb = db >= 0.0 ? 1.0 : da / ( da - db );
      float t0 = mix( ta, tb, fa );
      float t1 = mix( ta, tb, fb );
      float h0 = clamp( mix( ha, hb, fa ), 0.0, deck );
      float h1 = clamp( mix( ha, hb, fb ), 0.0, deck );
      float lenM = ( t1 - t0 ) * 1000.0;
      // The scaled column: density p(h / k) and extinction sigma / k, so a
      // vertical column's depth is k-invariant (sigma Q(h / k)).
      float slope = abs( hb - ha ) / max( ( tb - ta ) * 1000.0, 1e-6 );
      float tau;
      if ( slope >= 1e-5 ) {
        tau = SHELL_SIGMA * abs( shellCumulative( h1 / uThickness ) - shellCumulative( h0 / uThickness ) ) / slope;
      } else {
        float hm = 0.5 * ( h0 + h1 ) / uThickness;
        tau = SHELL_SIGMA / uThickness * clamp( hm / SHELL_SOFT, 0.0, 1.0 ) * lenM;
      }
      float a = 1.0 - exp( -tau );
      // The slab's aerial melt, by the law's share (twin of its w).
      float w = limb * mix( 1.0, exp( -0.5 * ( t0 + t1 ) / SHELL_AERIAL_KM ), uAerial );
      float c0 = clamp( mix( ra, rb, fa ), 0.0, deck );
      float c1 = clamp( mix( ra, rb, fb ), 0.0, deck );
      highp float sunA = sunScale * ( shellCumulative( c0 / uThickness ) - shellCumulative( min( h0, c0 ) / uThickness ) );
      highp float sunB = sunScale * ( shellCumulative( c1 / uThickness ) - shellCumulative( min( h1, c1 ) / uThickness ) );
      float noise = mix( na, nb, 0.5 * ( fa + fb ) );
      float th = 0.5 * ( tha + thb );
      float density = smoothstep( 0.0, 1.0, clamp( ( noise - th ) / ( 2.0 * SHELL_EDGE ) + 0.5, 0.0, 1.0 ) );
      vec3 under = sunUnder * ( 1.0 - SHELL_THICKNESS_DARK * density ) + skyUnder;
      colour += transmittance * w * ( under * a + ( top - under ) * shellInStepLight( tau, sunA, sunB ) );
      alpha += transmittance * a * w;
      transmittance *= exp( -tau );
      if ( transmittance < SHELL_EARLY_EXIT ) break;
    }
    ta = tb; ra = rb; ha = hb; na = nb; tha = thb;
  }
  if ( alpha < 1e-4 ) discard;
  // Premultiplied, in the scene's units.
  vec3 lit = min( colour / alpha * uRadiance, vec3( SHELL_MAX_RADIANCE ) );
  float outAlpha = min( alpha, 1.0 ) * pixelWeight;
  gl_FragColor = vec4( lit * outAlpha, outAlpha );
}`;

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/**
 * The mix: the shell and the slab premultiplied, each by its weight, never
 * one over the other; then straight colour, three's tone mapping and colour
 * space, and the alpha blended over the frame (the slab's own composite).
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tShell;
uniform sampler2D tSlab;
uniform float uShellWeight;
uniform float uSlabWeight;
varying vec2 vUv;
void main() {
  vec4 c = uShellWeight * texture2D( tShell, vUv );
  if ( uSlabWeight > 0.0 ) c += uSlabWeight * texture2D( tSlab, vUv );
  if ( c.a < 1e-4 ) discard;
  gl_FragColor = vec4( c.rgb / c.a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = min( c.a, 1.0 );
}`;

/** A full-screen triangle with `material`, in its own scene. */
function fullScreen(material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, geometry };
}

/**
 * The spherical cloud volume for `renderer`: `ellipsoid` the globe's,
 * `surfaceUniforms` the surface's (the map, its drift and opacity),
 * `groundSky` the ground sky's atmosphere (the live field: its lattice,
 * amplitudes and anchor, which the cloud volume carries), `atmosphere` the
 * space pass (its sun transmittance table), `sceneDepth` the relief's.
 */
export function createGlobeCloudShellVolume(
  renderer,
  { ellipsoid, surfaceUniforms, groundSky, atmosphere, sceneDepth },
) {
  const { x: ra, y: rb, z: rc } = ellipsoid.radius;
  const groundKm = EARTH_ATMOSPHERE.groundRadiusKm;
  const toModel = [groundKm / ra, groundKm / rb, groundKm / rc];
  const scaleToModel = new THREE.Matrix3().set(
    ...[toModel[0], 0, 0, 0, toModel[1], 0, 0, 0, toModel[2]],
  );
  const basis = [];
  const octaveCount = groundSky.cloudUniforms.atmCloudLiveBasis.value.length;
  /** The two fields' bases (the upper station's and the lower one's). */
  const basisVectors = [0, 1].map(() =>
    Array.from({ length: octaveCount }, () => new THREE.Vector4()),
  );
  const frameMatrix = new THREE.Matrix4();
  const uniforms = {
    atmTransmittanceLut: { value: null },
    uInverseProjection: { value: new THREE.Matrix4() },
    uViewToModel: { value: new THREE.Matrix3() },
    uCamera: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uRadiance: { value: 0 },
    uSceneDepth: { value: null },
    uSceneInverseProjection: { value: new THREE.Matrix4() },
    uSceneDepthWeight: { value: 0 },
    uTargetSize: { value: new THREE.Vector2(1, 1) },
    uPixelAngle: { value: 0 },
    uDeckBaseKm: { value: 0 },
    uDeckTopKm: { value: 0 },
    uThickness: { value: 1 },
    uSteps: { value: 8 },
    uOctaves: { value: 5 },
    uCells: { value: new THREE.Vector2(1, 1) },
    uFieldWeights: { value: new THREE.Vector2(1, 0) },
    uAerial: { value: 0 },
    uNoiseShare: { value: 1 },
    uClouds: surfaceUniforms.uClouds,
    uCloudCubic: surfaceUniforms.uCloudCubic,
    uCloudOpacity: surfaceUniforms.uCloudOpacity,
    uCoverGain: { value: 1 },
    uShellIn: { value: 0 },
    uSlabShare: { value: 0 },
    uDiscCentre: { value: new THREE.Vector3(0, 0, 1) },
    uDiscRadiusKm: { value: 1 },
    uCoverThresholds: { value: [...cloudCoverThresholds("live")] },
    uLattice: groundSky.cloudUniforms.atmCloudLattice,
    uBasis: { value: basisVectors[0] },
    uBasisB: { value: basisVectors[1] },
    uAmp: groundSky.cloudUniforms.atmCloudLiveAmp,
    uZenith: {
      value: ZENITH_TABLE.map((rgb) => new THREE.Vector3().fromArray(rgb)),
    },
    uShellWorldFromEcef: { value: frameMatrix },
    uShellRadii: { value: new THREE.Vector3(ra, rb, rc) },
    uShellGroundKm: { value: groundKm },
    uShellGaussianM: { value: 6_371_000 },
    uShellLonOffset: surfaceUniforms.uCloudLonOffset,
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const march = fullScreen(material);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  const compositeUniforms = {
    tShell: { value: target.texture },
    tSlab: { value: null },
    uShellWeight: { value: 0 },
    uSlabWeight: { value: 0 },
  };
  const composite = new THREE.ShaderMaterial({
    uniforms: compositeUniforms,
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const compositeQuad = fullScreen(composite);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const ecefFromWorld = new THREE.Matrix4();
  const rotation = new THREE.Matrix3();
  const cameraEcef = new THREE.Vector3();
  const discEcef = new THREE.Vector3();
  const size = new THREE.Vector2();
  const clearColour = new THREE.Color();
  let enabled = false;
  let resolution = 1;
  let shellIn = 0;
  let weight = 0;
  let slabWeight = 0;
  let law = cloudShellVolumeLaw(CLOUD_SHELL_VOLUME.topKm);
  let drawn = 0;
  let framed = false;

  return {
    /** On or off (`cloudShellVolume`); idempotent. */
    setEnabled(on) {
      enabled = Boolean(on);
    },
    get enabled() {
      return enabled;
    },
    /** The march's resolution, a share of the drawing buffer (0.25-1). */
    setResolution(share) {
      if (!(share >= 0.25 && share <= 1)) {
        throw new RangeError(`the resolution must be 0.25-1, got ${share}`);
      }
      resolution = share;
    },
    /**
     * This frame's law and shares: `altitudeKm` the camera's height,
     * `shares` from `cloudShellVolumeShares` (`shellIn`, `shell`, `slab`),
     * `stations` the law's, `target` the frame's (degrees; null: nothing is
     * drawn, the chart needs a frame), `deckKm` the deck's middle over the
     * ground, `cover` the volume's gain. Returns `{ weight, slabWeight }`.
     */
    update({ altitudeKm, shares, stations, target, deckKm, cover = 1 }) {
      framed = target !== null;
      law = cloudShellVolumeLaw(altitudeKm, stations);
      shellIn = enabled && framed ? shares.shellIn : 0;
      weight = enabled && framed ? shares.shell : 0;
      slabWeight = enabled && framed ? shares.slab : 0;
      if (!enabled || !framed) return { weight, slabWeight };
      const half =
        ((CLOUD_SLAB.topM - CLOUD_SLAB.baseM) / 2000) * law.thicknessScale;
      uniforms.uDeckBaseKm.value = deckKm - half;
      uniforms.uDeckTopKm.value = deckKm + half;
      uniforms.uThickness.value = law.thicknessScale;
      uniforms.uSteps.value = law.marchSteps;
      uniforms.uOctaves.value = law.octaves;
      uniforms.uNoiseShare.value = law.noiseShare;
      uniforms.uAerial.value = law.aerial;
      uniforms.uCells.value.set(law.cells[0], law.cells[1]);
      const [wa, wb] = cloudShellFieldWeights(law.cellMix);
      uniforms.uFieldWeights.value.set(wa, wb);
      uniforms.uCoverGain.value = cover;
      uniforms.uShellIn.value = shellIn;
      const frame = cloudShellFrame(ellipsoid, target, groundKm, frameMatrix);
      uniforms.uShellGaussianM.value = frame.gaussianRadiusM;
      // Each field's basis: the slab's at scale 1 (the same field), else
      // the carried anchor over the scale (the same ground-anchored field,
      // its cells larger, fixed while the scale is).
      const anchor = groundSky.cloudNoiseAnchor;
      law.cells.forEach((s, f) => {
        const out = basisVectors[f];
        if (s === 1) {
          groundSky.cloudUniforms.atmCloudLiveBasis.value.forEach((v, k) =>
            out[k].copy(v),
          );
          return;
        }
        cloudLiveBasis(
          {
            originKm: [anchor.originKm[0] / s, anchor.originKm[1] / s],
            rotationRad: anchor.rotationRad,
          },
          {},
          basis,
        );
        out.forEach((v, k) =>
          v.set(
            basis[4 * k],
            basis[4 * k + 1],
            basis[4 * k + 2],
            basis[4 * k + 3],
          ),
        );
      });
      return { weight, slabWeight };
    },
    /**
     * Draws the shell into its target and the mix of it and the slab
     * (`slabTexture`, drawn this frame at its full share, or null) over the
     * frame. `camera` the globe's, `worldFromEcef` the frame's placement,
     * `sunEcef` a unit vector, `sunIntensity` the scene's sun,
     * `sceneDepthWeight` how much the relief's depth ends the rays (the
     * space pass's). Returns whether anything was drawn.
     */
    render(
      camera,
      {
        worldFromEcef,
        sunEcef,
        sunIntensity,
        slabTexture = null,
        sceneDepthWeight = 0,
        disc = null,
      },
    ) {
      if (!enabled || !framed || (weight <= 0 && slabWeight <= 0)) {
        return false;
      }
      const lut = atmosphere.transmittance();
      if (lut === null) return false;
      uniforms.atmTransmittanceLut.value = lut;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.round(size.x * resolution));
      const h = Math.max(1, Math.round(size.y * resolution));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      uniforms.uTargetSize.value.set(w, h);
      const depthOn = sceneDepth?.fresh === true && sceneDepthWeight > 0;
      uniforms.uSceneDepthWeight.value = depthOn ? sceneDepthWeight : 0;
      if (depthOn) {
        uniforms.uSceneDepth.value = sceneDepth.texture;
        uniforms.uSceneInverseProjection.value.copy(
          sceneDepth.camera.projectionMatrixInverse,
        );
      }
      ecefFromWorld.copy(worldFromEcef).invert();
      uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uViewToModel.value
        .copy(scaleToModel)
        .multiply(rotation.setFromMatrix4(ecefFromWorld))
        .multiply(rotation.setFromMatrix4(camera.matrixWorld));
      cameraEcef.setFromMatrixPosition(camera.matrixWorld);
      cameraEcef.applyMatrix4(ecefFromWorld);
      uniforms.uCamera.value.set(
        cameraEcef.x * toModel[0],
        cameraEcef.y * toModel[1],
        cameraEcef.z * toModel[2],
      );
      uniforms.uSun.value
        .set(
          sunEcef.x * toModel[0],
          sunEcef.y * toModel[1],
          sunEcef.z * toModel[2],
        )
        .normalize();
      uniforms.uRadiance.value = sunIntensity / ATMOSPHERE_RADIANCE_SCALE;
      // The slab's disc in the model frame (R4d review, finding 1): its
      // centre (world x, z on the deck; the camera's ground point when the
      // slab centres on the camera) and its radius; no slab drawn, no share.
      const slabOn =
        slabTexture !== null &&
        slabWeight > 0 &&
        disc !== null &&
        disc.radiusM > 0;
      uniforms.uSlabShare.value = slabOn ? slabWeight : 0;
      if (slabOn) {
        const centre = disc.centre ?? {
          x: camera.matrixWorld.elements[12],
          z: camera.matrixWorld.elements[14],
        };
        discEcef
          .set(centre.x, disc.deckY, centre.z)
          .applyMatrix4(ecefFromWorld);
        uniforms.uDiscCentre.value.set(
          discEcef.x * toModel[0],
          discEcef.y * toModel[1],
          discEcef.z * toModel[2],
        );
        uniforms.uDiscRadiusKm.value = disc.radiusM / 1000;
      }
      // Radians a pixel of the march's target (km of footprint per km).
      uniforms.uPixelAngle.value =
        2 / (camera.projectionMatrix.elements[5] * h);
      const previous = renderer.getRenderTarget();
      if (shellIn > 0) {
        renderer.getClearColor(clearColour);
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(target);
        renderer.clear(true, false, false);
        renderer.render(march.scene, quadCamera);
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.setRenderTarget(previous);
      }
      // The shell weighs itself per pixel by the slab's disc; here only its
      // own fade-in (C2 per pixel, `cloudShellPixelWeight`).
      compositeUniforms.uShellWeight.value = shellIn;
      compositeUniforms.tSlab.value = slabTexture;
      compositeUniforms.uSlabWeight.value =
        slabTexture === null ? 0 : slabWeight;
      renderer.render(compositeQuad.scene, quadCamera);
      drawn += 1;
      return true;
    },
    /**
     * The last shell target read back (debug, slow): its mean alpha and the
     * share of its pixels over 0.05, by `bands` horizontal bands from the
     * bottom up when asked. Null before a frame was drawn.
     */
    readBack(bands = 1) {
      if (drawn === 0) return null;
      const w = target.width;
      const h = target.height;
      const pixels = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
      const out = [];
      for (let band = 0; band < bands; band++) {
        const y0 = Math.floor((band * h) / bands);
        const y1 = Math.floor(((band + 1) * h) / bands);
        let sum = 0;
        let over = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < w; x++) {
            const a = THREE.DataUtils.fromHalfFloat(
              pixels[(y * w + x) * 4 + 3],
            );
            sum += a;
            if (a > 0.05) over += 1;
          }
        }
        const n = Math.max(1, (y1 - y0) * w);
        out.push({ meanAlpha: sum / n, over: over / n });
      }
      return out;
    },
    /**
     * The last shell target's alpha at an `nx` x `ny` grid of pixel
     * centres, bottom row first (debug, slow). Null before a frame.
     */
    alphaGrid(nx, ny) {
      if (drawn === 0) return null;
      const w = target.width;
      const h = target.height;
      const pixels = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
      const out = new Array(nx * ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = Math.min(w - 1, Math.floor(((i + 0.5) * w) / nx));
          const y = Math.min(h - 1, Math.floor(((j + 0.5) * h) / ny));
          out[j * nx + i] = THREE.DataUtils.fromHalfFloat(
            pixels[(y * w + x) * 4 + 3],
          );
        }
      }
      return out;
    },
    state() {
      return {
        enabled,
        framed,
        share: shellIn,
        weight,
        slabWeight,
        resolution,
        law: { ...law },
        deckKm: [uniforms.uDeckBaseKm.value, uniforms.uDeckTopKm.value],
        drawn,
      };
    },
    dispose() {
      target.dispose();
      material.dispose();
      composite.dispose();
      march.geometry.dispose();
      compositeQuad.geometry.dispose();
    },
  };
}
