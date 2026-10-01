/**
 * The terrain lab's place, field and hash parameters (terrain plan
 * 2026-09-27-0605 §4, DEC-TR-3/4, §9 findings 8, 9, 14 and 20). The hash is
 * the lab's one state: every control writes its key, a link reproduces the
 * view. Out of range, empty or malformed reads as the default.
 *
 * @see terrain-params.js.md
 */
import {
  AUTO_RULE,
  EXAGGERATION,
  SLOPE_BOOST,
} from "./terrain-exaggeration.js";
import { FAR_FIELD } from "./terrain-far-field.js";
import { GLOBE_ALBEDO, GLOBE_BANDS } from "./terrain-globe-colour.js";
import { PASTEL_ATLAS } from "./terrain-style.js";
import { NATURAL, SWISS, TERRAIN_STYLES } from "./terrain-styles.js";

/**
 * The committed places (DEC-TR-3), each a 256 km region at z8 (plan §9
 * finding 8): the Blue Ridge (the screenshots' framing), the central Alps
 * (style B's snow is checked on them) and northern Germany (the flat one).
 * The fourth, the GPS position, is `placeFor("gps", fix)`.
 *
 * The Alps' and Germany's centres are the middles of z8 tiles 134/90 and
 * 134/82, so each region and its padding fit in 3 x 3 tiles (the committed
 * fixtures): the Alps 7.4-10.9° E, 45.3-47.8° N, from Monte Rosa and the
 * Bernese Oberland to the Bernina; Germany 7.1-11.2° E, 52.5-55.0° N, the
 * Elbe from above Hamburg to the North Sea, the coast and Schleswig-Holstein.
 */
export const TERRAIN_PLACES = Object.freeze({
  appalachians: Object.freeze({
    id: "appalachians",
    label: "Appalachians (Blue Ridge)",
    centre: Object.freeze({ lat: 37.9, lng: -79.2 }),
    halfExtentM: 128_000,
    zoom: 8,
  }),
  alps: Object.freeze({
    id: "alps",
    label: "Alps (Valais to Bernina)",
    centre: Object.freeze({ lat: 46.56, lng: 9.14 }),
    halfExtentM: 128_000,
    zoom: 8,
  }),
  germany: Object.freeze({
    id: "germany",
    label: "Northern Germany (Elbe and coast)",
    centre: Object.freeze({ lat: 53.75, lng: 9.14 }),
    halfExtentM: 128_000,
    zoom: 8,
  }),
});

/** The GPS place's id in the hash: the hash never carries the position. */
export const GPS_PLACE = "gps";

/**
 * The place for a hash's place id: a committed one, or the GPS place
 * around `fix` (the same 256 km z8 region), or null for the GPS place
 * before any fix (the page then waits for a press of the pin).
 *
 * @param {string} id
 * @param {{ lat: number, lng: number } | null} fix
 */
export function placeFor(id, fix) {
  if (id !== GPS_PLACE) {
    // Own keys only: `in` or an index would also find `toString` and kin.
    return Object.hasOwn(TERRAIN_PLACES, id) ? TERRAIN_PLACES[id] : null;
  }
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return null;
  }
  return Object.freeze({
    id: GPS_PLACE,
    label: "My position",
    centre: Object.freeze({ lat: fix.lat, lng: fix.lng }),
    halfExtentM: 128_000,
    zoom: 8,
  });
}

/**
 * The metric grid (plan §9 finding 5): posts every 500 m, about the z8
 * texel (482 m at 37.9° N), with a padding ring of 8 km around the drawn
 * region, so the blur and the sky-view march never read past the data.
 */
export const FIELD = Object.freeze({
  spacingM: 500,
  padM: 8_000,
  /** The large relief scale: "height minus its surroundings within ~2 km". */
  reliefSigmaM: 2_000,
  /** The small, band-pass relief, in posts (research §6.1: ~2 texels). */
  detailSigmaPosts: 2,
  /** The sky view's march, posts (plan §6: 16 or 32; T1 uses 16). */
  svfSteps: 16,
});

/** A place's sampled field: the region plus its padding, in posts. */
export function fieldSpec(place, field = FIELD) {
  const extentM = place.halfExtentM + field.padM;
  return {
    centre: place.centre,
    zoom: place.zoom,
    halfExtentM: place.halfExtentM,
    extentM,
    spacingM: field.spacingM,
    // Posts on both edges, as OsmDemo's `buildHeightfieldData` counts them.
    side: Math.round((extentM * 2) / field.spacingM) + 1,
  };
}

/**
 * The owner's look values (globe round-5 plan 2026-10-01-0945 DEC-GL5-5):
 * the shadow, the slope gain and the exaggeration every style opens with,
 * "rather too strong at first" than too weak. The styles' own shadow
 * strengths (`PASTEL_ATLAS.shadow` and kin) stay their references' values.
 */
export const LOOK_DEFAULTS = Object.freeze({
  shadow: 0.8,
  shade: 1.6,
  exag: EXAGGERATION.fallback,
});

/** Every numeric hash key, its default and its range. */
export const PARAMS = Object.freeze({
  exag: {
    fallback: EXAGGERATION.fallback,
    min: EXAGGERATION.min,
    max: EXAGGERATION.max,
  },
  auto: { fallback: 0, min: 0, max: 1 },
  /** The auto rule's exponent (plan §6: 0.3, with 0.2 and 0.5 reported). */
  autoExp: { fallback: AUTO_RULE.exponent, min: 0.1, max: 0.8 },
  /** The altitude smoothing's time constant, seconds (a swept parameter). */
  tau: { fallback: 0.5, min: 0, max: 5 },
  /** The shading gain, and the slope boost's exponent (plan §6). */
  shade: { fallback: LOOK_DEFAULTS.shade, min: 0, max: 3 },
  boostExp: { fallback: SLOPE_BOOST.exponent, min: 0.1, max: 0.6 },
  green: { fallback: PASTEL_ATLAS.greenAmount, min: 0, max: 1 },
  /** The shading's strength; with no `shadow` key, the style's own. */
  shadow: { fallback: LOOK_DEFAULTS.shadow, min: 0, max: 1 },
  /** Style B: tree and snow line offsets (m), their aspect and rock slope. */
  tree: { fallback: 0, min: -1500, max: 1500 },
  snow: { fallback: 0, min: -1500, max: 1500 },
  aspect: { fallback: NATURAL.aspectSnowM, min: 0, max: 600 },
  rock: { fallback: NATURAL.rockSlopeDeg, min: 28, max: 50 },
  lift: { fallback: NATURAL.lift, min: 0, max: 0.4 },
  /** Style B's snow mask instead of the colours (1), for the smoke. */
  snowMask: { fallback: 0, min: 0, max: 1 },
  /** Style D: the exposure palette's share and the lowlands' contrast. */
  exposure: { fallback: SWISS.exposure, min: 0, max: 0.7 },
  contrast: { fallback: SWISS.lowContrast, min: 0.2, max: 1 },
  /** The globe's far field (style C, or any style with far=1), in km. */
  far: { fallback: 0, min: 0, max: 1 },
  farHigh: { fallback: FAR_FIELD.highKm, min: 100, max: 5000 },
  farLow: { fallback: FAR_FIELD.lowKm, min: 10, max: 2000 },
  /**
   * The light (globe round-5 plan §3.3): 0 the map styles' own lights, 1
   * the globe's sun at the page's clock (`time=`, as the globe lab's);
   * with no `light` key, the style's own (`STYLE_LIGHT`).
   */
  light: { fallback: 0, min: 0, max: 1 },
  /**
   * `globe-albedo`'s detail weight: style B's ramp as a luminance-only
   * high-pass over the imagery (0 is the imagery alone).
   */
  detail: { fallback: GLOBE_ALBEDO.detail, min: 0, max: 1 },
  /** `globe-bands`' band width, metres (the plan's swept range). */
  band: { fallback: GLOBE_BANDS.widthM, min: 100, max: 800 },
  /** Sky-view directions; 0 turns the term off (a reduced smoke setting). */
  svf: { fallback: 8, min: 0, max: 16 },
  flyMs: { fallback: 12_000, min: 0, max: 60_000 },
});

const PRESETS = new Set(["top", "oblique", "low", "fly"]);
/**
 * Each style's own shading strength, used when the hash has no `shadow`:
 * the owner's 0.8 for every style since DEC-GL5-5 (before, each style's
 * reference value: A and C 0.45, B 0.65, D 0.6, E 0.55).
 */
export const STYLE_SHADOW = Object.freeze({
  pastel: LOOK_DEFAULTS.shadow,
  natural: LOOK_DEFAULTS.shadow,
  globe: LOOK_DEFAULTS.shadow,
  swiss: LOOK_DEFAULTS.shadow,
  clay: LOOK_DEFAULTS.shadow,
  "globe-albedo": LOOK_DEFAULTS.shadow,
  "globe-bands": LOOK_DEFAULTS.shadow,
});

/** Each style's own light (0 map lights, 1 the sun), when the hash has none. */
export const STYLE_LIGHT = Object.freeze({
  pastel: 0,
  natural: 0,
  globe: 0,
  swiss: 0,
  clay: 0,
  // The imagery styles are the globe's colours: under the globe's sun.
  "globe-albedo": 1,
  "globe-bands": 1,
});

/** The styles coloured from the globe's imagery. */
export const IMAGERY_STYLES = new Set(["globe-albedo", "globe-bands"]);

/** A number from the params within its range, or its fallback. */
function readNumber(params, name, { fallback, min, max }) {
  const text = params.get(name);
  const value = Number(text);
  return text !== null && text.trim() !== "" && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * The lab's state from a hash (without the `#`). `camera` is the pose from
 * `alt`/`tilt`/`head` when all three are valid, else null (the page then
 * uses a preset). `notes` names what fell back, for the status line.
 */
export function readTerrainParams(hash) {
  const params = new URLSearchParams(hash);
  const out = { notes: [] };
  for (const [name, range] of Object.entries(PARAMS)) {
    out[name] = readNumber(params, name, range);
  }
  const place = params.get("place");
  out.place =
    place !== null &&
    (Object.hasOwn(TERRAIN_PLACES, place) || place === GPS_PLACE)
      ? place
      : "appalachians";
  if (place !== null && out.place !== place) {
    out.notes.push(
      `Place "${place}" is not in this lab: showing the Appalachians.`,
    );
  }
  const style = params.get("style");
  out.style =
    style !== null && Object.hasOwn(TERRAIN_STYLES, style) ? style : "pastel";
  if (style !== null && out.style !== style) {
    out.notes.push(
      `Style "${style}" is not in this lab: showing Pastel atlas.`,
    );
  }
  const shadowRange = { ...PARAMS.shadow, fallback: null };
  if (readNumber(params, "shadow", shadowRange) === null) {
    out.shadow = STYLE_SHADOW[out.style];
  }
  if (
    readNumber(params, "light", { ...PARAMS.light, fallback: null }) === null
  ) {
    out.light = STYLE_LIGHT[out.style];
  }
  if (out.farLow >= out.farHigh) {
    out.notes.push(
      `The far field's low altitude (${out.farLow} km) must be under its high one (${out.farHigh} km): using ${FAR_FIELD.lowKm} and ${FAR_FIELD.highKm} km.`,
    );
    out.farLow = FAR_FIELD.lowKm;
    out.farHigh = FAR_FIELD.highKm;
  }
  // Style C IS the far field on (plan §9 finding 11); any style can have it.
  out.farOn = out.style === "globe" || out.far === 1;
  // The globe's imagery is loaded for the far field and for the styles
  // coloured from it (globe round-5 §3.3).
  out.imageryOn = out.farOn || IMAGERY_STYLES.has(out.style);
  const preset = params.get("preset");
  out.preset = preset !== null && PRESETS.has(preset) ? preset : null;
  const altitudeM = readNumber(params, "alt", {
    fallback: null,
    min: 100,
    max: 5_000_000,
  });
  const tiltDeg = readNumber(params, "tilt", {
    fallback: null,
    min: 0,
    max: 89,
  });
  const headingDeg = readNumber(params, "head", {
    fallback: null,
    min: 0,
    max: 360,
  });
  out.camera =
    altitudeM === null || tiltDeg === null || headingDeg === null
      ? null
      : { altitudeM, tiltDeg, headingDeg };
  return out;
}
