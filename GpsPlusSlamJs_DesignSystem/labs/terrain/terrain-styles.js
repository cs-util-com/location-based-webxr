/**
 * The terrain lab's styles B, D and E and the style registry (terrain plan
 * 2026-09-27-0605 §4 "Styles", DEC-TR-2 and DEC-TR-6, milestone T2; the
 * colours and rules are research 2026-09-27-0600 §3 and §6.2-§6.5's
 * designs, a starting point to tune by eye, not a measurement).
 *
 * - B "Natural colour": vegetation, meadow, rock and snow from height,
 *   slope, aspect and latitude alone (no imagery). The tree and snow lines
 *   are fitted from latitude and can be off by several hundred metres, so
 *   both have an offset slider.
 * - D "Swiss classic": "higher is lighter", lit slopes warm and shaded
 *   slopes cool (a five-colour exposure palette), and less contrast in the
 *   lowlands than on the peaks (aerial perspective).
 * - E "Clay": one plain colour, for judging the shape alone.
 * - C "Globe blend" is style A near and the globe's imagery far; its far
 *   field lives in `terrain-far-field.js`.
 *
 * The shader (`terrain-material.js`) mirrors these functions line for line;
 * this file is the reference CI can run. Colours are sRGB 0-1, drawn
 * without tone mapping, as style A's are.
 *
 * @see terrain-styles.js.md
 */
import {
  PASTEL_ATLAS,
  hexToRgb,
  rampColour,
  smoothstep,
} from "./terrain-style.js";

const DEG = Math.PI / 180;

/** The styles, in the order the plate lists them, with the plan's letters. */
export const TERRAIN_STYLES = Object.freeze({
  pastel: Object.freeze({ id: "pastel", letter: "A", label: "Pastel atlas" }),
  natural: Object.freeze({
    id: "natural",
    letter: "B",
    label: "Natural colour",
  }),
  globe: Object.freeze({
    id: "globe",
    letter: "C",
    label: "Globe blend (A near, Blue Marble far)",
  }),
  swiss: Object.freeze({ id: "swiss", letter: "D", label: "Swiss classic" }),
  clay: Object.freeze({ id: "clay", letter: "E", label: "Clay" }),
  // Globe round-5 plan 2026-10-01-0945 §3.3: the relief coloured from the
  // globe's imagery (`terrain-globe-colour.js`), lit by the sun term.
  "globe-albedo": Object.freeze({
    id: "globe-albedo",
    letter: "C1",
    label: "Globe albedo (Blue Marble under the sun)",
  }),
});

/** The shader's style switch (`uStyle`). C draws as A, plus the far field. */
export const SHADER_STYLE = Object.freeze({
  pastel: 0,
  natural: 1,
  globe: 0,
  swiss: 2,
  clay: 3,
  "globe-albedo": 4,
});

/**
 * Tree line from latitude (research §3): 3750 m below 30°, rising 130 m a
 * degree from 50° to 30°, and 75 m a degree from 70° to 50°. Fitted to five
 * table points with errors up to about 500 m (worst in continental
 * interiors and the southern hemisphere): a slider default, not a fact.
 */
export function treeLineM(latDeg) {
  const a = Math.min(90, Math.abs(latDeg));
  if (a < 30) return 3750;
  if (a < 50) return Math.min(3750, 2000 + 130 * (50 - a));
  return Math.max(0, 500 + 75 * (70 - a));
}

/**
 * Snow line from latitude (research §3): 5000 m below 30°, falling linearly
 * to 3000 m at 46° and to sea level at 70°. Wet maritime ranges sit lower
 * than this: a slider default, not a fact.
 */
export function snowLineM(latDeg) {
  const a = Math.min(90, Math.abs(latDeg));
  if (a < 30) return 5000;
  if (a < 46) return 5000 - 125 * (a - 30);
  return Math.max(0, 3000 - 125 * (a - 46));
}

/** Style B's colours and rules (research §6.2). */
export const NATURAL = Object.freeze({
  lowland: "#7F9860",
  forest: "#5F7D4A",
  meadow: "#A4A776",
  scree: "#B2A994",
  rock: "#9A9184",
  lightRock: "#BDB6A8",
  snow: "#F5F7FA",
  snowShade: "#C9D6E6",
  sea: "#7FB0CF",
  seaDeep: "#4A7FA8",
  seaDeepM: 200,
  /** The half-width every line is softened over, metres. */
  edgeM: 150,
  /** Alpine meadow from the tree line up this far, then scree. */
  meadowBandM: 300,
  /** Poleward faces hold snow this much lower, sun-facing this much higher. */
  aspectSnowM: 250,
  /** The slope (m/m, about 27°) at which the aspect acts in full. */
  aspectFullSlope: 0.5,
  /** Bare rock above this slope, softened by `rockSoftDeg` either side. */
  rockSlopeDeg: 38,
  rockSoftDeg: 3,
  /** Snow does not stick between these slopes (it is gone above the second). */
  snowSlideDeg: Object.freeze([50, 60]),
  /** Above the tree line, rock replaces scree between these slopes. */
  screeRockDeg: Object.freeze([20, 30]),
  /** The single light (the classic north-west, 45° up). */
  lightAzimuthDeg: 315,
  lightAltitudeDeg: 45,
  /** The direct light's share; the rest is sky light, scaled by the sky view. */
  shadow: 0.65,
  /** The brightest a lit slope gets. */
  maxLight: 1.3,
  /** A mix toward white that keeps the light look (0 is near true colour). */
  lift: 0.2,
});

/**
 * The single-light shade normalised by the light's height (as style A's
 * lights are): flat ground is exactly 1, lit slopes above, shaded below,
 * never negative. `gain` scales the slope for the normal only.
 */
export function singleLightShade(
  gx,
  gy,
  gain = 1,
  azimuthDeg = 315,
  altitudeDeg = 45,
) {
  const nx = -gx * gain;
  const ny = -gy * gain;
  const len = Math.hypot(nx, ny, 1);
  const cosAlt = Math.cos(altitudeDeg * DEG);
  const sinAlt = Math.sin(altitudeDeg * DEG);
  const dot =
    (nx * Math.sin(azimuthDeg * DEG) * cosAlt +
      ny * Math.cos(azimuthDeg * DEG) * cosAlt +
      sinAlt) /
    len;
  return Math.max(0, dot) / sinAlt;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const scale = (a, k) => a.map((v) => v * k);

/**
 * Style B's cover weights at one point: the true slope (never the view's
 * boosted one) and the height decide them, so neither the exaggeration nor
 * the slope boost moves a line. `smallM` (the band-pass relief, signed) is
 * the edge noise: it bends each line along ridges and gullies instead of a
 * contour, CLAMPED to +-`edgeM`, so a line moves at most that far with it
 * (an Alpine ridge stands 400 m over its 1 km surroundings at z8, which
 * unclamped put snow 400 m below its line).
 *
 * @param {{ heightM: number, gx: number, gy: number, smallM: number, latDeg: number }} p
 * @param {{ treeOffsetM?: number, snowOffsetM?: number, aspectSnowM?: number,
 *   rockSlopeDeg?: number }} [o]
 */
export function naturalWeights(p, o = {}, style = NATURAL) {
  const treeM = treeLineM(p.latDeg) + (o.treeOffsetM ?? 0);
  const snowM = snowLineM(p.latDeg) + (o.snowOffsetM ?? 0);
  const aspectSnowM = o.aspectSnowM ?? style.aspectSnowM;
  const rockSlopeDeg = o.rockSlopeDeg ?? style.rockSlopeDeg;
  const slope = Math.hypot(p.gx, p.gy);
  const slopeDeg = Math.atan(slope) / DEG;
  const edgeNoise = Math.min(style.edgeM, Math.max(-style.edgeM, p.smallM));
  const hE = p.heightM + edgeNoise;
  // +1 on a face that looks toward the pole (north in the north), -1 away.
  const poleSign = p.latDeg < 0 ? -1 : 1;
  const facing = slope > 0 ? (poleSign * -p.gy) / slope : 0;
  const aspectW = Math.min(1, slope / style.aspectFullSlope);
  const localSnowM = snowM - aspectSnowM * facing * aspectW;
  const edge = style.edgeM;
  // The forest is full just below the tree line's softened edge.
  const treeTopM = Math.max(treeM - edge, 1);
  const forest = smoothstep(0.5 * treeTopM, treeTopM, p.heightM);
  const meadow = smoothstep(treeM - edge, treeM + edge, hE);
  const scree = smoothstep(
    treeM + style.meadowBandM - edge,
    treeM + style.meadowBandM + edge,
    hE,
  );
  const rock = Math.max(
    smoothstep(
      rockSlopeDeg - style.rockSoftDeg,
      rockSlopeDeg + style.rockSoftDeg,
      slopeDeg,
    ),
    scree * smoothstep(style.screeRockDeg[0], style.screeRockDeg[1], slopeDeg),
  );
  const aboveSnow = smoothstep(localSnowM - edge, localSnowM + edge, hE);
  const sticks =
    1 - smoothstep(style.snowSlideDeg[0], style.snowSlideDeg[1], slopeDeg);
  return {
    treeM,
    snowM,
    localSnowM,
    forest,
    meadow,
    scree,
    rock,
    bareAboveSnow: aboveSnow * (1 - sticks),
    snow: aboveSnow * sticks,
  };
}

/**
 * Style B's cover colour at one point, before any light or lift: the sea
 * by depth, or the lowland, forest, meadow, scree, rock and snow by
 * `naturalWeights`. `s` (the light's shade, 1 on open flat ground) only
 * cools the snow in shade. `globe-albedo`'s detail reads it at s 1.
 */
export function naturalBaseColour(p, o = {}, style = NATURAL, s = 1) {
  const c = (hex) => hexToRgb(hex);
  if (p.heightM <= 0) {
    const t = Math.min(1, Math.max(0, -p.heightM / style.seaDeepM));
    return mix(c(style.sea), c(style.seaDeep), t);
  }
  const w = naturalWeights(p, o, style);
  let col = mix(c(style.lowland), c(style.forest), w.forest);
  col = mix(col, c(style.meadow), w.meadow);
  col = mix(col, c(style.scree), w.scree);
  col = mix(col, c(style.rock), w.rock);
  col = mix(col, c(style.lightRock), w.bareAboveSnow);
  const snow = mix(
    c(style.snow),
    c(style.snowShade),
    Math.min(1, Math.max(0, 1 - s)),
  );
  return mix(col, snow, w.snow);
}

/**
 * Style B's colour at one point, shading and lift included.
 *
 * @param {{ heightM: number, gx: number, gy: number, smallM: number,
 *   latDeg: number, svf?: number }} p
 * @param {{ treeOffsetM?: number, snowOffsetM?: number, aspectSnowM?: number,
 *   rockSlopeDeg?: number, gain?: number, shadow?: number, lift?: number }} [o]
 */
export function naturalColour(p, o = {}, style = NATURAL) {
  const svf = p.svf ?? 1;
  const shadow = o.shadow ?? style.shadow;
  const lift = o.lift ?? style.lift;
  const s = singleLightShade(
    p.gx,
    p.gy,
    o.gain ?? 1,
    style.lightAzimuthDeg,
    style.lightAltitudeDeg,
  );
  let col = naturalBaseColour(p, o, style, s);
  const light = Math.min(
    style.maxLight,
    Math.max(0, shadow * s + (1 - shadow) * svf),
  );
  col = scale(col, light);
  return mix(col, [1, 1, 1], lift).map((v) => Math.min(1, v));
}

/** Style D's colours and parameters (research §6.4). */
export const SWISS = Object.freeze({
  /** [height m, sRGB hex], rising: higher is lighter. */
  land: Object.freeze([
    [0, "#B7C8B9"],
    [500, "#C9D4B6"],
    [1000, "#DAD9B4"],
    [2000, "#E8E1BE"],
    [3000, "#F1ECD6"],
    [4000, "#FAF8EE"],
  ]),
  sea: "#B9D3E0",
  /**
   * The exposure palette: a slope facing the light, facing away, facing
   * either side of it, and flat ground. Only its RATIO to `flat` is
   * applied, so flat ground keeps the ramp's colour.
   */
  exposureLight: "#FFF673",
  exposureShadow: "#55967A",
  exposureLeft: "#8FB28A",
  exposureRight: "#55967A",
  exposureFlat: "#CFE0A9",
  /** The horizontal normal's length at which the exposure is full (~30°). */
  exposureFullTilt: 0.5,
  exposure: 0.35,
  /** The lowlands' share of the shading contrast (aerial perspective). */
  lowContrast: 0.4,
  shadow: 0.6,
  ao: 0.25,
  lightAzimuthDeg: 315,
  lightAltitudeDeg: 45,
});

/**
 * Style D's exposure colour for a shading normal's horizontal part
 * (`nx` east, `ny` north): the palette's flat colour moved toward the lit,
 * shaded, left or right colour by how far the normal tilts that way.
 */
export function exposureColour(nx, ny, style = SWISS) {
  const c = (hex) => hexToRgb(hex);
  const az = style.lightAzimuthDeg * DEG;
  const len = Math.hypot(nx, ny) / style.exposureFullTilt;
  const k = len > 1 ? 1 / len : 1;
  const tx = (nx / style.exposureFullTilt) * k;
  const ty = (ny / style.exposureFullTilt) * k;
  const a = tx * Math.sin(az) + ty * Math.cos(az);
  const b = tx * Math.cos(az) - ty * Math.sin(az);
  const flat = c(style.exposureFlat);
  const toward = (hex, w) => c(hex).map((v, i) => (v - flat[i]) * w);
  const parts = [
    toward(style.exposureLight, Math.max(a, 0)),
    toward(style.exposureShadow, Math.max(-a, 0)),
    toward(style.exposureLeft, Math.max(b, 0)),
    toward(style.exposureRight, Math.max(-b, 0)),
  ];
  return flat.map((v, i) => v + parts.reduce((sum, p) => sum + p[i], 0));
}

/**
 * Style D's colour at one point. `hMinM`/`hMaxM` are the region's lowest
 * and highest land, which the aerial perspective spreads its contrast over.
 *
 * @param {{ heightM: number, gx: number, gy: number, svf?: number }} p
 * @param {{ gain?: number, exposure?: number, lowContrast?: number,
 *   shadow?: number, hMinM?: number, hMaxM?: number }} [o]
 */
export function swissColour(p, o = {}, style = SWISS) {
  const gain = o.gain ?? 1;
  const nx = -p.gx * gain;
  const ny = -p.gy * gain;
  const len = Math.hypot(nx, ny, 1);
  const base =
    p.heightM <= 0 ? hexToRgb(style.sea) : rampColour(style.land, p.heightM);
  const exp = exposureColour(nx / len, ny / len, style);
  const flat = hexToRgb(style.exposureFlat);
  const exposure = o.exposure ?? style.exposure;
  let col = base.map((v, i) => v * (1 + (exp[i] / flat[i] - 1) * exposure));
  const s = singleLightShade(
    p.gx,
    p.gy,
    gain,
    style.lightAzimuthDeg,
    style.lightAltitudeDeg,
  );
  const hMin = o.hMinM ?? 0;
  const hMax = o.hMaxM ?? 4000;
  const lowContrast = o.lowContrast ?? style.lowContrast;
  const contrast =
    hMax > hMin
      ? lowContrast + (1 - lowContrast) * smoothstep(hMin, hMax, p.heightM)
      : 1;
  const shadow = o.shadow ?? style.shadow;
  col = scale(col, 1 - shadow * contrast * Math.min(1, Math.max(0, 1 - s)));
  col = scale(col, 1 + ((p.svf ?? 1) - 1) * style.ao);
  return col.map((v) => Math.min(1, Math.max(0, v)));
}

/**
 * Style E's colours and shading (research §6.5): a plaster model, shaded
 * by style A's four lights with a NEUTRAL shadow and a white lift, so no
 * shade adds a hue.
 */
export const CLAY = Object.freeze({
  land: "#EDEAE4",
  sea: "#C9D8E0",
  shadow: 0.55,
  shadowTint: "#8C8C8C",
  highlight: 0.1,
  highlightTint: "#FFFFFF",
  ao: 0.5,
  detail: 0.2,
  lightAltitudeDeg: PASTEL_ATLAS.lightAltitudeDeg,
});

/** Style E's colour before shading. */
export function clayColour(heightM, style = CLAY) {
  return hexToRgb(heightM <= 0 ? style.sea : style.land);
}

/**
 * The shading styles A and E share, as the shader applies it to a base
 * colour: a shadow toward `shadowTint` below 1, a lift toward
 * `highlightTint` above 1, and the sky view's darkening. `s` is the
 * multidirectional shade plus the detail term.
 */
export function shadeColour(base, s, svf, style) {
  const tint = hexToRgb(style.shadowTint);
  const k = style.shadow * Math.min(1, Math.max(0, 1 - s));
  let col = base.map((v, i) => v * (1 + (tint[i] - 1) * k));
  col = mix(
    col,
    hexToRgb(style.highlightTint),
    style.highlight * Math.min(1, Math.max(0, s - 1)),
  );
  return scale(col, 1 + (svf - 1) * style.ao);
}

/** HSV saturation of an sRGB colour: 0 for any grey. */
export function saturation([r, g, b]) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}
