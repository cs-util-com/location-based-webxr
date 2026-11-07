/**
 * V3's pure decisions: which building gets an inferred roof, how tall its
 * storeys are in metres, what tone and finish its tags earn. No three.js and
 * no DOM. Everything inferred here is cosmetic, seeded from the OSM id by the
 * caller, and never reaches navigation data.
 *
 * @see v3-model-rules.js.md
 */

/** Share of its bounding rectangle a footprint may miss and still get a roof. */
export const ROOF_TOLERANCE = 0.05;

const STOREY_GUESS_M = 3.2;
/** A one-level tag on a taller wall is a hall: lines would be a lie. */
const MAX_STOREY_M = 6;
const MIN_WALL_FOR_LINES_M = 2.4;

const MIN_PITCH_DEG = 28;
const MAX_PITCH_DEG = 38;
const MIN_RISE_M = 1.2;
const MAX_RISE_M = 5.5;
/** Past this span a pitched roof is a landmark, not a guess. */
const MAX_ROOF_SPAN_M = 18;
const MAX_ROOF_LEVELS = 4;
const SQUARE_ASPECT = 1.3;
const HIP_SHARE = 0.25;
const SMALL_FOOTPRINT_M2 = 35;

/** The classes a pitched roof is a fair guess for. */
const ROOFED_CLASSES = new Set([
  "yes",
  "house",
  "detached",
  "semidetached_house",
  "residential",
  "apartments",
  "terrace",
  "bungalow",
  "farm",
  "barn",
  "hut",
  "cabin",
  "chapel",
  "church",
  "school",
  "kindergarten",
]);

/** Tags that already say something about the top of the building. */
const ROOF_STATEMENTS = ["roof:shape", "roof:height", "roof:levels"];

const ONE_LEVEL_CLASSES = new Set([
  "garage",
  "garages",
  "carport",
  "shed",
  "kiosk",
  "hut",
]);

/** No floors to draw: one tall room, or no room at all. */
const NO_STOREY_CLASSES = new Set([
  "church",
  "chapel",
  "cathedral",
  "mosque",
  "synagogue",
  "temple",
  "garage",
  "garages",
  "carport",
  "shed",
  "roof",
  "kiosk",
  "greenhouse",
  "hangar",
  "silo",
  "ruins",
]);

const CIVIC_CLASSES = new Set([
  "church",
  "chapel",
  "cathedral",
  "mosque",
  "synagogue",
  "temple",
  "school",
  "university",
  "college",
  "kindergarten",
  "hospital",
  "public",
  "civic",
]);

const SERVICE_CLASSES = new Set([
  "garage",
  "garages",
  "carport",
  "shed",
  "roof",
  "kiosk",
  "industrial",
  "warehouse",
  "service",
  "parking",
]);

const SHINY_CLASSES = new Map([
  ["greenhouse", 1],
  ["office", 0.5],
  ["commercial", 0.5],
  ["retail", 0.4],
  ["hotel", 0.3],
  ["industrial", 0.35],
  ["warehouse", 0.35],
]);

/** Finish by material: 0 matte plaster, 1 polished acrylic. */
const MATERIAL_FINISH = new Map([
  ["glass", 1],
  ["mirror", 1],
  ["metal", 0.75],
  ["steel", 0.75],
  ["aluminium", 0.75],
  ["copper", 0.65],
  ["zinc", 0.6],
  ["tin", 0.6],
  ["marble", 0.4],
  ["concrete", 0.25],
  ["cement_block", 0.2],
  ["roof_tiles", 0.12],
  ["tile", 0.12],
  ["slate", 0.2],
  ["plaster", 0.03],
  ["plastered", 0.03],
  ["stucco", 0.03],
]);

/** Paper-model tones by material, in sRGB bytes: tints, never paints. */
const MATERIAL_TONE = new Map([
  ["brick", 0xe2cbbd],
  ["brick_block", 0xe2cbbd],
  ["clay", 0xe5d2c2],
  ["sandstone", 0xebdfc8],
  ["stone", 0xe6e1d5],
  ["limestone", 0xeae4d6],
  ["marble", 0xf1eee8],
  ["wood", 0xead9bd],
  ["timber_framing", 0xead9bd],
  ["glass", 0xd8e5ea],
  ["mirror", 0xd8e5ea],
  ["metal", 0xdfe3e6],
  ["steel", 0xdfe3e6],
  ["concrete", 0xdfddd7],
  ["cement_block", 0xdfddd7],
]);

const PAPER = 0xf1eee7;
const ROOF_PAPER = 0xe8e4db;
const CIVIC_TONE = 0xeadfc9;
const SERVICE_TONE = 0xe0ded8;

const WALL_ACCENT = 0.28;
const ROOF_ACCENT = 0.42;
/** A tag's colour loses this much chroma before it tints anything. */
const TAG_DESATURATE = 0.4;

/** The colour names real `*:colour` tags use; anything else falls back. */
const NAMED_COLOURS = new Map([
  ["white", 0xffffff],
  ["black", 0x202020],
  ["grey", 0x808080],
  ["gray", 0x808080],
  ["silver", 0xc0c0c0],
  ["red", 0xb03a2e],
  ["maroon", 0x7b2d26],
  ["brown", 0x8b5a3c],
  ["tan", 0xd2b48c],
  ["beige", 0xe0d6bd],
  ["burlywood", 0xdeb887],
  ["orange", 0xd98a3d],
  ["yellow", 0xe0c95a],
  ["green", 0x5f8a5a],
  ["blue", 0x4f7196],
]);

const bytesToRgb = (hex) => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

/** `[r, g, b]` in sRGB 0..1 from a hex or a known name; null otherwise. */
export function parseColour(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [, r, g, b] = short;
    return bytesToRgb(Number.parseInt(r + r + g + g + b + b, 16));
  }
  const full = /^#([0-9a-f]{6})$/.exec(text);
  if (full) return bytesToRgb(Number.parseInt(full[1], 16));
  const named = NAMED_COLOURS.get(text);
  return named === undefined ? null : bytesToRgb(named);
}

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

/** A tag's colour as a tint of `paper`: paler, and with less chroma. */
function tint(paper, colour, amount) {
  const grey = (colour[0] + colour[1] + colour[2]) / 3;
  const calm = colour.map((v) => v + (grey - v) * TAG_DESATURATE);
  return mix(paper, calm, amount);
}

const srgbToLinear = (v) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

/** A tone in linear light, which is what vertex colours are. */
const linear = (rgb) => rgb.map(srgbToLinear);

function wallTone(tags) {
  const paper = bytesToRgb(PAPER);
  const colour = parseColour(tags["building:colour"]);
  if (colour) return tint(paper, colour, WALL_ACCENT);
  const material = MATERIAL_TONE.get(tags["building:material"]);
  if (material !== undefined) return bytesToRgb(material);
  if (CIVIC_CLASSES.has(tags.building)) return bytesToRgb(CIVIC_TONE);
  if (SERVICE_CLASSES.has(tags.building)) return bytesToRgb(SERVICE_TONE);
  return paper;
}

function roofTone(tags) {
  const paper = bytesToRgb(ROOF_PAPER);
  const colour = parseColour(tags["roof:colour"]);
  if (colour) return tint(paper, colour, ROOF_ACCENT);
  const material = MATERIAL_TONE.get(tags["roof:material"]);
  return material === undefined ? paper : bytesToRgb(material);
}

function wallFinish(tags) {
  return (
    MATERIAL_FINISH.get(tags["building:material"]) ??
    SHINY_CLASSES.get(tags.building) ??
    0.06
  );
}

/**
 * What a building's tags earn: `{ wall, roof }` as linear RGB and
 * `{ wallFinish, roofFinish }` in 0..1. A part's own tags win over its
 * parent's, because a roof colour on a part is a statement about that part.
 */
export function lookFor(tags, parentTags = {}) {
  const merged = { ...parentTags, ...tags };
  return {
    wall: linear(wallTone(merged)),
    roof: linear(roofTone(merged)),
    wallFinish: wallFinish(merged),
    roofFinish: MATERIAL_FINISH.get(merged["roof:material"]) ?? 0.05,
  };
}

const parsePositive = (raw) => {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
};

/**
 * The storey height of a wall, in metres: `{ storeyM }`, 0 for no lines. The
 * mapper's levels divide the real wall; without them, the nearest whole count
 * of 3.2 m storeys does. `heights` is the library's `resolveHeights` result.
 */
export function storeyFor(tags, { minHeightM, eaveHeightM }) {
  const span = eaveHeightM - minHeightM;
  if (NO_STOREY_CLASSES.has(tags.building)) return { storeyM: 0 };
  if (!(span >= MIN_WALL_FOR_LINES_M)) return { storeyM: 0 };
  const levels = parsePositive(tags["building:levels"]);
  const minLevel = parsePositive(tags["building:min_level"]) ?? 0;
  const count =
    levels !== undefined && levels > minLevel
      ? levels - minLevel
      : Math.max(1, Math.round(span / STOREY_GUESS_M));
  const storeyM = span / count;
  return { storeyM: storeyM > MAX_STOREY_M ? 0 : storeyM };
}

const hasAny = (tags, keys) => keys.some((key) => tags[key] !== undefined);

const unmeasured = (tags) =>
  !hasAny(tags, ["height", "building:levels", "min_height"]);

/**
 * The tags the mesh is built from. Only a building nothing measures changes:
 * a shed or a footprint under 35 m2 gets one level instead of the library's
 * 6 m. Everything else comes back as the same object, which is the guarantee.
 */
export function tagsForMesh(tags, footprintM2) {
  if (!unmeasured(tags) || tags["building:part"] !== undefined) return tags;
  const small =
    ROOFED_CLASSES.has(tags.building) && footprintM2 < SMALL_FOOTPRINT_M2;
  if (!small && !ONE_LEVEL_CLASSES.has(tags.building)) return tags;
  return { ...tags, "building:levels": "1" };
}

function openRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length > 1 && first.x === last.x && first.y === last.y
    ? ring.slice(0, -1)
    : ring;
}

function shoelaceArea(ring) {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The footprint's area in square metres. */
export const footprintArea = (ring) => shoelaceArea(openRing(ring));

function boxOnEdge(ring, axis) {
  const cross = { x: -axis.y, y: axis.x };
  let [minA, maxA, minC, maxC] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of ring) {
    const along = p.x * axis.x + p.y * axis.y;
    const across = p.x * cross.x + p.y * cross.y;
    minA = Math.min(minA, along);
    maxA = Math.max(maxA, along);
    minC = Math.min(minC, across);
    maxC = Math.max(maxC, across);
  }
  const [midA, midC] = [(minA + maxA) / 2, (minC + maxC) / 2];
  const long = maxA - minA >= maxC - minC;
  return {
    area: (maxA - minA) * (maxC - minC),
    centre: {
      x: axis.x * midA + cross.x * midC,
      y: axis.y * midA + cross.y * midC,
    },
    // Keep the frame right-handed when the long side is the cross one.
    axis: long ? axis : cross,
    cross: long ? cross : { x: -axis.x, y: -axis.y },
    halfLength: Math.max(maxA - minA, maxC - minC) / 2,
    halfWidth: Math.min(maxA - minA, maxC - minC) / 2,
  };
}

/**
 * The minimum-area rectangle on an edge direction of a ring in metres:
 * `{ centre, axis, cross, halfLength, halfWidth, fill }`, `axis` along the long
 * side, `fill` the share of the box the footprint covers. Null below 3 points.
 */
export function fitRectangle(ring) {
  const open = openRing(ring);
  if (open.length < 3) return null;
  let best = null;
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    const b = open[(i + 1) % open.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const box = boxOnEdge(open, {
      x: (b.x - a.x) / length,
      y: (b.y - a.y) / length,
    });
    if (best === null || box.area < best.area) best = box;
  }
  if (best === null || best.area === 0) return null;
  const { area, ...box } = best;
  return { ...box, fill: shoelaceArea(open) / area };
}

const levelsOf = (tags) => parsePositive(tags["building:levels"]);

/** True when the tags leave the top of this building open to a guess. */
function roofIsOpen(feature) {
  const tags = feature.tags ?? {};
  if (feature.type !== "way") return false;
  if (!ROOFED_CLASSES.has(tags.building)) return false;
  if (hasAny(tags, ROOF_STATEMENTS)) return false;
  if (hasAny(tags, ["height", "min_height", "building:min_level"])) {
    return false;
  }
  if (tags["building:part"] !== undefined) return false;
  return (levelsOf(tags) ?? 1) <= MAX_ROOF_LEVELS;
}

/**
 * An inferred roof for an untagged low rectangle: `{ shape, box, riseM }`, or
 * null to leave the building exactly as tagged. `random` in [0, 1) must be
 * seeded from the OSM id, `ring` is the outer ring in metres.
 */
export function roofPlanFor(
  feature,
  ring,
  { random, tolerance = ROOF_TOLERANCE },
) {
  if (!roofIsOpen(feature)) return null;
  const box = fitRectangle(ring);
  if (box === null || box.fill < 1 - tolerance) return null;
  if (box.halfWidth * 2 > MAX_ROOF_SPAN_M) return null;
  // Two draws from one seed: the pitch from the fraction left over.
  const pitch = (random * 7) % 1;
  const degrees = MIN_PITCH_DEG + pitch * (MAX_PITCH_DEG - MIN_PITCH_DEG);
  const rise = box.halfWidth * Math.tan((degrees * Math.PI) / 180);
  const square = box.halfLength / box.halfWidth < SQUARE_ASPECT;
  return {
    shape: square || random < HIP_SHARE ? "hipped" : "gabled",
    box,
    riseM: Math.min(MAX_RISE_M, Math.max(MIN_RISE_M, rise)),
  };
}
