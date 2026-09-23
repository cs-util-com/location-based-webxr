/**
 * The atmosphere's GLSL, generated from the TypeScript model.
 *
 * EVERY FUNCTION HERE HAS A CPU TWIN, and the pairing is the design:
 *
 * - `atmOpticalDepthToTop` ↔ `atmosphere-model.ts` `opticalDepthToTop`
 * - the mapping functions ↔ `atmosphere-lut-mapping.ts`
 * - `atmMedium`, the phases, the multi-scattering and sky-view passes ↔
 *   `atmosphere-scattering.ts`
 *
 * The CPU side is where the physics is tested; this side is only checked in a
 * real browser (the look-dev smoke compiles it, draws it, and reads LUT texels
 * back against the CPU twin). So every constant is INTERPOLATED from the model
 * rather than typed twice, and the structure follows the TS function by
 * function, so a reader can diff them by eye.
 *
 * NAMING: every identifier carries an `atm` / `ATM_` prefix. The haze patch
 * injects this code into three.js's own programs, whose `common` chunk already
 * defines `saturate`, `luminance` and more; an unprefixed helper would collide
 * there and fail to compile, silently (the material just stops drawing).
 *
 * RADIANCE SCALE: the scattering LUTs store radiance for a sun of illuminance
 * {@link ATMOSPHERE_RADIANCE_SCALE} rather than 1. Twilight radiance for a
 * unit sun is ~1e-6…1e-5 at a sun of −4…−6° (measured in the multi-scattering
 * sweep recorded in the private plan's §10), inside half-float's subnormal
 * range (< 6.1e-5), where it would band; ×1000 lifts it to 1e-3…1e-2, normal
 * floats, while the brightest Mie glow stays far below half-float's 65504.
 * Deep twilight near −9° (~1e-8) still lands at ~1e-5, subnormal: accepted,
 * because the sky there is effectively black.
 *
 * GLSL dialect: three.js "GLSL1-style" ShaderMaterial (`gl_FragColor`,
 * `texture2D`), which three maps onto WebGL2's GLSL ES 3.0.
 *
 * @see atmosphere-glsl.ts.md
 */

import {
  MULTI_SCATTERING_LUT_SIZE,
  SKY_VIEW_LUT_SIZE,
  TRANSMITTANCE_LUT_SIZE,
} from './atmosphere-lut-mapping.js';
import { EARTH_ATMOSPHERE } from './atmosphere-model.js';
import { glslFloat } from '../../utils/glsl-float.js';
import { CLOUD_LAYER } from './cloud-layer.js';

/** Sun illuminance the scattering LUTs are computed for. See the header. */
export const ATMOSPHERE_RADIANCE_SCALE = 1000;

/**
 * The most the visible sky ever writes, in scene units. Below the largest
 * finite half float (65 504): a composer renders the sky into a half-float
 * target, and the golden-hour sun disc (auto-exposure ×22 on ~15 000× the
 * sky's radiance) overflowed it to Inf, which bloom then spread over the
 * whole frame (M4). Visually lossless on the direct path for every tone
 * mapper three offers (≤ 0 levels at this height; M4 review, finding 6: a
 * clamp as low as 16 would shift Neutral's highlights by up to 29 levels).
 */
export const ATMOSPHERE_MAX_SCENE_RADIANCE = 60000;

function glslVec3(v: readonly [number, number, number]): string {
  return `vec3(${glslFloat(v[0])}, ${glslFloat(v[1])}, ${glslFloat(v[2])})`;
}

const A = EARTH_ATMOSPHERE;

/**
 * Constants, geometry, the medium, phases and LUT mappings. Needs the uniform
 * `atmMieExtinction` (sea-level Mie extinction, /km, from
 * `mieExtinctionForVisibility`).
 */
export const ATMOSPHERE_COMMON_GLSL = /* glsl */ `
#define ATM_PI 3.141592653589793
const float ATM_GROUND_RADIUS = ${glslFloat(A.groundRadiusKm)};
const float ATM_TOP_RADIUS = ${glslFloat(A.topRadiusKm)};
const vec3 ATM_RAYLEIGH_SCATTERING = ${glslVec3(A.rayleighScatteringPerKm)};
const float ATM_RAYLEIGH_SCALE_HEIGHT = ${glslFloat(A.rayleighScaleHeightKm)};
const float ATM_MIE_ALBEDO = ${glslFloat(A.mieAlbedo)};
const float ATM_MIE_SCALE_HEIGHT = ${glslFloat(A.mieScaleHeightKm)};
const float ATM_MIE_G = ${glslFloat(A.miePhaseG)};
const vec3 ATM_OZONE_ABSORPTION = ${glslVec3(A.ozoneAbsorptionPerKm)};
const float ATM_OZONE_CENTRE = ${glslFloat(A.ozoneCentreKm)};
const float ATM_OZONE_HALF_WIDTH = ${glslFloat(A.ozoneHalfWidthKm)};
const float ATM_GROUND_ALBEDO = ${glslFloat(A.groundAlbedo)};
const float ATM_SUN_ANGULAR_RADIUS = ${glslFloat(A.sunAngularRadiusRad)};
const float ATM_SUN_LIMB_DARKENING = ${glslFloat(A.sunLimbDarkening)};
const float ATM_RADIANCE_SCALE = ${glslFloat(ATMOSPHERE_RADIANCE_SCALE)};
const float ATM_HORIZON_CLAMP = ${glslFloat(A.horizonClampDirY)};
const vec2 ATM_TRANSMITTANCE_SIZE = vec2(${glslFloat(TRANSMITTANCE_LUT_SIZE.width)}, ${glslFloat(TRANSMITTANCE_LUT_SIZE.height)});
const vec2 ATM_MULTI_SCATTERING_SIZE = vec2(${glslFloat(MULTI_SCATTERING_LUT_SIZE.width)}, ${glslFloat(MULTI_SCATTERING_LUT_SIZE.height)});
const vec2 ATM_SKY_VIEW_SIZE = vec2(${glslFloat(SKY_VIEW_LUT_SIZE.width)}, ${glslFloat(SKY_VIEW_LUT_SIZE.height)});

uniform float atmMieExtinction;

float atmDistanceToTop(float r, float mu) {
  float discriminant = r * r * (mu * mu - 1.0) + ATM_TOP_RADIUS * ATM_TOP_RADIUS;
  return max(0.0, -r * mu + sqrt(max(0.0, discriminant)));
}

float atmHorizonMu(float r) {
  float ratio = ATM_GROUND_RADIUS / r;
  return -sqrt(max(0.0, 1.0 - ratio * ratio));
}

bool atmRayHitsGround(float r, float mu) {
  return mu < atmHorizonMu(r);
}

float atmDistanceToGround(float r, float mu) {
  float b = r * mu;
  float c = r * r - ATM_GROUND_RADIUS * ATM_GROUND_RADIUS;
  return max(0.0, -b - sqrt(max(0.0, b * b - c)));
}

void atmMedium(float altitude, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float rayleighDensity = exp(-altitude / ATM_RAYLEIGH_SCALE_HEIGHT);
  float mieExtinction = atmMieExtinction * exp(-altitude / ATM_MIE_SCALE_HEIGHT);
  float ozone = max(0.0, 1.0 - abs(altitude - ATM_OZONE_CENTRE) / ATM_OZONE_HALF_WIDTH);
  rayleighScattering = ATM_RAYLEIGH_SCATTERING * rayleighDensity;
  mieScattering = mieExtinction * ATM_MIE_ALBEDO;
  extinction = rayleighScattering + vec3(mieExtinction) + ATM_OZONE_ABSORPTION * ozone;
}

float atmRayleighPhase(float cosTheta) {
  return (3.0 / (16.0 * ATM_PI)) * (1.0 + cosTheta * cosTheta);
}

float atmMiePhase(float cosTheta) {
  float g2 = ATM_MIE_G * ATM_MIE_G;
  float num = (1.0 - g2) * (1.0 + cosTheta * cosTheta);
  float den = (2.0 + g2) * pow(1.0 + g2 - 2.0 * ATM_MIE_G * cosTheta, 1.5);
  return (3.0 / (8.0 * ATM_PI)) * num / den;
}

float atmTexelToUnit(float x, float size) {
  return (x - 0.5 / size) / (1.0 - 1.0 / size);
}

float atmUnitToTexel(float x, float size) {
  return 0.5 / size + x * (1.0 - 1.0 / size);
}

const float ATM_H = ${glslFloat(Math.sqrt(A.topRadiusKm ** 2 - A.groundRadiusKm ** 2))};

void atmTransmittanceUvToParams(vec2 unit, out float r, out float mu) {
  float rho = ATM_H * unit.y;
  r = sqrt(rho * rho + ATM_GROUND_RADIUS * ATM_GROUND_RADIUS);
  float dMin = ATM_TOP_RADIUS - r;
  float dMax = rho + ATM_H;
  float d = dMin + unit.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (ATM_H * ATM_H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}

vec2 atmTransmittanceParamsToUv(float r, float mu) {
  float rho = sqrt(max(0.0, r * r - ATM_GROUND_RADIUS * ATM_GROUND_RADIUS));
  float d = atmDistanceToTop(r, mu);
  float dMin = ATM_TOP_RADIUS - r;
  float dMax = rho + ATM_H;
  return vec2((d - dMin) / (dMax - dMin), rho / ATM_H);
}

vec3 atmSampleTransmittance(sampler2D lut, float r, float mu) {
  if (atmRayHitsGround(r, mu)) return vec3(0.0);
  vec2 unit = atmTransmittanceParamsToUv(r, mu);
  vec2 uv = vec2(
    atmUnitToTexel(unit.x, ATM_TRANSMITTANCE_SIZE.x),
    atmUnitToTexel(unit.y, ATM_TRANSMITTANCE_SIZE.y)
  );
  return texture2D(lut, uv).rgb;
}

vec3 atmSampleMultiScattering(sampler2D lut, float r, float sunCosZenith) {
  vec2 unit = vec2(
    sunCosZenith * 0.5 + 0.5,
    // Quadratic altitude rows, twin of multiScatteringParamsToUv.
    sqrt(clamp((r - ATM_GROUND_RADIUS) / (ATM_TOP_RADIUS - ATM_GROUND_RADIUS), 0.0, 1.0))
  );
  vec2 uv = vec2(
    atmUnitToTexel(unit.x, ATM_MULTI_SCATTERING_SIZE.x),
    atmUnitToTexel(unit.y, ATM_MULTI_SCATTERING_SIZE.y)
  );
  return texture2D(lut, uv).rgb;
}

void atmHorizonAngles(float r, out float zenithHorizon, out float beta) {
  beta = acos(sqrt(max(0.0, r * r - ATM_GROUND_RADIUS * ATM_GROUND_RADIUS)) / r);
  zenithHorizon = ATM_PI - beta;
}

void atmSkyViewUvToParams(float r, vec2 unit, out float viewZenith, out float deltaAzimuth) {
  float zenithHorizon;
  float beta;
  atmHorizonAngles(r, zenithHorizon, beta);
  if (unit.y < 0.5) {
    float c = 1.0 - 2.0 * unit.y;
    viewZenith = zenithHorizon * (1.0 - c * c);
  } else {
    float c = 2.0 * unit.y - 1.0;
    viewZenith = zenithHorizon + beta * c * c;
  }
  deltaAzimuth = ATM_PI * unit.x * unit.x;
}

vec2 atmSkyViewParamsToUv(float r, float viewZenith, float deltaAzimuth) {
  float zenithHorizon;
  float beta;
  atmHorizonAngles(r, zenithHorizon, beta);
  float v;
  if (viewZenith < zenithHorizon) {
    float c = max(0.0, 1.0 - viewZenith / zenithHorizon);
    v = (1.0 - sqrt(c)) * 0.5;
  } else {
    float c = max(0.0, (viewZenith - zenithHorizon) / beta);
    v = sqrt(c) * 0.5 + 0.5;
  }
  float u = sqrt(clamp(deltaAzimuth / ATM_PI, 0.0, 1.0));
  return vec2(u, v);
}

// A view direction lifted to at least ATM_HORIZON_CLAMP: the sky just above
// the horizon, used by the haze and by the visible sky below the horizon, so
// both show the same colour at the far plane.
vec3 atmHorizonClampedDir(vec3 dir) {
  return normalize(vec3(dir.x, max(dir.y, ATM_HORIZON_CLAMP), dir.z));
}

// View direction (world, +y up) → sky-view LUT texture coordinate, for a sun
// direction in the same frame. The azimuth is measured from the sun's
// vertical plane; the sky is mirror-symmetric about it.
vec2 atmSkyViewUv(float r, vec3 viewDir, vec3 sunDir) {
  float viewZenith = acos(clamp(viewDir.y, -1.0, 1.0));
  vec2 viewH = viewDir.xz;
  vec2 sunH = sunDir.xz;
  float deltaAzimuth = 0.0;
  if (dot(viewH, viewH) > 1e-10 && dot(sunH, sunH) > 1e-10) {
    deltaAzimuth = acos(clamp(dot(normalize(viewH), normalize(sunH)), -1.0, 1.0));
  }
  vec2 unit = atmSkyViewParamsToUv(r, viewZenith, deltaAzimuth);
  return vec2(atmUnitToTexel(unit.x, ATM_SKY_VIEW_SIZE.x), atmUnitToTexel(unit.y, ATM_SKY_VIEW_SIZE.y));
}
`;

/** Vertex shader for the LUT passes: a full-screen triangle, no varyings. */
export const ATMOSPHERE_LUT_VERTEX_GLSL = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Transmittance LUT: one texel = exp(−optical depth) from (r, mu) to space. */
export const TRANSMITTANCE_LUT_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
const int ATM_OPTICAL_DEPTH_STEPS = ${A.opticalDepthSteps};

vec3 atmOpticalDepthToTop(float r, float mu) {
  float len = atmDistanceToTop(r, mu);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < ATM_OPTICAL_DEPTH_STEPS; i++) {
    float t0 = float(i) / float(ATM_OPTICAL_DEPTH_STEPS);
    float t1 = float(i + 1) / float(ATM_OPTICAL_DEPTH_STEPS);
    float tm = (float(i) + 0.5) / float(ATM_OPTICAL_DEPTH_STEPS);
    float s = tm * tm * len;
    float ds = (t1 * t1 - t0 * t0) * len;
    float radius = sqrt(r * r + s * s + 2.0 * r * s * mu);
    vec3 rs; float ms; vec3 extinction;
    atmMedium(radius - ATM_GROUND_RADIUS, rs, ms, extinction);
    depth += extinction * ds;
  }
  return depth;
}

void main() {
  vec2 uv = gl_FragCoord.xy / ATM_TRANSMITTANCE_SIZE;
  float r; float mu;
  atmTransmittanceUvToParams(
    vec2(atmTexelToUnit(uv.x, ATM_TRANSMITTANCE_SIZE.x), atmTexelToUnit(uv.y, ATM_TRANSMITTANCE_SIZE.y)),
    r, mu
  );
  gl_FragColor = vec4(exp(-atmOpticalDepthToTop(r, mu)), 1.0);
}
`;

/** Multi-scattering LUT (Hillaire §5.5): Ψ = L2 / (1 − f_ms), radiance-scaled. */
export const MULTI_SCATTERING_LUT_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
const int ATM_MS_SQRT_DIRECTIONS = ${A.multiScatteringSqrtDirections};
const int ATM_MS_STEPS = ${A.multiScatteringSteps};

void main() {
  vec2 uv = gl_FragCoord.xy / ATM_MULTI_SCATTERING_SIZE;
  float sunCosZenith = 2.0 * atmTexelToUnit(uv.x, ATM_MULTI_SCATTERING_SIZE.x) - 1.0;
  // Quadratic altitude rows, twin of multiScatteringUvToParams.
  float rowUnit = atmTexelToUnit(uv.y, ATM_MULTI_SCATTERING_SIZE.y);
  float r = ATM_GROUND_RADIUS
    + rowUnit * rowUnit * (ATM_TOP_RADIUS - ATM_GROUND_RADIUS);
  // Keep the sample point strictly inside the shell: at exactly the ground
  // every downward ray has length zero and the texel would be empty.
  r = clamp(r, ATM_GROUND_RADIUS + 0.001, ATM_TOP_RADIUS - 0.001);
  vec3 origin = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - sunCosZenith * sunCosZenith)), sunCosZenith, 0.0);
  float isotropic = 1.0 / (4.0 * ATM_PI);
  vec3 l2 = vec3(0.0);
  vec3 fms = vec3(0.0);
  for (int i = 0; i < ATM_MS_SQRT_DIRECTIONS; i++) {
    for (int j = 0; j < ATM_MS_SQRT_DIRECTIONS; j++) {
      float azimuth = 2.0 * ATM_PI * (float(i) + 0.5) / float(ATM_MS_SQRT_DIRECTIONS);
      float zenith = acos(1.0 - 2.0 * (float(j) + 0.5) / float(ATM_MS_SQRT_DIRECTIONS));
      vec3 dir = vec3(sin(zenith) * cos(azimuth), cos(zenith), sin(zenith) * sin(azimuth));
      bool hitsGround = atmRayHitsGround(r, dir.y);
      float len = hitsGround ? atmDistanceToGround(r, dir.y) : atmDistanceToTop(r, dir.y);
      vec3 throughput = vec3(1.0);
      for (int k = 0; k < ATM_MS_STEPS; k++) {
        // Quadratic placement, twin of multiScattering (see its comment).
        float t0 = float(k) / float(ATM_MS_STEPS);
        float t1 = float(k + 1) / float(ATM_MS_STEPS);
        float tm = (float(k) + 0.5) / float(ATM_MS_STEPS);
        float t = tm * tm * len;
        float dt = (t1 * t1 - t0 * t0) * len;
        vec3 p = origin + dir * t;
        float pr = length(p);
        vec3 rs; float ms; vec3 extinction;
        atmMedium(pr - ATM_GROUND_RADIUS, rs, ms, extinction);
        vec3 sunT = atmSampleTransmittance(atmTransmittanceLut, pr, dot(p, sun) / pr);
        vec3 scattering = rs + vec3(ms);
        vec3 sigma = max(extinction, vec3(1e-9));
        vec3 stepT = exp(-sigma * dt);
        vec3 inScatter = scattering * isotropic * sunT;
        l2 += throughput * (inScatter - inScatter * stepT) / sigma;
        fms += throughput * (scattering - scattering * stepT) / sigma;
        throughput *= stepT;
      }
      if (hitsGround) {
        vec3 p = origin + dir * len;
        float pr = length(p);
        float normalDotSun = max(0.0, dot(p, sun) / pr);
        vec3 sunT = atmSampleTransmittance(atmTransmittanceLut, pr, dot(p, sun) / pr);
        l2 += throughput * sunT * normalDotSun * ATM_GROUND_ALBEDO / ATM_PI;
      }
    }
  }
  float n = float(ATM_MS_SQRT_DIRECTIONS * ATM_MS_SQRT_DIRECTIONS);
  l2 /= n;
  fms /= n;
  gl_FragColor = vec4(ATM_RADIANCE_SCALE * l2 / (vec3(1.0) - fms), 1.0);
}
`;

/** Sky-view LUT (Hillaire §5.3): sky radiance for the current sun, radiance-scaled. */
export const SKY_VIEW_LUT_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
uniform sampler2D atmMultiScatteringLut;
uniform float atmSunCosZenith;
uniform float atmObserverRadius;
const int ATM_SKY_VIEW_STEPS = ${A.skyViewSteps};

void main() {
  vec2 uv = gl_FragCoord.xy / ATM_SKY_VIEW_SIZE;
  float r = atmObserverRadius;
  float viewZenith; float deltaAzimuth;
  atmSkyViewUvToParams(
    r,
    vec2(atmTexelToUnit(uv.x, ATM_SKY_VIEW_SIZE.x), atmTexelToUnit(uv.y, ATM_SKY_VIEW_SIZE.y)),
    viewZenith, deltaAzimuth
  );
  vec3 origin = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - atmSunCosZenith * atmSunCosZenith)), atmSunCosZenith, 0.0);
  vec3 dir = vec3(sin(viewZenith) * cos(deltaAzimuth), cos(viewZenith), sin(viewZenith) * sin(deltaAzimuth));
  float cosTheta = dot(dir, sun);
  float phaseR = atmRayleighPhase(cosTheta);
  float phaseM = atmMiePhase(cosTheta);
  bool hitsGround = atmRayHitsGround(r, dir.y);
  float len = hitsGround ? atmDistanceToGround(r, dir.y) : atmDistanceToTop(r, dir.y);
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  for (int k = 0; k < ATM_SKY_VIEW_STEPS; k++) {
    float t0 = float(k) / float(ATM_SKY_VIEW_STEPS);
    float t1 = float(k + 1) / float(ATM_SKY_VIEW_STEPS);
    float tm = (float(k) + 0.5) / float(ATM_SKY_VIEW_STEPS);
    float t = tm * tm * len;
    float dt = (t1 * t1 - t0 * t0) * len;
    vec3 p = origin + dir * t;
    float pr = length(p);
    float sampleSunCos = dot(p, sun) / pr;
    vec3 rs; float ms; vec3 extinction;
    atmMedium(pr - ATM_GROUND_RADIUS, rs, ms, extinction);
    vec3 sunT = atmSampleTransmittance(atmTransmittanceLut, pr, sampleSunCos);
    vec3 multi = atmSampleMultiScattering(atmMultiScatteringLut, pr, sampleSunCos);
    vec3 single = ATM_RADIANCE_SCALE * sunT * (rs * phaseR + vec3(ms * phaseM));
    vec3 source = single + multi * (rs + vec3(ms));
    vec3 sigma = max(extinction, vec3(1e-9));
    vec3 stepT = exp(-sigma * dt);
    radiance += throughput * (source - source * stepT) / sigma;
    throughput *= stepT;
  }
  if (hitsGround) {
    vec3 p = origin + dir * len;
    float pr = length(p);
    float normalDotSun = max(0.0, dot(p, sun) / pr);
    vec3 sunT = atmSampleTransmittance(atmTransmittanceLut, pr, dot(p, sun) / pr);
    radiance += ATM_RADIANCE_SCALE * throughput * sunT * normalDotSun * ATM_GROUND_ALBEDO / ATM_PI;
  }
  gl_FragColor = vec4(radiance, 1.0);
}
`;

/**
 * The visible sky: a camera-centred mesh drawn at the far plane.
 *
 * `gl_Position.z = gl_Position.w` puts every fragment at depth 1, so the sky
 * is never clipped by the far plane (OsmDemo's is 2400–24 000 m and a dome
 * large enough to enclose the city would be cut away) and everything opaque
 * draws over it. Only the camera's ROTATION is applied, so the sky is at
 * infinity by construction.
 */
export const SKY_VERTEX_GLSL = /* glsl */ `
varying vec3 vAtmWorldDirection;
void main() {
  vAtmWorldDirection = (modelMatrix * vec4(position, 0.0)).xyz;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * vAtmWorldDirection, 1.0);
  gl_Position = clip.xyww;
}
`;

/**
 * The sky's fragment: sky-view LUT + an analytic limb-darkened sun disc, scaled
 * into scene units, then three's own tone mapping and output colour space.
 *
 * `atmRadianceToScene` = (scene illuminance scale × exposure) /
 * `ATMOSPHERE_RADIANCE_SCALE`, computed on the CPU, so the sky, the
 * environment map and the sun light share one scale and the lit scene and the
 * sky behind it are provably the same sky.
 */
export const SKY_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
uniform sampler2D atmSkyViewLut;
uniform vec3 atmSunDirection;
uniform float atmObserverRadius;
uniform float atmRadianceToScene;
uniform float atmSunDiscEnabled;
const float ATM_MAX_SCENE_RADIANCE = ${glslFloat(ATMOSPHERE_MAX_SCENE_RADIANCE)};
uniform sampler2D atmCloudTexture;
uniform float atmCloudCover;
uniform float atmCloudThreshold;
uniform float atmClampHorizon;
uniform vec2 atmCloudOffset;
varying vec3 vAtmWorldDirection;
const float ATM_CLOUD_ALTITUDE = ${glslFloat(CLOUD_LAYER.altitudeKm)};
const float ATM_CLOUD_TILE = ${glslFloat(CLOUD_LAYER.tileKm)};
const float ATM_CLOUD_OCTAVE2_FREQ = ${glslFloat(CLOUD_LAYER.secondOctaveFrequency)};
const float ATM_CLOUD_OCTAVE2_OFFSET = ${glslFloat(CLOUD_LAYER.secondOctaveOffset)};
const float ATM_CLOUD_OCTAVE1_WEIGHT = ${glslFloat(CLOUD_LAYER.firstOctaveWeight)};
const float ATM_CLOUD_EDGE = ${glslFloat(CLOUD_LAYER.edgeHalfWidth)};
const float ATM_CLOUD_SUN_AMBIENT = ${glslFloat(CLOUD_LAYER.sunAmbient)};
const float ATM_CLOUD_FORWARD = ${glslFloat(CLOUD_LAYER.forwardStrength)};
const float ATM_CLOUD_FORWARD_POWER = ${glslFloat(CLOUD_LAYER.forwardPower)};
const float ATM_CLOUD_THICKNESS = ${glslFloat(CLOUD_LAYER.thicknessDarkening)};
const float ATM_CLOUD_SKY_AMBIENT = ${glslFloat(CLOUD_LAYER.skyAmbient)};
const float ATM_CLOUD_AERIAL_KM = ${glslFloat(CLOUD_LAYER.aerialKm)};

// Twin of cloud-layer.ts cloudDensity: a soft step, 0.5 AT the threshold
// (the cover's quantile of the combined noise, computed on the CPU).
float atmCloudDensity(float noise, float threshold) {
  return smoothstep(0.0, 1.0, clamp((noise - threshold) / (2.0 * ATM_CLOUD_EDGE) + 0.5, 0.0, 1.0));
}

// Twin of cloud-layer.ts cloudHorizonFade.
float atmCloudHorizonFade(float dirY) {
  return smoothstep(0.0, 1.0, clamp(dirY / 0.12, 0.0, 1.0));
}

// The 2D cloud layer (DEC-SKY-6): a plane at ATM_CLOUD_ALTITUDE, lit by the
// sun's transmitted colour at that height (forward-scattering toward the
// sun), plus the zenith sky as ambient; thicker parts darker; distant parts
// melt into the sky behind them. Radiance in LUT units.
vec3 atmClouds(vec3 dir, float r, vec3 skyBehind) {
  if (atmCloudCover <= 0.0 || dir.y <= 0.0) return skyBehind;
  float t = ATM_CLOUD_ALTITUDE / dir.y;
  vec2 uv = dir.xz * t / ATM_CLOUD_TILE + atmCloudOffset;
  float noise = texture2D(atmCloudTexture, uv).r * ATM_CLOUD_OCTAVE1_WEIGHT
    + texture2D(atmCloudTexture, uv * ATM_CLOUD_OCTAVE2_FREQ + ATM_CLOUD_OCTAVE2_OFFSET).r
      * (1.0 - ATM_CLOUD_OCTAVE1_WEIGHT);
  float density = atmCloudDensity(noise, atmCloudThreshold) * atmCloudHorizonFade(dir.y);
  if (density <= 0.0) return skyBehind;
  vec3 sunAtCloud = atmSampleTransmittance(atmTransmittanceLut, r + ATM_CLOUD_ALTITUDE, atmSunDirection.y);
  float forward = pow(max(dot(dir, atmSunDirection), 0.0), ATM_CLOUD_FORWARD_POWER);
  vec3 zenith = texture2D(atmSkyViewLut, atmSkyViewUv(r, vec3(0.0, 1.0, 0.0), atmSunDirection)).rgb;
  // Twin of cloud-layer.ts cloudLitRadiance (sun term in LUT units).
  vec3 lit = ATM_RADIANCE_SCALE * sunAtCloud
      * (ATM_CLOUD_SUN_AMBIENT + ATM_CLOUD_FORWARD * forward)
      * (1.0 - ATM_CLOUD_THICKNESS * density)
    + zenith * ATM_CLOUD_SKY_AMBIENT;
  float aerial = exp(-t / ATM_CLOUD_AERIAL_KM);
  return mix(skyBehind, lit, density * aerial);
}

void main() {
  vec3 dir = normalize(vAtmWorldDirection);
  float r = atmObserverRadius;
  // The visible sky clamps below the horizon (like the haze); the bake does
  // not, so undersides keep the ground's bounce light.
  vec3 lookup = atmClampHorizon > 0.5 ? atmHorizonClampedDir(dir) : dir;
  vec3 radiance = texture2D(atmSkyViewLut, atmSkyViewUv(r, lookup, atmSunDirection)).rgb;

  // The sun disc: illuminance / (π · angular radius²), limb-darkened, dimmed by
  // the same transmittance that colours the sunset, and hidden below the
  // horizon. Anti-aliased over one pixel's worth of cos-angle.
  float cosToSun = dot(dir, atmSunDirection);
  float cosRadius = cos(ATM_SUN_ANGULAR_RADIUS);
  float edge = max(fwidth(cosToSun), 1e-7);
  float disc = smoothstep(cosRadius - edge, cosRadius + edge, cosToSun) * atmSunDiscEnabled;
  if (disc > 0.0 && !atmRayHitsGround(r, dir.y)) {
    float rho = clamp(acos(clamp(cosToSun, -1.0, 1.0)) / ATM_SUN_ANGULAR_RADIUS, 0.0, 1.0);
    // Twin of sunDiscLimbDarkening: normalised to average 1 over the disc.
    float limb = (1.0 - ATM_SUN_LIMB_DARKENING * (1.0 - sqrt(max(0.0, 1.0 - rho * rho))))
      / (1.0 - ATM_SUN_LIMB_DARKENING / 3.0);
    float sunRadiance = ATM_RADIANCE_SCALE / (ATM_PI * ATM_SUN_ANGULAR_RADIUS * ATM_SUN_ANGULAR_RADIUS);
    radiance += disc * limb * sunRadiance * atmSampleTransmittance(atmTransmittanceLut, r, dir.y);
  }

  radiance = atmClouds(dir, r, radiance);
  // Finite in a half-float target, whatever the exposure (see the constant).
  gl_FragColor = vec4(min(radiance * atmRadianceToScene, vec3(ATM_MAX_SCENE_RADIANCE)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
