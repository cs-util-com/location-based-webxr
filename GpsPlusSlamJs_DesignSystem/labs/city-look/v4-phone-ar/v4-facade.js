/**
 * V4's pure decisions: which colour a wall and a roof take from their tags, how
 * tall a storey is, how a wall divides into bays, and the per-vertex numbers the
 * shader reads. No three.js, so a node test reaches all of it.
 *
 * @see v4-facade.js.md
 */
import { seededRandom } from "../city-look-model.js";

/** A face whose normal is this flat counts as a wall (gable triangles too). */
const WALL_MAX_NORMAL_Y = 0.2;

const DEFAULT_STOREY_M = 3;
const TALL_STOREY_M = 3.6;
const MIN_STOREY_M = 2.2;
const MAX_STOREY_M = 5.5;
/** A bare `building=yes` this large (7 m by 7 m) is taken for a house. */
const HOUSE_PERIMETER_M = 28;

const MIN_BAY_M = 2.7;
const BAY_RANGE_M = 0.9;
/** The share of a bay a wall must still hold to get one more. */
const BAY_ROUND_UP = 0.25;

/** How far the id moves an inferred tone, as a share of the channel. */
const INFERRED_TONE_SPREAD = 0.045;

/** Only what the fixtures tag and a few neighbours: a wrong guess reads worst. */
const NAMED_COLOURS = {
  white: 0xffffff,
  ivory: 0xfffff0,
  beige: 0xf5f5dc,
  grey: 0x808080,
  gray: 0x808080,
  lightgrey: 0xd3d3d3,
  lightgray: 0xd3d3d3,
  darkgrey: 0xa9a9a9,
  darkgray: 0xa9a9a9,
  silver: 0xc0c0c0,
  black: 0x000000,
  brown: 0xa52a2a,
  red: 0xff0000,
  yellow: 0xffff00,
  tan: 0xd2b48c,
  burlywood: 0xdeb887,
  sienna: 0xa0522d,
};

/** Muted materials, in the library's spirit, a little warmer. */
const WALL_MATERIALS = {
  brick: 0xa8705c,
  concrete: 0xb0afaa,
  stone: 0xb7b2a6,
  sandstone: 0xc0a88a,
  limestone: 0xc6c0ae,
  marble: 0xd6d2c8,
  wood: 0xa98660,
  timber_framing: 0xc3ad8d,
  glass: 0x93a9b6,
  metal: 0xa3a8ad,
  steel: 0xa3a8ad,
  plaster: 0xd8cfbf,
  plastered: 0xd8cfbf,
  stucco: 0xd8cfbf,
  clay: 0xbe8f6d,
};

/** Dwellings warm, work cooler, sheds drab, civic stone. */
const PLASTER = 0xdcd0bd;
const WALL_CLASSES = {
  house: PLASTER,
  detached: PLASTER,
  semidetached_house: PLASTER,
  residential: 0xd8ccb8,
  apartments: 0xd2c6b4,
  terrace: 0xd6c8b2,
  dormitory: 0xd2c6b4,
  hotel: 0xcdc0b8,
  retail: 0xc9c2c0,
  kiosk: 0xc9c2c0,
  commercial: 0xbcc2c8,
  office: 0xb4bdc8,
  university: 0xc9c4ae,
  school: 0xc9c4ae,
  kindergarten: 0xcdc6aa,
  public: 0xc4c8c9,
  church: 0xd2cbbc,
  chapel: 0xd2cbbc,
  cathedral: 0xd2cbbc,
  garage: 0xa9acac,
  garages: 0xa9acac,
  shed: 0xa89f90,
  barn: 0xa8886a,
  warehouse: 0xa2a6a8,
  industrial: 0xa2a6a8,
  service: 0xa2a6a8,
  roof: 0xa6a9ad,
  parking: 0xa6a9ad,
};
const NEUTRAL_WALL = 0xc4c4c0;
const SCHOOL_AMENITIES = new Set(["school", "kindergarten"]);

/** Roof materials a mapper can name. */
const ROOF_MATERIALS = {
  roof_tiles: 0x94705f,
  tile: 0x94705f,
  tiles: 0x94705f,
  clay: 0x94705f,
  slate: 0x5e646c,
  metal: 0x8c9298,
  copper: 0x7f9a8e,
  zinc: 0x8c9298,
  concrete: 0x9a9a96,
  gravel: 0x8e8a82,
  tar_paper: 0x5e5f62,
  asphalt: 0x5e5f62,
  grass: 0x76855f,
  sandstone: 0xa8987c,
  thatch: 0x9c8660,
  glass: 0x9fb6c4,
};
const TILE_ROOF = 0x94705f;
const GRAVEL_ROOF = 0x8e8a82;
const SLATE_ROOF = 0x5e646c;
const DRAB_ROOF = 0x7f7c78;

/** No storeys to draw: one big room, or no room at all. */
const NO_STOREYS = new Set([
  "garage",
  "garages",
  "carport",
  "shed",
  "hut",
  "cabin",
  "barn",
  "stable",
  "greenhouse",
  "warehouse",
  "industrial",
  "service",
  "roof",
  "parking",
  "kiosk",
  "church",
  "chapel",
  "cathedral",
  "mosque",
  "synagogue",
  "temple",
  "tower",
  "ruins",
  "construction",
]);
const TALL_STOREYS = new Set([
  "office",
  "commercial",
  "retail",
  "hotel",
  "university",
  "school",
  "public",
]);

const LOOK_LIMITS = {
  foot: ["footStrength", 0.45, 0, 0.8],
  footh: ["footHeightM", 2.4, 0.3, 6],
  line: ["lineStrength", 0.3, 0, 1],
  win: ["windowStrength", 0.92, 0, 1],
  eave: ["eaveStrength", 0.22, 0, 0.8],
};

/** The look's numbers from the link; junk takes the default, the rest clamps. */
export function parseLook(search) {
  const params = new URLSearchParams(search);
  const look = {};
  for (const [name, [key, fallback, min, max]] of Object.entries(LOOK_LIMITS)) {
    const raw = params.get(name);
    const value = raw === null || raw === "" ? NaN : Number(raw);
    look[key] = Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  }
  return look;
}

/** `#rgb`, `#rrggbb` or a known name, as packed RGB; undefined for the rest. */
function taggedColour(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().toLowerCase();
  const long = /^#?([0-9a-f]{6})$/.exec(text);
  if (long) return Number.parseInt(long[1], 16);
  const short = /^#([0-9a-f]{3})$/.exec(text);
  if (short) {
    const [r, g, b] = short[1];
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  return NAMED_COLOURS[text];
}

/** A small lightness step from the id: neighbours differ, nothing is loud. */
function toned(rgb, key) {
  const scale = 1 + INFERRED_TONE_SPREAD * (2 * seededRandom(key) - 1);
  const channel = (shift) =>
    Math.min(255, Math.round(((rgb >> shift) & 0xff) * scale));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A house in a town where the only tag is its address is still a house. */
function inferredWall(tags) {
  const known = WALL_CLASSES[tags.building];
  if (known !== undefined) return known;
  if (SCHOOL_AMENITIES.has(tags.amenity)) return WALL_CLASSES.school;
  if (tags.amenity === "place_of_worship") return WALL_CLASSES.church;
  if (tags.amenity !== undefined) return WALL_CLASSES.public;
  if (tags["addr:street"] !== undefined) return PLASTER;
  return NEUTRAL_WALL;
}

/**
 * The wall colour, packed. `tags` are the building's (a part's own over its
 * parent's). `building:colour` and `building:material` are the mapper's and
 * come back unchanged; only the inferred tone is moved by `key`, the OSM id.
 */
export function wallRgb(tags, key) {
  return (
    taggedColour(tags["building:colour"]) ??
    WALL_MATERIALS[tags["building:material"]] ??
    toned(inferredWall(tags), key)
  );
}

function inferredRoof(tags) {
  if (tags["roof:shape"] === "flat") return GRAVEL_ROOF;
  if (WALL_CLASSES[tags.building] === WALL_CLASSES.church) return SLATE_ROOF;
  if (tags.amenity === "place_of_worship") return SLATE_ROOF;
  if (tags["addr:street"] !== undefined) return TILE_ROOF;
  if (NO_STOREYS.has(tags.building)) return DRAB_ROOF;
  if (tags.building !== "yes" && tags.building !== undefined) return TILE_ROOF;
  return DRAB_ROOF;
}

/** The roof colour, packed: `roof:colour`, `roof:material`, then inferred. */
export function roofRgb(tags, key) {
  return (
    taggedColour(tags["roof:colour"]) ??
    ROOF_MATERIALS[tags["roof:material"]] ??
    toned(inferredRoof(tags), `${key}/roof`)
  );
}

/**
 * Metres per storey for a wall reaching `spanM`, or 0 when no storeys should be
 * drawn. `tags` are the class's (the parent's for a part), `ownTags` the
 * volume's own: a parent's level count does not describe a part. `perimeterM`
 * is the size evidence for an otherwise bare `building=yes`.
 */
export function storeyHeightM(tags, ownTags, spanM, perimeterM = 0) {
  if (NO_STOREYS.has(tags.building)) return 0;
  const fallback = TALL_STOREYS.has(tags.building)
    ? TALL_STOREY_M
    : DEFAULT_STOREY_M;
  const levels = Number(ownTags["building:levels"]);
  if (levels > 0) {
    const fromLevels = spanM / levels;
    if (fromLevels >= MIN_STOREY_M && fromLevels <= MAX_STOREY_M) {
      return fromLevels;
    }
    return fallback;
  }
  if (tags.building !== "yes") return fallback;
  // A small bare `yes` is as likely a garage as a house.
  const hasSign =
    tags["addr:street"] !== undefined ||
    tags["building:levels"] !== undefined ||
    (tags.amenity !== undefined && tags.amenity !== "shelter") ||
    perimeterM >= HOUSE_PERIMETER_M;
  return hasSign ? fallback : 0;
}

/** Metres per bay, cosmetic, seeded from the OSM id. */
export function bayWidthM(key) {
  return MIN_BAY_M + BAY_RANGE_M * seededRandom(`${key}/bay`);
}

/** Total length of a volume's walls, inner courtyards included. */
export function perimeterOf(mesh) {
  const p = mesh.positions;
  const n = mesh.normals;
  let total = 0;
  for (let i = 0; i < p.length / 3; i++) {
    if (!isWallQuad(p, n, i)) continue;
    total += Math.hypot(
      p[(i + 1) * 3] - p[i * 3],
      p[(i + 1) * 3 + 2] - p[i * 3 + 2],
    );
    i += 3;
  }
  return total;
}

/** How many whole bays a wall of `lengthM` holds. */
export function bayCount(lengthM, bayM) {
  return Math.floor(lengthM / bayM + BAY_ROUND_UP);
}

function isWallQuad(p, n, i) {
  if (i + 3 >= p.length / 3) return false;
  for (let v = 0; v < 4; v++) {
    if (Math.abs(n[(i + v) * 3 + 1]) > WALL_MAX_NORMAL_Y) return false;
  }
  const y = (v) => p[(i + v) * 3 + 1];
  const above = (a, b) =>
    p[(i + a) * 3] === p[(i + b) * 3] &&
    p[(i + a) * 3 + 2] === p[(i + b) * 3 + 2];
  return (
    y(0) === y(1) && y(2) === y(3) && y(2) > y(0) && above(0, 3) && above(1, 2)
  );
}

/** A display colour's channel in linear light, as three.js expects it. */
function linearChannel(channel) {
  const c = (channel & 0xff) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The per-vertex buffers of one volume, geometry untouched. `spec`: `baseY`
 * (the ground under it), `storeyM`, `bayM` (0 for none), `wall`, `roof`
 * (packed colours). `facade` holds, per vertex, metres above the ground, metres
 * per storey, the bay coordinate and the wall's top above the ground; top 0
 * means a roof, which the shader leaves alone. `colours` are linear.
 */
export function facadeFor(mesh, { baseY, storeyM, bayM, wall, roof }) {
  const p = mesh.positions;
  const n = mesh.normals;
  const count = p.length / 3;
  const facade = new Float32Array(count * 4);
  const colours = new Float32Array(count * 3);
  const put = (i, u, topM, isWall) => {
    facade[i * 4] = p[i * 3 + 1] - baseY;
    facade[i * 4 + 1] = isWall ? storeyM : 0;
    facade[i * 4 + 2] = u;
    facade[i * 4 + 3] = isWall ? topM : 0;
    const rgb = isWall ? wall : roof;
    colours[i * 3] = linearChannel(rgb >> 16);
    colours[i * 3 + 1] = linearChannel(rgb >> 8);
    colours[i * 3 + 2] = linearChannel(rgb);
  };
  let i = 0;
  while (i < count) {
    if (isWallQuad(p, n, i)) {
      const lengthM = Math.hypot(
        p[(i + 1) * 3] - p[i * 3],
        p[(i + 1) * 3 + 2] - p[i * 3 + 2],
      );
      const bays = bayM > 0 ? bayCount(lengthM, bayM) : 0;
      const topM = p[(i + 2) * 3 + 1] - baseY;
      put(i, 0, topM, true);
      put(i + 1, bays, topM, true);
      put(i + 2, bays, topM, true);
      put(i + 3, 0, topM, true);
      i += 4;
    } else {
      // A gable triangle keeps its storey lines and its wall colour, no windows.
      const isWall = Math.abs(n[i * 3 + 1]) <= WALL_MAX_NORMAL_Y;
      put(i, 0, GABLE_TOP_M, isWall);
      i += 1;
    }
  }
  return { facade, colours };
}

/** Far above any eave, so a gable gets no eave shade across its slope. */
const GABLE_TOP_M = 1000;
