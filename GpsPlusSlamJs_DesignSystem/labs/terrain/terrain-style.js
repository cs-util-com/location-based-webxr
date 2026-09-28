/**
 * Style A, "Pastel atlas" (terrain plan 2026-09-27-0605 §4 "Styles"; the
 * stops and parameters are research 2026-09-27-0600 §6.1's designs, a
 * starting point to tune by eye, not a measurement): a cream-to-green height
 * ramp, a green driven by LOCAL relief (the screenshots' greens are probably
 * forest, which tracks rugged land, not height: research §2.4), soft
 * multidirectional shading with cool shadows, and a pale blue sea.
 *
 * The shader (`terrain-material.js`) mirrors these functions line for line;
 * this file is the reference CI can run. Colours are sRGB 0-1 throughout,
 * as a printed map's are: the lab draws them without tone mapping.
 *
 * @see terrain-style.js.md
 */

/** Style A's colours and defaults (research §6.1). */
export const PASTEL_ATLAS = Object.freeze({
  /** [height m, sRGB hex], rising. */
  land: Object.freeze([
    [0, "#F3F0E4"],
    [150, "#F1EFDD"],
    [400, "#EAEDD3"],
    [800, "#DDE7C6"],
    [1300, "#CEDFB7"],
    [2000, "#C4D5AE"],
    [2800, "#D3D1BF"],
    [3800, "#E6E3DA"],
    [5000, "#F8F8F5"],
  ]),
  /** The sea (h <= 0): the shore colour to the deep colour at 200 m. */
  waterShallow: "#AFCFE3",
  waterDeep: "#9CC3DB",
  waterDeepM: 200,
  /** The relief-driven green: smoothstep(R0, R1, relief spread) x amount. */
  green: "#C2DCAE",
  greenR0: 40,
  greenR1: 220,
  greenAmount: 0.7,
  /** Shading: never black, a cool shadow and a faint warm lift. */
  shadow: 0.45,
  shadowTint: "#5E7280",
  highlight: 0.15,
  highlightTint: "#FFFDF4",
  /** The sky view's darkening, and the small-relief detail's gain. */
  ao: 0.25,
  detail: 0.1,
  /** The four lights' altitude (Mark 1992: 225°, 270°, 315°, 360°). */
  lightAltitudeDeg: 45,
});

/**
 * The hatch drawn where a post had no data (plan §9 finding 15): two
 * mauves no height, sea or shade of this style can produce.
 */
export const NO_DATA_COLOURS = Object.freeze(["#C9A7C7", "#EFE3EE"]);

/** The LUT texture the shader reads the ramp from: 256 x 1 over 0-5000 m. */
export const LUT = Object.freeze({ size: 256, maxM: 5000 });

/** The four light azimuths, degrees clockwise from north. */
export const LIGHT_AZIMUTHS_DEG = Object.freeze([225, 270, 315, 360]);

/** `#RRGGBB` to sRGB 0-1. */
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`expected #RRGGBB, got ${hex}`);
  return [m[1], m[2], m[3]].map((v) => parseInt(v, 16) / 255);
}

/** GLSL `smoothstep`: the design system's one copy (DEC-H3, per package). */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The ramp at a height: linear between stops, clamped outside them. */
export function rampColour(stops, heightM) {
  if (heightM <= stops[0][0]) return hexToRgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [h1, c1] = stops[i];
    if (heightM <= h1) {
      const [h0, c0] = stops[i - 1];
      return mix(hexToRgb(c0), hexToRgb(c1), (heightM - h0) / (h1 - h0));
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

/**
 * The ramp as RGBA bytes, one texel per `LUT.maxM / LUT.size` metres, each
 * the ramp at its texel's CENTRE (so linear filtering between texels is the
 * ramp's own linear interpolation, to within one texel).
 */
export function rampLut(stops, { size, maxM } = LUT) {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const rgb = rampColour(stops, ((i + 0.5) / size) * maxM);
    out.set([...rgb.map((v) => Math.round(v * 255)), 255], i * 4);
  }
  return out;
}

/** The green's weight for a relief spread (metres), 0 to `greenAmount`. */
export function greenWeight(reliefStdM, style = PASTEL_ATLAS) {
  return (
    style.greenAmount * smoothstep(style.greenR0, style.greenR1, reliefStdM)
  );
}

/** The land's colour before shading. */
export function landColour(style, heightM, reliefStdM) {
  return mix(
    rampColour(style.land, heightM),
    hexToRgb(style.green),
    greenWeight(reliefStdM, style),
  );
}

/** The sea's colour at a (non-positive) height. */
export function waterColour(style, heightM) {
  const t = Math.min(1, Math.max(0, -heightM / style.waterDeepM));
  return mix(hexToRgb(style.waterShallow), hexToRgb(style.waterDeep), t);
}

const DEG = Math.PI / 180;

/**
 * The multidirectional shade (Mark 1992, as research §2.2 states it): four
 * lights at `LIGHT_AZIMUTHS_DEG`, each weighted by sin²(aspect - azimuth),
 * the weights summing to 2, times 0.5. Each light's term is normalised by
 * its own height (`dot(n, L) / L.z`), so FLAT GROUND IS EXACTLY 1 and the
 * shadow and highlight leave it untouched (Patterson's "no grey in flat
 * areas"). `gx`/`gy` are the slope east/north in m/m; `gain` scales it for
 * the normal only (the shading gain times the view's slope boost).
 */
export function multidirectionalShade(gx, gy, gain = 1, altitudeDeg = 45) {
  const nx = -gx * gain;
  const ny = -gy * gain;
  const len = Math.hypot(nx, ny, 1);
  // The downslope direction's azimuth, clockwise from north.
  const aspect = Math.atan2(-gx, -gy);
  const cosAlt = Math.cos(altitudeDeg * DEG);
  const sinAlt = Math.sin(altitudeDeg * DEG);
  let sum = 0;
  for (const az of LIGHT_AZIMUTHS_DEG) {
    const a = az * DEG;
    const w = Math.sin(aspect - a) ** 2;
    const dot =
      (nx * Math.sin(a) * cosAlt + ny * Math.cos(a) * cosAlt + sinAlt) / len;
    sum += w * (dot / sinAlt);
  }
  // Flat ground has no aspect; every term is 1 there, whatever the weights.
  return nx === 0 && ny === 0 ? 1 : 0.5 * sum;
}
