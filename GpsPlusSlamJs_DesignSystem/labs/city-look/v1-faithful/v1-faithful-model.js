/**
 * V1 faithful's pure decisions: does a footprint fit a rectangle, does a tag
 * leave a building alone, which colour and which guessed height, and the
 * house mesh itself. No three.js and no DOM, so a node test reaches all of it.
 *
 * @see v1-faithful-model.js.md
 */
import { seededRandom } from "../city-look-model.js";

/** The look's parameters; each can be overridden by a link parameter. */
export const DEFAULTS = Object.freeze({
  /** How far a footprint's area may fall short of its box, as a share. */
  tolerance: 0.05,
  pitchDeg: 38,
  riseCapM: 5.5,
  overhangM: 0.7,
  vergeM: 0.4,
  thicknessM: 0.22,
  /** Tone spread of an untagged colour, as a share up and down. */
  jitter: 0.03,
  /** How far every colour moves towards its own grey. */
  mute: 0.12,
  /** Multiplies the width of a class's height band. */
  heightBand: 1,
  /** An override of the untagged pitched roof, for look comparisons only. */
  roofRgb: null,
});

/** Below this a house is an outbuilding, in both roof and height. */
const OUTBUILDING_AREA_M2 = 45;
/** A span this wide is a hall, not a house under a ridge. */
const MAX_SPAN_M = 18;
/** Below this a box has no long side worth a ridge. */
const HIPPED_ASPECT = 1.25;
/** Above this a `building=yes` is taken for a large block. */
const LARGE_AREA_M2 = 600;

/** Any of these means the mapper said something about the shape. */
const SHAPE_KEYS = [
  "height",
  "building:levels",
  "min_height",
  "building:min_level",
  "building:part",
  "roof:shape",
  "roof:height",
  "roof:levels",
  "roof:angle",
  "roof:direction",
  "roof:orientation",
];

/** Classes a pitched roof is plausible on. */
const PITCHED_CLASSES = new Set([
  "yes",
  "house",
  "detached",
  "semidetached_house",
  "residential",
  "apartments",
  "terrace",
  "bungalow",
  "farm",
  "dormitory",
  "hotel",
  "school",
  "kindergarten",
  "church",
  "chapel",
]);

/** Eave height bands in metres, by class. */
const EAVE_BANDS = {
  yes: [5.6, 6.8],
  house: [5.4, 6.6],
  detached: [5.4, 6.6],
  semidetached_house: [5.4, 6.6],
  bungalow: [3, 3.6],
  terrace: [6.5, 8],
  residential: [7.5, 9.5],
  apartments: [9, 12],
  dormitory: [9, 12],
  hotel: [9, 12],
  garage: [2.5, 3.1],
  garages: [2.5, 3.1],
  carport: [2.5, 3],
  shed: [2.4, 3],
  hut: [2.5, 3.2],
  kiosk: [2.8, 3.4],
  retail: [6, 8],
  commercial: [7, 10],
  office: [8, 11],
  industrial: [6, 8],
  warehouse: [6, 8],
  school: [7.5, 9.5],
  university: [9, 12],
  kindergarten: [3.4, 4.2],
  church: [11, 14],
  chapel: [5, 7],
};
const OUTBUILDING_BAND = [2.6, 3.2];
const LARGE_BAND = [8, 10];

/** Wall tones by class: quiet, and neutral where the class says nothing. */
const NEUTRAL_WALL = 0xd6d2c9;
const WALL_CLASS = {
  house: 0xdcd5c8,
  detached: 0xdcd5c8,
  semidetached_house: 0xdcd5c8,
  residential: 0xd8d1c5,
  apartments: 0xd3cdc2,
  terrace: 0xd8d0c3,
  dormitory: 0xd3cdc2,
  hotel: 0xd8cfc4,
  commercial: 0xc7cacc,
  office: 0xc3c9cd,
  retail: 0xcec8c3,
  kiosk: 0xc4beb2,
  industrial: 0xb5b4af,
  warehouse: 0xb5b4af,
  garage: 0xb9b7b1,
  garages: 0xb9b7b1,
  carport: 0xb9b7b1,
  shed: 0xa99c88,
  hut: 0xa99c88,
  church: 0xd4cbb8,
  chapel: 0xd4cbb8,
  school: 0xd3ccb5,
  university: 0xd3ccb5,
  kindergarten: 0xd6cfb6,
  public: 0xcccfd0,
  civic: 0xcccfd0,
  roof: 0xa9a9a7,
};

/** When `building=yes`, these say what the house is. */
const AMENITY_CLASS = {
  school: "school",
  kindergarten: "kindergarten",
  place_of_worship: "church",
  public_building: "public",
  fire_station: "public",
};

const WALL_MATERIAL = {
  brick: 0xa8705c,
  concrete: 0xb4b4b0,
  stone: 0xb7b2a6,
  sandstone: 0xc4a58f,
  limestone: 0xc6c0ae,
  wood: 0xa88a64,
  timber_framing: 0xc3ad8d,
  glass: 0x9fb2be,
  metal: 0xa9aeb4,
  plaster: 0xd6d0c4,
};

const ROOF_MATERIAL = {
  roof_tiles: 0x96664f,
  tile: 0x96664f,
  slate: 0x55585e,
  metal: 0x8b9096,
  copper: 0x7f9f92,
  concrete: 0x8e8d89,
  tar_paper: 0x5c5c5e,
  gravel: 0x93908a,
  grass: 0x76855f,
  sandstone: 0xb39c84,
  glass: 0x8fa4b0,
};

/** The roof where nothing is tagged: dark and without a hue of its own. */
const PITCHED_ROOF = 0x6e6a66;
const FLAT_ROOF = 0x8f8c86;

/** The CSS names mappers use; the library reads hex only. */
const NAMED_COLOURS = {
  white: 0xffffff,
  black: 0x000000,
  grey: 0x808080,
  gray: 0x808080,
  silver: 0xc0c0c0,
  lightgrey: 0xd3d3d3,
  lightgray: 0xd3d3d3,
  darkgrey: 0xa9a9a9,
  darkgray: 0xa9a9a9,
  red: 0xff0000,
  darkred: 0x8b0000,
  maroon: 0x800000,
  brown: 0xa52a2a,
  sienna: 0xa0522d,
  orange: 0xffa500,
  yellow: 0xffff00,
  beige: 0xf5f5dc,
  ivory: 0xfffff0,
  tan: 0xd2b48c,
  burlywood: 0xdeb887,
  green: 0x008000,
  blue: 0x0000ff,
  pink: 0xffc0cb,
};

/**
 * A tag's colour as `0xrrggbb`: `#rrggbb`, `#rgb` or a known name. Anything
 * else is undefined, so the next source is asked instead of painting black.
 */
export function parseColour(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().toLowerCase();
  const long = /^#([0-9a-f]{6})$/.exec(text);
  if (long) return Number.parseInt(long[1], 16);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [, r, g, b] = short;
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  return NAMED_COLOURS[text];
}

const channels = (rgb) => [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
const packed = ([r, g, b]) => {
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
};

/** Moves a colour towards its own grey by `share`. */
function muted(rgb, share) {
  const c = channels(rgb);
  const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return packed(c.map((v) => v + (grey - v) * share));
}

/** Scales a colour's tone only, so no hue is added. */
function toned(rgb, key, salt, spread) {
  const scale = 1 + spread * (2 * seededRandom(`${key}:${salt}`) - 1);
  return packed(channels(rgb).map((v) => v * scale));
}

/** HSL saturation of `0xrrggbb`, 0 to 1. */
export function saturationOf(rgb) {
  const c = channels(rgb).map((v) => v / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(max + min - 1));
}

/** `0xrrggbb` in sRGB as linear `[r, g, b]`, what vertex colours hold. */
export function linearRgb(rgb) {
  return channels(rgb).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
}

/** The class a house's tags name, with `yes` refined by its amenity. */
function classOf(tags) {
  const building = tags.building ?? "yes";
  if (building !== "yes") return building;
  return AMENITY_CLASS[tags.amenity] ?? "yes";
}

/** True when a tag already says something about the building's shape. */
export function leftAlone(tags) {
  if (tags.building === "roof") return true;
  return SHAPE_KEYS.some((key) => tags[key] !== undefined);
}

/**
 * The colour of a building's walls: its own colour tag, its parent's, then
 * its own or its parent's material, then its class, which alone is seeded.
 */
export function wallColour(tags, parentTags, key, params = {}) {
  const { mute, jitter } = { ...DEFAULTS, ...params };
  const tagged =
    parseColour(tags["building:colour"]) ??
    parseColour(parentTags["building:colour"]) ??
    WALL_MATERIAL[tags["building:material"]] ??
    WALL_MATERIAL[parentTags["building:material"]];
  if (tagged !== undefined) return muted(tagged, mute);
  const base = WALL_CLASS[classOf({ ...parentTags, ...tags })] ?? NEUTRAL_WALL;
  return toned(base, key, "wall", jitter);
}

/**
 * The colour of a building's roof: `roof:colour`, then `roof:material`, own
 * before parent's. Without either a neutral, darker when pitched. The wall's
 * colour is never read: a roof's colour says nothing about its walls.
 */
export function roofColour(tags, parentTags, key, pitched, params = {}) {
  const { mute, jitter, roofRgb } = { ...DEFAULTS, ...params };
  const tagged =
    parseColour(tags["roof:colour"]) ??
    parseColour(parentTags["roof:colour"]) ??
    ROOF_MATERIAL[tags["roof:material"]] ??
    ROOF_MATERIAL[parentTags["roof:material"]];
  if (tagged !== undefined) return muted(tagged, mute);
  const base = pitched ? (roofRgb ?? PITCHED_ROOF) : FLAT_ROOF;
  return toned(base, key, "roof", jitter);
}

/** The eave height of an untagged building, or null when a tag forbids it. */
export function guessedEaveM(tags, areaM2, key, params = {}) {
  if (leftAlone(tags)) return null;
  const { heightBand } = { ...DEFAULTS, ...params };
  const name = classOf(tags);
  let band = EAVE_BANDS[name] ?? EAVE_BANDS.yes;
  if (name === "yes") {
    if (areaM2 < OUTBUILDING_AREA_M2) band = OUTBUILDING_BAND;
    else if (areaM2 > LARGE_AREA_M2) band = LARGE_BAND;
  }
  const middle = (band[0] + band[1]) / 2;
  const half = ((band[1] - band[0]) / 2) * heightBand;
  return middle + half * (2 * seededRandom(`${key}:height`) - 1);
}

function openRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1 && first.x === last.x && first.y === last.y;
  return closed ? ring.slice(0, -1) : [...ring];
}

function signedArea(ring) {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** Absolute area of a ring in square metres. */
export function ringArea(ring) {
  return Math.abs(signedArea(openRing(ring)));
}

/** The smallest box flush with one of the ring's edges; long side on `axis`. */
function orientedBox(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const v = { x: -u.y, y: u.x };
    const along = ring.map((p) => p.x * u.x + p.y * u.y);
    const across = ring.map((p) => p.x * v.x + p.y * v.y);
    const [minA, maxA] = [Math.min(...along), Math.max(...along)];
    const [minC, maxC] = [Math.min(...across), Math.max(...across)];
    const area = (maxA - minA) * (maxC - minC);
    if (best && area >= best.area) continue;
    const midA = (minA + maxA) / 2;
    const midC = (minC + maxC) / 2;
    const long = maxA - minA >= maxC - minC;
    best = {
      area,
      centre: { x: u.x * midA + v.x * midC, y: u.y * midA + v.y * midC },
      // Negated on a swap, so the frame stays right-handed.
      axis: long ? u : v,
      cross: long ? v : { x: -u.x, y: -u.y },
      halfLength: Math.max(maxA - minA, maxC - minC) / 2,
      halfWidth: Math.min(maxA - minA, maxC - minC) / 2,
    };
  }
  return best;
}

/**
 * Does a footprint fill its box within `tolerance`? The library's area test,
 * so these numbers compare with the plan's sweep.
 */
export function fitRectangle(ring, tolerance) {
  const open = openRing(ring);
  if (open.length < 3) return { fits: false, fill: 0, box: null };
  const box = orientedBox(open);
  if (!box || box.area === 0) return { fits: false, fill: 0, box: null };
  const fill = Math.abs(signedArea(open)) / box.area;
  return { fits: Math.abs(fill - 1) < tolerance, fill, box };
}

/**
 * The inferred roof of one building, or null to leave it as it is.
 * `facts`: `{ ring, isPart, hasHoles }`.
 */
export function roofPlan(tags, facts, params = {}) {
  const look = { ...DEFAULTS, ...params };
  if (leftAlone(tags) || facts.isPart || facts.hasHoles) return null;
  if (!PITCHED_CLASSES.has(classOf(tags))) return null;
  const { fits, box } = fitRectangle(facts.ring, look.tolerance);
  if (!fits) return null;
  if (box.area < OUTBUILDING_AREA_M2) return null;
  if (box.halfWidth * 2 > MAX_SPAN_M) return null;
  const riseM = Math.min(
    box.halfWidth * Math.tan((look.pitchDeg * Math.PI) / 180),
    look.riseCapM,
  );
  return {
    shape: box.halfLength / box.halfWidth < HIPPED_ASPECT ? "hipped" : "gabled",
    box,
    riseM,
    overhangM: look.overhangM,
    vergeM: look.vergeM,
    thicknessM: look.thicknessM,
  };
}

/** Collects triangles, wound by a hint, so no face can end up inside out. */
function meshWriter() {
  const positions = [];
  const normals = [];
  const colours = [];
  const indices = [];
  const tri = (p, q, r, hint, colour) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...n);
    if (length < 1e-6) return;
    n = n.map((value) => value / length);
    const flip = n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0;
    if (flip) n = n.map((value) => -value);
    const start = positions.length / 3;
    for (const point of flip ? [p, r, q] : [p, q, r]) {
      positions.push(...point);
      normals.push(...n);
      colours.push(...colour);
    }
    indices.push(start, start + 1, start + 2);
  };
  const quad = (p, q, r, s, hint, colour) => {
    tri(p, q, r, hint, colour);
    tri(p, r, s, hint, colour);
  };
  const done = () => ({
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colours: new Float32Array(colours),
    indices: new Uint32Array(indices),
  });
  return { tri, quad, done };
}

/** Where along a wall the roof above it changes slope, as sorted fractions. */
function kinks(from, to, shape, box) {
  const { halfLength: hl, halfWidth: hw } = box;
  const forms =
    shape === "gabled"
      ? [(p) => p.c]
      : [
          (p) => p.c,
          (p) => hw - p.c - (hl - p.a),
          (p) => hw - p.c - (hl + p.a),
          (p) => hw + p.c - (hl - p.a),
          (p) => hw + p.c - (hl + p.a),
        ];
  const fractions = [];
  for (const form of forms) {
    const start = form(from);
    const end = form(to);
    if (start === end) continue;
    const t = start / (start - end);
    if (t > 1e-4 && t < 1 - 1e-4) fractions.push(t);
  }
  return fractions.sort((a, b) => a - b);
}

/**
 * A house under an inferred roof. The walls are the real footprint, each
 * climbing to the roof above it, so a gable end is the wall itself and a
 * notch opens no gap. The roof is a slab on the fitted box, with eaves.
 * `plan`: `roofPlan`'s result plus `eaveM`, `baseM` and `colours`.
 */
export function houseMesh(ring, plan) {
  const { box, shape, riseM, eaveM, baseM, colours } = plan;
  const { centre, axis, cross, halfLength: hl, halfWidth: hw } = box;
  const slope = riseM / hw;
  const toBox = (p) => {
    const x = p.x - centre.x;
    const y = p.y - centre.y;
    return { a: x * axis.x + y * axis.y, c: x * cross.x + y * cross.y };
  };
  const heightAt = ({ a, c }) => {
    const toEave = hw - Math.abs(c);
    const toEnd = hl - Math.abs(a);
    return (
      eaveM + slope * (shape === "gabled" ? toEave : Math.min(toEave, toEnd))
    );
  };
  const lifted = (a, c, y) => [
    centre.x + axis.x * a + cross.x * c,
    y,
    -(centre.y + axis.y * a + cross.y * c),
  ];
  const writer = meshWriter();
  const { tri, quad } = writer;

  const open = openRing(ring);
  const ccw = signedArea(open) > 0 ? open : [...open].reverse();
  ccw.forEach((from, i) => {
    const to = ccw[(i + 1) % ccw.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return;
    const hint = [(to.y - from.y) / length, 0, (to.x - from.x) / length];
    const stops = [0, ...kinks(toBox(from), toBox(to), shape, box), 1];
    for (let s = 0; s + 1 < stops.length; s++) {
      const at = (t) => ({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
      const p = at(stops[s]);
      const q = at(stops[s + 1]);
      quad(
        [p.x, baseM, -p.y],
        [q.x, baseM, -q.y],
        [q.x, heightAt(toBox(q)), -q.y],
        [p.x, heightAt(toBox(p)), -p.y],
        hint,
        colours.wall,
      );
    }
  });

  const { overhangM: over, vergeM, thicknessM: thick } = plan;
  const low = eaveM - slope * over;
  const ridge = eaveM + riseM;
  const up = [0, 1, 0];
  const down = [0, -1, 0];
  const W = hw + over;
  const axisDir = [axis.x, 0, -axis.y];
  const crossDir = [cross.x, 0, -cross.y];
  const back = (dir) => dir.map((value) => -value);
  const fascia = (p, q, hint) => {
    const raised = (point) => [point[0], point[1] + thick, point[2]];
    quad(p, q, raised(q), raised(p), hint, colours.roof);
  };

  if (shape === "gabled") {
    const L = hl + vergeM;
    for (const [lift, hint, colour] of [
      [thick, up, colours.roof],
      [0, down, colours.soffit],
    ]) {
      for (const side of [-1, 1]) {
        quad(
          lifted(-L, side * W, low + lift),
          lifted(L, side * W, low + lift),
          lifted(L, 0, ridge + lift),
          lifted(-L, 0, ridge + lift),
          hint,
          colour,
        );
      }
    }
    for (const side of [-1, 1]) {
      const dir = side > 0 ? crossDir : back(crossDir);
      fascia(lifted(-L, side * W, low), lifted(L, side * W, low), dir);
      for (const end of [-1, 1]) {
        const hint = end > 0 ? axisDir : back(axisDir);
        fascia(lifted(end * L, side * W, low), lifted(end * L, 0, ridge), hint);
      }
    }
  } else {
    const L = hl + over;
    const R = hl - hw;
    for (const [lift, hint, colour] of [
      [thick, up, colours.roof],
      [0, down, colours.soffit],
    ]) {
      for (const side of [-1, 1]) {
        quad(
          lifted(-L, side * W, low + lift),
          lifted(L, side * W, low + lift),
          lifted(R, 0, ridge + lift),
          lifted(-R, 0, ridge + lift),
          hint,
          colour,
        );
        tri(
          lifted(side * L, -W, low + lift),
          lifted(side * L, W, low + lift),
          lifted(side * R, 0, ridge + lift),
          hint,
          colour,
        );
      }
    }
    for (const side of [-1, 1]) {
      const along = side > 0 ? crossDir : back(crossDir);
      const ends = side > 0 ? axisDir : back(axisDir);
      fascia(lifted(-L, side * W, low), lifted(L, side * W, low), along);
      fascia(lifted(side * L, -W, low), lifted(side * L, W, low), ends);
    }
  }
  return writer.done();
}

/** Colours a mesh by its normals: facing up is roof, everything else wall. */
export function paintByNormal(normals, wall, roof) {
  const colours = new Float32Array(normals.length);
  for (let i = 0; i < normals.length; i += 3) {
    colours.set(normals[i + 1] > 0.05 ? roof : wall, i);
  }
  return colours;
}

/** A copy of `positions` with every height scaled. */
export function scaleHeights(positions, factor) {
  const scaled = Float32Array.from(positions);
  for (let i = 1; i < scaled.length; i += 3) scaled[i] *= factor;
  return scaled;
}

/** Merges parts into one set of buffers, one draw call. */
export function mergeParts(parts) {
  const total = (name) =>
    parts.reduce((sum, part) => sum + part[name].length, 0);
  const merged = {
    positions: new Float32Array(total("positions")),
    normals: new Float32Array(total("positions")),
    colours: new Float32Array(total("positions")),
    indices: new Uint32Array(total("indices")),
  };
  let vertexAt = 0;
  let indexAt = 0;
  for (const part of parts) {
    merged.positions.set(part.positions, vertexAt);
    merged.normals.set(part.normals, vertexAt);
    merged.colours.set(part.colours, vertexAt);
    const offset = vertexAt / 3;
    for (let i = 0; i < part.indices.length; i++) {
      merged.indices[indexAt + i] = part.indices[i] + offset;
    }
    vertexAt += part.positions.length;
    indexAt += part.indices.length;
  }
  return merged;
}

/** The look's parameters from the link; a bad value keeps the default. */
export function parseV1Params(search) {
  const params = new URLSearchParams(search);
  const number = (name, fallback) => {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    ...DEFAULTS,
    tolerance: number("tol", DEFAULTS.tolerance),
    pitchDeg: number("pitch", DEFAULTS.pitchDeg),
    riseCapM: number("cap", DEFAULTS.riseCapM),
    jitter: number("jitter", DEFAULTS.jitter),
    mute: number("mute", DEFAULTS.mute),
    heightBand: number("band", DEFAULTS.heightBand),
    overhangM: number("over", DEFAULTS.overhangM),
    roofRgb: params.get("roof") === "warm" ? 0x8a6a5a : DEFAULTS.roofRgb,
    ao: params.get("ao") !== "off",
  };
}
