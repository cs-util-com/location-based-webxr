/**
 * The terrain lab's mesh and its one shader for every style (terrain plan
 * 2026-09-27-0605 §4 "Mesh", "Shading" and "Styles"; research 2026-09-27-0600
 * §6, §7.1).
 *
 * - ONE grid over the drawn region (not the padding), a vertex every
 *   `meshStepPosts` posts; the vertex shader lifts it by the datum-relative
 *   height times `uExag`. E enters the HEIGHT only, never the shading normal
 *   (plan §9 finding 20), so exaggeration lifts the land without darkening it.
 * - The fragment shader shades per pixel from the precomputed textures, which
 *   are finer than the mesh: that is where the fine ridge texture comes from.
 * - ONE SHADER WITH A SWITCH (plan §4): `uStyle` picks A "Pastel atlas" (0),
 *   B "Natural colour" (1), D "Swiss classic" (2) or E "Clay" (3); style C
 *   is A plus the far field. Each branch mirrors its tested reference line
 *   for line: `terrain-style.js` (A), `terrain-styles.js` (B, D, E).
 * - The far field (style C, or any style with it on) mixes the globe's
 *   imagery, through three's own Neutral tone mapping chunk, under the near
 *   style by `uNearW` (`terrain-far-field.js`).
 * - Half floats only (plan §9 finding 13): RGBA16F data, RGBA8 aux, LUTs and
 *   far field, all filterable in core WebGL2, so there is no extension risk.
 * - Colours are sRGB throughout and written as they are: no tone mapping and
 *   no colour-space conversion, as a printed map. The smoke holds a rendered
 *   flat pixel to `landColour` because of this. Only the far field is tone
 *   mapped, explicitly, because the globe it must match is.
 *
 * @see terrain-material.js.md
 */
import * as THREE from "three";

import { AUX_ENCODING } from "./terrain-precompute.js";
import {
  LIGHT_AZIMUTHS_DEG,
  LUT,
  NO_DATA_COLOURS,
  PASTEL_ATLAS,
  hexToRgb,
} from "./terrain-style.js";
import {
  CLAY,
  NATURAL,
  SWISS,
  snowLineM,
  treeLineM,
} from "./terrain-styles.js";
import { GLOBE_SUN, MAP_KEY_LIGHT, SUN_GLSL } from "./terrain-sun.js";
import { GLOBE_ALBEDO } from "./terrain-globe-colour.js";
import {
  GLOBE_CLASSES,
  PROTOTYPE_LAB,
  PROTOTYPE_LINEAR,
  WATER_LINEAR,
} from "./terrain-globe-classes.js";

const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
uniform sampler2D uData;
uniform float uSide;
uniform float uExtentM;
uniform float uExag;
varying vec2 vUv;
varying vec2 vEnu;

void main() {
  // three's frame: x east, z south; the grid's rows run south to north.
  vec2 enu = vec2(position.x, -position.z);
  vEnu = enu;
  vec2 g = clamp((enu + uExtentM) / (2.0 * uExtentM), 0.0, 1.0) * (uSide - 1.0);
  vUv = (g + 0.5) / uSide;
  float h = texture2D(uData, vUv).r;
  vec3 lifted = vec3(position.x, h * uExag, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(lifted, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${THREE.ShaderChunk.tonemapping_pars_fragment}
uniform sampler2D uData;
uniform sampler2D uAux;
uniform sampler2D uLut;
uniform sampler2D uLutSwiss;
uniform sampler2D uFar;
uniform int uStyle;
uniform int uSnowMask;
uniform float uDatum;
uniform float uLutMaxM;
uniform float uStdSpanM;
uniform float uSmallMPerStep;
uniform float uGain;
uniform vec3 uLightDir[4];
uniform float uLightAz[4];
uniform vec3 uGreen;
uniform vec2 uGreenR;
uniform float uGreenAmount;
uniform float uShadow;
uniform vec3 uShadowTint;
uniform float uHighlight;
uniform vec3 uHighlightTint;
uniform float uAo;
uniform float uDetail;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uWaterDeepM;
uniform vec3 uNoData[2];
// Style B.
uniform vec3 uNatLowland;
uniform vec3 uNatLowlandLight;
uniform vec3 uNatLowlandWood;
uniform float uNatLowlandRampM;
uniform vec2 uNatWoodSpreadM;
uniform float uNatWoodAmount;
uniform float uNatGullyM;
uniform float uNatGullyAmount;
uniform vec3 uNatForest;
uniform vec3 uNatMeadow;
uniform vec3 uNatScree;
uniform vec3 uNatRock;
uniform vec3 uNatLightRock;
uniform vec3 uNatSnow;
uniform vec3 uNatSnowShade;
uniform vec3 uNatSea;
uniform vec3 uNatSeaDeep;
uniform float uNatSeaDeepM;
uniform float uTreeM;
uniform float uSnowM;
uniform float uEdgeM;
uniform float uMeadowBandM;
uniform float uAspectSnowM;
uniform float uAspectFull;
uniform float uPoleSign;
uniform float uRockDeg;
uniform float uRockSoftDeg;
uniform vec2 uSnowSlideDeg;
uniform vec2 uScreeRockDeg;
uniform float uMaxLight;
uniform float uLift;
// The key light (terrain-sun.js): unit ENU toward the sun, or the map
// styles' classic north-west light; uLightMode 1 shades A and E by it too.
uniform vec3 uSun;
uniform float uSunIntensity;
uniform int uLightMode;
// Style D.
uniform vec3 uSwissSea;
uniform vec3 uExpLight;
uniform vec3 uExpShadow;
uniform vec3 uExpLeft;
uniform vec3 uExpRight;
uniform vec3 uExpFlat;
uniform float uExpFullTilt;
uniform float uExposure;
uniform float uLowContrast;
uniform vec2 uHRange;
// Style E.
uniform vec3 uClay;
uniform vec3 uClaySea;
// globe-albedo (terrain-globe-colour.js): the imagery over the region, the
// ramp's luminance averaged over each imagery pixel's footprint, the weight.
uniform sampler2D uAlbedo;
uniform sampler2D uCoarseLum;
uniform float uAlbedoDetail;
// globe-bands (terrain-globe-colour.js): the imagery's ramp by height band
// over 0-uLutMaxM, and its sea (uBandSeaOn 0 when the region has none);
// uBandsOn 0 until the drawn region's ramp exists (style B meanwhile).
uniform sampler2D uLutBands;
uniform vec3 uBandSea;
uniform float uBandSeaOn;
uniform float uBandsOn;
// globe-classes (terrain-globe-classes.js): the imagery's land colour and
// its water share over the region (the 1 km grids), the land classes'
// prototypes (CIELAB and linear: forest, grass, rock, snow), the water's
// colour (linear), the colour kernel's width (ΔE), the affinity floor,
// water's flat-slope range (°) and the ratio's clamp.
uniform sampler2D uClassLand;
uniform sampler2D uClassWater;
uniform vec3 uClassLab[4];
uniform vec3 uClassLin[4];
uniform vec3 uClassWaterLin;
uniform float uClassWidth;
uniform float uClassFloor;
uniform vec2 uClassWaterDeg;
uniform vec2 uClassRatio;
// The far field.
uniform float uNearW;
uniform float uFarReliefW;
uniform float uHalfM;
uniform float uFarDeltaUv;
uniform float uFarDeltaM;
varying vec2 vUv;
varying vec2 vEnu;
${SUN_GLSL}

// terrain-style.js multidirectionalShade: flat ground is exactly 1.
float shade(vec2 grad) {
  if (grad.x == 0.0 && grad.y == 0.0) return 1.0;
  vec3 n = normalize(vec3(-grad * uGain, 1.0));
  float aspect = atan(-grad.x, -grad.y);
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = sin(aspect - uLightAz[i]);
    s += w * w * dot(n, uLightDir[i]) / uLightDir[i].z;
  }
  return 0.5 * s;
}

// terrain-styles.js singleLightShade for the key light: flat 1 in a clear
// sky, never negative (terrain-sun.js sunRelativeShade).
float sunShade(vec2 grad, float vis) {
  return sunRelativeShade(reliefNormal(grad, uGain), vis);
}

// terrain-styles.js naturalWeights: x forest, y meadow, z scree, w rock.
vec4 naturalCover(float h, vec2 grad, float small) {
  float slope = length(grad);
  float slopeDeg = degrees(atan(slope));
  float hE = h + clamp(small, -uEdgeM, uEdgeM);
  float treeTop = max(uTreeM - uEdgeM, 1.0);
  float forest = smoothstep(0.5 * treeTop, treeTop, h);
  float meadow = smoothstep(uTreeM - uEdgeM, uTreeM + uEdgeM, hE);
  float scree = smoothstep(
    uTreeM + uMeadowBandM - uEdgeM, uTreeM + uMeadowBandM + uEdgeM, hE);
  float rock = max(
    smoothstep(uRockDeg - uRockSoftDeg, uRockDeg + uRockSoftDeg, slopeDeg),
    scree * smoothstep(uScreeRockDeg.x, uScreeRockDeg.y, slopeDeg));
  return vec4(forest, meadow, scree, rock);
}

// terrain-styles.js naturalWeights: x snow, y bare rock above the snow line.
vec2 naturalSnow(float h, vec2 grad, float small) {
  float slope = length(grad);
  float slopeDeg = degrees(atan(slope));
  float hE = h + clamp(small, -uEdgeM, uEdgeM);
  float facing = slope > 0.0 ? uPoleSign * -grad.y / slope : 0.0;
  float aspectW = min(1.0, slope / uAspectFull);
  float localSnow = uSnowM - uAspectSnowM * facing * aspectW;
  float above = smoothstep(localSnow - uEdgeM, localSnow + uEdgeM, hE);
  float sticks = 1.0 - smoothstep(uSnowSlideDeg.x, uSnowSlideDeg.y, slopeDeg);
  return vec2(above * sticks, above * (1.0 - sticks));
}

// terrain-styles.js naturalLowland: light fields low down to the mid green
// higher up, and wood where the land is rugged or in a gully.
vec3 naturalLowland(float h, float small, float spread) {
  vec3 col = mix(uNatLowlandLight, uNatLowland, smoothstep(0.0, uNatLowlandRampM, h));
  float wood = clamp(
    uNatWoodAmount * smoothstep(uNatWoodSpreadM.x, uNatWoodSpreadM.y, spread)
      + uNatGullyAmount * smoothstep(0.0, uNatGullyM, -small),
    0.0, 1.0);
  return mix(col, uNatLowlandWood, wood);
}

// terrain-styles.js naturalBaseColour: the cover before any light or lift.
vec3 naturalBase(float h, vec2 grad, float small, float spread, float s) {
  if (h <= 0.0) {
    return mix(uNatSea, uNatSeaDeep, clamp(-h / uNatSeaDeepM, 0.0, 1.0));
  }
  vec4 c = naturalCover(h, grad, small);
  vec2 snow = naturalSnow(h, grad, small);
  vec3 col = mix(naturalLowland(h, small, spread), uNatForest, c.x);
  col = mix(col, uNatMeadow, c.y);
  col = mix(col, uNatScree, c.z);
  col = mix(col, uNatRock, c.w);
  col = mix(col, uNatLightRock, snow.y);
  vec3 snowCol = mix(uNatSnow, uNatSnowShade, clamp(1.0 - s, 0.0, 1.0));
  return mix(col, snowCol, snow.x);
}

// terrain-styles.js naturalColour.
vec3 natural(float h, vec2 grad, float small, float spread, float svf, float vis) {
  float s = sunShade(grad, vis);
  vec3 col = naturalBase(h, grad, small, spread, s);
  float light = clamp(uShadow * s + (1.0 - uShadow) * svf, 0.0, uMaxLight);
  col *= light;
  return min(mix(col, vec3(1.0), uLift), vec3(1.0));
}

// terrain-styles.js exposureColour, for the normal's horizontal part.
vec3 exposureColour(vec2 nh) {
  vec2 t = nh / uExpFullTilt;
  float len = length(t);
  if (len > 1.0) t /= len;
  // A sun straight overhead has no azimuth: no exposure colour then.
  vec2 lh = length(uSun.xy) > 1e-6 ? normalize(uSun.xy) : vec2(0.0);
  float a = dot(t, lh);
  float b = t.x * lh.y - t.y * lh.x;
  return uExpFlat
    + max(a, 0.0) * (uExpLight - uExpFlat)
    + max(-a, 0.0) * (uExpShadow - uExpFlat)
    + max(b, 0.0) * (uExpLeft - uExpFlat)
    + max(-b, 0.0) * (uExpRight - uExpFlat);
}

// terrain-styles.js swissColour.
vec3 swiss(float h, vec2 grad, float svf, float vis) {
  vec3 base = h <= 0.0
    ? uSwissSea
    : texture2D(uLutSwiss, vec2(h / uLutMaxM, 0.5)).rgb;
  vec3 n = normalize(vec3(-grad * uGain, 1.0));
  vec3 col = base * mix(vec3(1.0), exposureColour(n.xy) / uExpFlat, uExposure);
  float s = sunShade(grad, vis);
  float contrast = uHRange.y > uHRange.x
    ? mix(uLowContrast, 1.0, smoothstep(uHRange.x, uHRange.y, h))
    : 1.0;
  col *= 1.0 - uShadow * contrast * clamp(1.0 - s, 0.0, 1.0);
  col *= mix(1.0, svf, uAo);
  return clamp(col, 0.0, 1.0);
}

// terrain-globe-colour.js linearLuminance.
float linearLuminance(vec3 srgb) {
  return dot(sRGBTransferEOTF(vec4(srgb, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
}

// terrain-globe-colour.js detailRatio.
float detailRatio(float fineLum, float coarseLum, float detail) {
  if (detail <= 0.0 || coarseLum <= 0.0) return 1.0;
  return clamp(1.0 + detail * (fineLum / coarseLum - 1.0),
    ${GLOBE_ALBEDO.ratioRange[0].toFixed(4)}, ${GLOBE_ALBEDO.ratioRange[1].toFixed(4)});
}

// The region's texture coordinate (the far field's and the albedo's grids).
vec2 regionUv() {
  return clamp((vEnu + uHalfM) / (2.0 * uHalfM), 0.0, 1.0);
}

// terrain-globe-colour.js globeAlbedoColour; style B where the imagery has
// no texel (not loaded yet, or a tile failed).
vec3 globeAlbedo(float h, vec2 grad, float small, float spread, float svf, float vis) {
  vec2 uv = regionUv();
  vec4 albedo = texture2D(uAlbedo, uv);
  if (albedo.a < 0.5) return natural(h, grad, small, spread, svf, vis);
  float light = sunLight(reliefNormal(grad, uGain), uShadow, svf, vis);
  float fine = linearLuminance(naturalBase(h, grad, small, spread, 1.0));
  float coarse = texture2D(uCoarseLum, uv).r;
  return sunLitColour(albedo.rgb, light * detailRatio(fine, coarse, uAlbedoDetail));
}

// terrain-globe-colour.js bandRampColour (through its LUT) under the sun
// term, as the globe lights its pixels; style B until the drawn region's
// ramp exists (no imagery yet, or it failed: review 2026-10-01-1650 m6).
vec3 globeBands(float h, vec2 grad, float small, float spread, float svf, float vis) {
  if (uBandsOn < 0.5) return natural(h, grad, small, spread, svf, vis);
  vec3 base = h <= 0.0 && uBandSeaOn > 0.5
    ? uBandSea
    : texture2D(uLutBands, vec2(h / uLutMaxM, 0.5)).rgb;
  return sunLitColour(base, sunLight(reliefNormal(grad, uGain), uShadow, svf, vis));
}

// terrain-globe-colour.js srgbToLab (D65); the cube root's argument is
// kept positive, since mix() evaluates both branches.
vec3 srgbToLab(vec3 srgb) {
  vec3 c = sRGBTransferEOTF(vec4(srgb, 1.0)).rgb;
  vec3 xyz = vec3(
    dot(c, vec3(0.4124, 0.3576, 0.1805)) / 0.95047,
    dot(c, vec3(0.2126, 0.7152, 0.0722)),
    dot(c, vec3(0.0193, 0.1192, 0.9505)) / 1.08883);
  vec3 low = ((24389.0 / 27.0) * xyz + 16.0) / 116.0;
  vec3 cube = pow(max(xyz, vec3(1e-6)), vec3(1.0 / 3.0));
  vec3 f = mix(low, cube, step(vec3(216.0 / 24389.0), xyz));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

float classDistance2(vec3 lab, vec3 proto) {
  vec3 d = lab - proto;
  return dot(d, d);
}

// terrain-globe-classes.js landClassWeights: x forest, y grass, z rock,
// w snow; wholly the nearest when every kernel vanishes.
vec4 landClassWeights(vec3 landSrgb) {
  vec3 lab = srgbToLab(landSrgb);
  vec4 d2 = vec4(
    classDistance2(lab, uClassLab[0]), classDistance2(lab, uClassLab[1]),
    classDistance2(lab, uClassLab[2]), classDistance2(lab, uClassLab[3]));
  vec4 k = exp(-d2 / (2.0 * uClassWidth * uClassWidth));
  float sum = dot(k, vec4(1.0));
  if (sum >= 1e-6) return k / sum;
  float m = min(min(d2.x, d2.y), min(d2.z, d2.w));
  vec4 nearest = vec4(equal(d2, vec4(m)));
  return nearest / dot(nearest, vec4(1.0));
}

// terrain-globe-classes.js classAffinities: the land classes' (x forest,
// y grass, z rock, w snow) and, in water, the water's.
vec4 classAffinities(float h, vec2 grad, float small, out float water) {
  if (h <= 0.0) {
    water = 1.0;
    return vec4(uClassFloor);
  }
  vec4 c = naturalCover(h, grad, small);
  vec2 sn = naturalSnow(h, grad, small);
  float slopeDeg = degrees(atan(length(grad)));
  vec4 a = vec4(
    (1.0 - c.y) * (1.0 - c.w),
    (1.0 - sn.x) * (1.0 - c.w),
    max(max(c.w, c.z), sn.y),
    sn.x);
  water = uClassFloor + (1.0 - uClassFloor)
    * (1.0 - smoothstep(uClassWaterDeg.x, uClassWaterDeg.y, slopeDeg));
  return uClassFloor + (1.0 - uClassFloor) * a;
}

vec3 classMix(vec4 w) {
  return w.x * uClassLin[0] + w.y * uClassLin[1]
    + w.z * uClassLin[2] + w.w * uClassLin[3];
}

// terrain-globe-classes.js classAlbedo under the sun term, as the globe
// lights its pixels; style B where the imagery has no texel.
vec3 globeClasses(float h, vec2 grad, float small, float spread, float svf, float vis) {
  vec2 uv = regionUv();
  vec4 land = texture2D(uClassLand, uv);
  if (land.a < 0.5) return natural(h, grad, small, spread, svf, vis);
  float water = texture2D(uClassWater, uv).r;
  float waterA;
  vec4 a = classAffinities(h, grad, small, waterA);
  vec4 coarse = landClassWeights(land.rgb);
  vec4 raw = coarse * a;
  float rawSum = dot(raw, vec4(1.0));
  vec3 ratio = clamp(
    classMix(raw / rawSum) / max(classMix(coarse), vec3(1e-4)),
    uClassRatio.x, uClassRatio.y);
  vec3 landLin = sRGBTransferEOTF(vec4(land.rgb, 1.0)).rgb * ratio;
  float landShare = (1.0 - water) * rawSum;
  float waterShare = water * waterA;
  float wf = waterShare / max(landShare + waterShare, 1e-6);
  vec3 lin = clamp(mix(landLin, uClassWaterLin, wf), 0.0, 1.0);
  vec3 albedo = sRGBTransferOETF(vec4(lin, 1.0)).rgb;
  return sunLitColour(albedo, sunLight(reliefNormal(grad, uGain), uShadow, svf, vis));
}

void main() {
  vec4 d = texture2D(uData, vUv);
  vec4 a = texture2D(uAux, vUv);
  if (a.a < 0.5) {
    // No data: a hatch, never a colour a height could have.
    float stripe = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 6.0), 2.0);
    gl_FragColor = vec4(stripe < 0.5 ? uNoData[0] : uNoData[1], 1.0);
    return;
  }
  float h = d.r + uDatum;
  float small = (a.g * 255.0 - 128.0) * uSmallMPerStep;
  // The relief spread (style A's green, style B's lowland wood), metres.
  float spread = a.r * uStdSpanM;
  if (uSnowMask == 1) {
    // Style B's snow weight as grey: the smoke reads the line itself.
    gl_FragColor = vec4(vec3(h <= 0.0 ? 0.0 : naturalSnow(h, d.gb, small).x), 1.0);
    return;
  }
  // The sun's visibility, once per fragment (the cloud-shadow port's seat).
  float vis = terrainSunVisibility(vEnu, h, uSun);
  vec3 col;
  if (uStyle == 1) {
    col = natural(h, d.gb, small, spread, a.b, vis);
  } else if (uStyle == 2) {
    col = swiss(h, d.gb, a.b, vis);
  } else if (uStyle == 4) {
    col = globeAlbedo(h, d.gb, small, spread, a.b, vis);
  } else if (uStyle == 5) {
    col = globeBands(h, d.gb, small, spread, a.b, vis);
  } else if (uStyle == 6) {
    col = globeClasses(h, d.gb, small, spread, a.b, vis);
  } else {
    if (uStyle == 3) {
      col = h <= 0.0 ? uClaySea : uClay;
    } else if (h <= 0.0) {
      col = mix(uWaterShallow, uWaterDeep, clamp(-h / uWaterDeepM, 0.0, 1.0));
    } else {
      // terrain-style.js landColour: the ramp, mixed toward the green by the
      // relief spread.
      vec3 ramp = texture2D(uLut, vec2(h / uLutMaxM, 0.5)).rgb;
      col = mix(ramp, uGreen, uGreenAmount * smoothstep(uGreenR.x, uGreenR.y, spread));
    }
    // terrain-styles.js shadeColour (styles A and E), by the four map
    // lights or, with uLightMode 1, by the key light alone.
    float lit = uLightMode == 1
      ? sunRelativeShade(reliefNormal(d.gb, uGain), vis)
      : shade(d.gb);
    float s = lit + uDetail * small / 50.0;
    col *= mix(vec3(1.0), uShadowTint, uShadow * clamp(1.0 - s, 0.0, 1.0));
    col = mix(col, uHighlightTint, uHighlight * clamp(s - 1.0, 0.0, 1.0));
    col *= mix(1.0, a.b, uAo);
  }
  if (uNearW < 1.0) {
    // terrain-far-field.js farColour: the globe's imagery through its tone
    // mapping, with relief finer than the imagery faded in (the ratio of
    // the fine shade to the shade at the imagery's own scale).
    vec2 fuv = clamp((vEnu + uHalfM) / (2.0 * uHalfM), 0.0, 1.0);
    vec4 f = texture2D(uFar, fuv);
    if (f.a > 0.5) {
      // Lit as the globe lights it (farColour): its diffuse term at its
      // sun's intensity, straight from above, or by the sun itself with
      // light 1, through the cloud-shadow seat as every direct term
      // (review 2026-10-01-1650 m4).
      float farLight = uLightMode == 1 ? sunDirect(vec3(0.0, 0.0, 1.0), vis) : 1.0;
      vec3 lin = sRGBTransferEOTF(vec4(f.rgb, 1.0)).rgb
        * uSunIntensity * farLight / 3.141592653589793;
      if (uFarReliefW > 0.0) {
        float hx0 = texture2D(uData, vUv - vec2(uFarDeltaUv, 0.0)).r;
        float hx1 = texture2D(uData, vUv + vec2(uFarDeltaUv, 0.0)).r;
        float hy0 = texture2D(uData, vUv - vec2(0.0, uFarDeltaUv)).r;
        float hy1 = texture2D(uData, vUv + vec2(0.0, uFarDeltaUv)).r;
        vec2 coarse = vec2(hx1 - hx0, hy1 - hy0) / (2.0 * uFarDeltaM);
        float ratio = clamp(shade(d.gb) / max(0.05, shade(coarse)), 0.3, 2.0);
        lin *= mix(1.0, ratio, uFarReliefW);
      }
      vec3 far = sRGBTransferOETF(vec4(clamp(NeutralToneMapping(lin), 0.0, 1.0), 1.0)).rgb;
      col = mix(far, col, uNearW);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const rgb = (hex) => new THREE.Vector3(...hexToRgb(hex));

/** A unit vector (east, north, up) toward a light at an azimuth and altitude. */
function lightDir(azimuthDeg, altitudeDeg) {
  const alt = altitudeDeg * DEG;
  return new THREE.Vector3(
    Math.sin(azimuthDeg * DEG) * Math.cos(alt),
    Math.cos(azimuthDeg * DEG) * Math.cos(alt),
    Math.sin(alt),
  );
}

/** The four lights as ENU unit vectors (east, north, up) and azimuths. */
function lights(altitudeDeg) {
  return {
    dirs: LIGHT_AZIMUTHS_DEG.map((az) => lightDir(az, altitudeDeg)),
    azimuths: LIGHT_AZIMUTHS_DEG.map((az) => az * DEG),
  };
}

/** A texture the shaders read, linear, clamped, no mipmaps. */
function dataTexture(array, width, height, type) {
  const texture = new THREE.DataTexture(
    array,
    width,
    height,
    THREE.RGBAFormat,
    type,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A scalar grid (row 0 south) as an RGBA16F texture, the value in red:
 * `globe-albedo`'s footprint luminance. `toHalf` is three's
 * `DataUtils.toHalfFloat` (the page passes it, as for the data texture).
 */
export function createScalarTexture(values, side, toHalf) {
  const out = new Uint16Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    out[i * 4] = toHalf(values[i]);
    out[i * 4 + 3] = toHalf(1);
  }
  return dataTexture(out, side, side, THREE.HalfFloatType);
}

/** A ramp's 256 x 1 RGBA8 LUT (`globe-bands`' `bandRampLut`). */
export function createLutTexture(bytes) {
  return dataTexture(bytes, bytes.length / 4, 1, THREE.UnsignedByteType);
}

/** The far field's grid (`terrain-far-field.js`), RGBA bytes, row 0 south. */
export function createFarTexture(grid, side) {
  return dataTexture(grid, side, side, THREE.UnsignedByteType);
}

/**
 * The textures: the RGBA16F data (half-float bits), the RGBA8 aux and the
 * two ramps' LUTs (style A's and style D's). Every one is half-float or
 * byte; `textureTypes` lists them so the smoke can assert no FloatType
 * texture exists.
 */
export function createTerrainTextures({ rgba16, rgba8, side, lut, lutSwiss }) {
  return {
    data: dataTexture(rgba16, side, side, THREE.HalfFloatType),
    aux: dataTexture(rgba8, side, side, THREE.UnsignedByteType),
    lut: dataTexture(lut, LUT.size, 1, THREE.UnsignedByteType),
    lutSwiss: dataTexture(lutSwiss, LUT.size, 1, THREE.UnsignedByteType),
  };
}

/**
 * One transparent texel: the far field and the imagery styles' grids before
 * their imagery has loaded (alpha 0 keeps the near style, or style B).
 */
export const EMPTY_TEXTURE = dataTexture(
  new Uint8Array(4),
  1,
  1,
  THREE.UnsignedByteType,
);
const EMPTY_FAR = EMPTY_TEXTURE;

/**
 * The material; `uniforms` are updated in place by the page, the style's
 * through `applyStyle`. Style A's uniforms start at `PASTEL_ATLAS`.
 */
export function createTerrainMaterial(textures, { side, extentM, datum }) {
  const { dirs, azimuths } = lights(PASTEL_ATLAS.lightAltitudeDeg);
  const n = NATURAL;
  const w = SWISS;
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uData: { value: textures.data },
      uAux: { value: textures.aux },
      uLut: { value: textures.lut },
      uLutSwiss: { value: textures.lutSwiss },
      uFar: { value: EMPTY_FAR },
      uStyle: { value: 0 },
      uSnowMask: { value: 0 },
      uSide: { value: side },
      uExtentM: { value: extentM },
      uExag: { value: 1 },
      uDatum: { value: datum },
      uLutMaxM: { value: LUT.maxM },
      uStdSpanM: { value: AUX_ENCODING.reliefStdSpanM },
      uSmallMPerStep: { value: AUX_ENCODING.reliefSmallMPerStep },
      uGain: { value: 1 },
      uLightDir: { value: dirs },
      uLightAz: { value: azimuths },
      uGreen: { value: rgb(PASTEL_ATLAS.green) },
      uGreenR: {
        value: new THREE.Vector2(PASTEL_ATLAS.greenR0, PASTEL_ATLAS.greenR1),
      },
      uGreenAmount: { value: PASTEL_ATLAS.greenAmount },
      uShadow: { value: PASTEL_ATLAS.shadow },
      uShadowTint: { value: rgb(PASTEL_ATLAS.shadowTint) },
      uHighlight: { value: PASTEL_ATLAS.highlight },
      uHighlightTint: { value: rgb(PASTEL_ATLAS.highlightTint) },
      uAo: { value: PASTEL_ATLAS.ao },
      uDetail: { value: PASTEL_ATLAS.detail },
      uWaterShallow: { value: rgb(PASTEL_ATLAS.waterShallow) },
      uWaterDeep: { value: rgb(PASTEL_ATLAS.waterDeep) },
      uWaterDeepM: { value: PASTEL_ATLAS.waterDeepM },
      uNoData: { value: NO_DATA_COLOURS.map(rgb) },
      uNatLowland: { value: rgb(n.lowland) },
      uNatLowlandLight: { value: rgb(n.lowlandLight) },
      uNatLowlandWood: { value: rgb(n.lowlandWood) },
      uNatLowlandRampM: { value: n.lowlandRampM },
      uNatWoodSpreadM: { value: new THREE.Vector2(...n.woodSpreadM) },
      uNatWoodAmount: { value: n.woodAmount },
      uNatGullyM: { value: n.gullyM },
      uNatGullyAmount: { value: n.gullyAmount },
      uNatForest: { value: rgb(n.forest) },
      uNatMeadow: { value: rgb(n.meadow) },
      uNatScree: { value: rgb(n.scree) },
      uNatRock: { value: rgb(n.rock) },
      uNatLightRock: { value: rgb(n.lightRock) },
      uNatSnow: { value: rgb(n.snow) },
      uNatSnowShade: { value: rgb(n.snowShade) },
      uNatSea: { value: rgb(n.sea) },
      uNatSeaDeep: { value: rgb(n.seaDeep) },
      uNatSeaDeepM: { value: n.seaDeepM },
      uTreeM: { value: 2000 },
      uSnowM: { value: 3000 },
      uEdgeM: { value: n.edgeM },
      uMeadowBandM: { value: n.meadowBandM },
      uAspectSnowM: { value: n.aspectSnowM },
      uAspectFull: { value: n.aspectFullSlope },
      uPoleSign: { value: 1 },
      uRockDeg: { value: n.rockSlopeDeg },
      uRockSoftDeg: { value: n.rockSoftDeg },
      uSnowSlideDeg: { value: new THREE.Vector2(...n.snowSlideDeg) },
      uScreeRockDeg: { value: new THREE.Vector2(...n.screeRockDeg) },
      uMaxLight: { value: n.maxLight },
      uLift: { value: n.lift },
      // Styles B and D share the classic single light (both 315° / 45°);
      // the page points it at the sun with `light` 1.
      uSun: { value: new THREE.Vector3(...MAP_KEY_LIGHT) },
      uSunIntensity: { value: GLOBE_SUN.intensity },
      uLightMode: { value: 0 },
      uSwissSea: { value: rgb(w.sea) },
      uExpLight: { value: rgb(w.exposureLight) },
      uExpShadow: { value: rgb(w.exposureShadow) },
      uExpLeft: { value: rgb(w.exposureLeft) },
      uExpRight: { value: rgb(w.exposureRight) },
      uExpFlat: { value: rgb(w.exposureFlat) },
      uExpFullTilt: { value: w.exposureFullTilt },
      uExposure: { value: w.exposure },
      uLowContrast: { value: w.lowContrast },
      uHRange: { value: new THREE.Vector2(0, 4000) },
      uClay: { value: rgb(CLAY.land) },
      uClaySea: { value: rgb(CLAY.sea) },
      uAlbedo: { value: EMPTY_FAR },
      uCoarseLum: { value: EMPTY_FAR },
      uAlbedoDetail: { value: GLOBE_ALBEDO.detail },
      uLutBands: { value: textures.lut },
      uBandSea: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uBandSeaOn: { value: 0 },
      uBandsOn: { value: 0 },
      uClassLand: { value: EMPTY_FAR },
      uClassWater: { value: EMPTY_FAR },
      uClassLab: { value: PROTOTYPE_LAB.map((p) => new THREE.Vector3(...p)) },
      uClassLin: {
        value: PROTOTYPE_LINEAR.map((p) => new THREE.Vector3(...p)),
      },
      uClassWaterLin: { value: new THREE.Vector3(...WATER_LINEAR) },
      uClassWidth: { value: GLOBE_CLASSES.widthDE },
      uClassFloor: { value: GLOBE_CLASSES.floor },
      uClassWaterDeg: {
        value: new THREE.Vector2(...GLOBE_CLASSES.waterFlatDeg),
      },
      uClassRatio: { value: new THREE.Vector2(...GLOBE_CLASSES.ratioRange) },
      uNearW: { value: 1 },
      uFarReliefW: { value: 0 },
      uHalfM: { value: extentM },
      uFarDeltaUv: { value: 0 },
      uFarDeltaM: { value: 1 },
    },
  });
}

/**
 * Sets a style's uniforms from the hash's params (`readTerrainParams`):
 * the switch, the shading strength, the A/E shading set (`shadeColour`:
 * A's from `PASTEL_ATLAS`, E's from `CLAY`), B's tree and snow lines for
 * the place's latitude plus their offsets, D's exposure, contrast and the
 * region's height range, and the snow mask. The far field's weights change
 * with the camera and are set per frame by the page.
 *
 * @param {THREE.ShaderMaterial} material
 * @param {{ style: string, shadow: number, green: number, tree: number,
 *   snow: number, aspect: number, rock: number, lift: number,
 *   exposure: number, contrast: number, snowMask: number }} params
 * @param {{ shaderStyle: number, latDeg: number, hRange: [number, number] }} context
 */
export function applyStyle(material, params, { shaderStyle, latDeg, hRange }) {
  const u = material.uniforms;
  const shading = params.style === "clay" ? CLAY : PASTEL_ATLAS;
  u.uStyle.value = shaderStyle;
  u.uShadow.value = params.shadow;
  u.uGreenAmount.value = params.green;
  u.uShadowTint.value.set(...hexToRgb(shading.shadowTint));
  u.uHighlight.value = shading.highlight;
  u.uHighlightTint.value.set(...hexToRgb(shading.highlightTint));
  u.uAo.value = params.style === "swiss" ? SWISS.ao : shading.ao;
  u.uDetail.value = shading.detail;
  u.uTreeM.value = treeLineM(latDeg) + params.tree;
  u.uSnowM.value = snowLineM(latDeg) + params.snow;
  u.uPoleSign.value = latDeg < 0 ? -1 : 1;
  u.uAspectSnowM.value = params.aspect;
  u.uRockDeg.value = params.rock;
  u.uLift.value = params.lift;
  u.uExposure.value = params.exposure;
  u.uLowContrast.value = params.contrast;
  u.uHRange.value.set(hRange[0], hRange[1]);
  u.uSnowMask.value = params.snowMask;
  u.uAlbedoDetail.value = params.detail;
  u.uClassWidth.value = params.classWidth;
}

/**
 * The grid over the drawn region, ±`halfExtentM`, a vertex every `stepM`
 * metres; flat (y = 0), the vertex shader lifts it.
 */
export function createTerrainGeometry(halfExtentM, stepM) {
  const n = Math.round((2 * halfExtentM) / stepM) + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions[k] = -halfExtentM + (i / (n - 1)) * 2 * halfExtentM;
      // Row j runs south to north; three's z is south.
      positions[k + 2] = halfExtentM - (j / (n - 1)) * 2 * halfExtentM;
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
