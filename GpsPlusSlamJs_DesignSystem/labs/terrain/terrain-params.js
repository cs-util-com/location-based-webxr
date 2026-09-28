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
import { PASTEL_ATLAS } from "./terrain-style.js";

/**
 * The places (DEC-TR-3). T1 has one: the Blue Ridge, the screenshots'
 * framing, a 256 km region at z8 (plan §9 finding 8). The Alps, northern
 * Germany and the GPS place come in T3.
 */
export const TERRAIN_PLACES = Object.freeze({
  appalachians: Object.freeze({
    id: "appalachians",
    label: "Appalachians (Blue Ridge)",
    centre: Object.freeze({ lat: 37.9, lng: -79.2 }),
    halfExtentM: 128_000,
    zoom: 8,
  }),
});

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
  shade: { fallback: 1, min: 0, max: 3 },
  boostExp: { fallback: SLOPE_BOOST.exponent, min: 0.1, max: 0.6 },
  green: { fallback: PASTEL_ATLAS.greenAmount, min: 0, max: 1 },
  shadow: { fallback: PASTEL_ATLAS.shadow, min: 0, max: 1 },
  /** Sky-view directions; 0 turns the term off (a reduced smoke setting). */
  svf: { fallback: 8, min: 0, max: 16 },
  flyMs: { fallback: 12_000, min: 0, max: 60_000 },
});

const PRESETS = new Set(["top", "oblique", "low", "fly"]);
const STYLES = new Set(["pastel"]);

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
    place !== null && place in TERRAIN_PLACES ? place : "appalachians";
  if (place !== null && out.place !== place) {
    out.notes.push(
      `Place "${place}" is not in this lab yet: showing the Appalachians.`,
    );
  }
  const style = params.get("style");
  out.style = style !== null && STYLES.has(style) ? style : "pastel";
  if (style !== null && out.style !== style) {
    out.notes.push(
      `Style "${style}" is not in this lab yet: showing Pastel atlas.`,
    );
  }
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
