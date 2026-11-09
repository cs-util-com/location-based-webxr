/**
 * O2's pure decisions: which land use a feature paints into the ground, in
 * which muted colour, in which order, and how large the ground texture is.
 * No three.js and no DOM, so a node test reaches all of it.
 *
 * @see painted-ground-rules.js.md
 */

/**
 * The classes, their colour (sRGB hex) and their tier. A higher tier paints
 * later and wins where uses overlap:
 * - 0 zoning: the broad use of a district (a residential zone holds gardens,
 *   parks and pitches);
 * - 1 open land: what the ground of an open area is;
 * - 2 water, above the land it lies in;
 * - 3 surfaces: the most specific, built or laid over the others (a pitch, a
 *   car park, a square, a pier).
 * All colours sit near today's slate ground (0x6b7280) in lightness, with a
 * chroma under 45.
 */
export const GROUND_CLASSES = Object.freeze({
  residential: { colour: 0x74757a, tier: 0, label: "Residential" },
  commercial: { colour: 0x7c7579, tier: 0, label: "Commercial" },
  industrial: { colour: 0x787570, tier: 0, label: "Industrial" },
  railway: { colour: 0x6f6c6b, tier: 0, label: "Railway land" },
  institutional: { colour: 0x77757f, tier: 0, label: "Institution" },
  construction: { colour: 0x7f786d, tier: 0, label: "Construction" },
  farmyard: { colour: 0x847c6d, tier: 0, label: "Farmyard" },
  farmland: { colour: 0x948e74, tier: 1, label: "Farmland" },
  meadow: { colour: 0x878f70, tier: 1, label: "Meadow" },
  grass: { colour: 0x7e8a6e, tier: 1, label: "Grass, green" },
  park: { colour: 0x7a866c, tier: 1, label: "Park, garden" },
  orchard: { colour: 0x858a69, tier: 1, label: "Orchard" },
  allotments: { colour: 0x828867, tier: 1, label: "Allotments" },
  cemetery: { colour: 0x737c6c, tier: 1, label: "Cemetery" },
  wood: { colour: 0x5f6e58, tier: 1, label: "Wood, forest" },
  scrub: { colour: 0x6e765f, tier: 1, label: "Scrub, heath" },
  wetland: { colour: 0x6b7a72, tier: 1, label: "Wetland" },
  sand: { colour: 0x9f9984, tier: 1, label: "Sand, beach" },
  sport: { colour: 0x787e76, tier: 1, label: "Sports ground" },
  water: { colour: 0x6b8194, tier: 2, label: "Water" },
  pitch: { colour: 0x7a8e74, tier: 3, label: "Pitch" },
  court: { colour: 0x8b837e, tier: 3, label: "Court, track" },
  playground: { colour: 0x928875, tier: 3, label: "Playground" },
  parking: { colour: 0x898b90, tier: 3, label: "Parking" },
  square: { colour: 0x8a8884, tier: 3, label: "Square, pier" },
});

/** Value tables per key; the first key found in `KEY_ORDER` decides. */
const BY_KEY = {
  water: { "*": "water" },
  waterway: { riverbank: "water", dock: "water" },
  leisure: {
    swimming_pool: "water",
    park: "park",
    garden: "park",
    common: "grass",
    golf_course: "grass",
    dog_park: "grass",
    pitch: "pitch",
    track: "court",
    playground: "playground",
    sports_centre: "sport",
    stadium: "sport",
  },
  amenity: {
    parking: "parking",
    grave_yard: "cemetery",
    school: "institutional",
    college: "institutional",
    university: "institutional",
    kindergarten: "institutional",
    hospital: "institutional",
  },
  natural: {
    water: "water",
    wood: "wood",
    grassland: "meadow",
    scrub: "scrub",
    heath: "scrub",
    wetland: "wetland",
    sand: "sand",
    beach: "sand",
  },
  landuse: {
    basin: "water",
    reservoir: "water",
    residential: "residential",
    commercial: "commercial",
    retail: "commercial",
    industrial: "industrial",
    railway: "railway",
    education: "institutional",
    institutional: "institutional",
    religious: "institutional",
    construction: "construction",
    brownfield: "construction",
    farmyard: "farmyard",
    farmland: "farmland",
    meadow: "meadow",
    grass: "grass",
    village_green: "grass",
    recreation_ground: "grass",
    orchard: "orchard",
    vineyard: "orchard",
    allotments: "allotments",
    cemetery: "cemetery",
    forest: "wood",
  },
  man_made: { pier: "square" },
  place: { square: "square" },
};

/** Water first, so a reservoir tagged both ways reads as water. */
const KEY_ORDER = [
  "water",
  "waterway",
  "natural",
  "leisure",
  "amenity",
  "landuse",
  "man_made",
  "place",
];

const HARD_SURFACES = new Set([
  "asphalt",
  "concrete",
  "tartan",
  "clay",
  "paved",
  "paving_stones",
  "acrylic",
  "artificial_turf",
  "compacted",
  "fine_gravel",
  "gravel",
  "sand",
]);

/**
 * The class a feature's tags paint, or null for none. A building never
 * paints (its footprint is covered); `water=*` on a non-building always
 * means water; a pitch with a hard `surface` is a court; a pedestrian area
 * (`highway=pedestrian` with `area=yes`) is a square, a street never.
 */
export function landuseClassOf(tags) {
  if (!tags || typeof tags !== "object") return null;
  if (tags.building !== undefined && tags.building !== "no") return null;
  for (const key of KEY_ORDER) {
    const value = tags[key];
    if (value === undefined) continue;
    const table = BY_KEY[key];
    const cls = table[value] ?? table["*"];
    if (!cls) continue;
    if (cls === "pitch" && HARD_SURFACES.has(tags.surface)) return "court";
    return cls;
  }
  if (tags.highway === "pedestrian" && tags.area === "yes") return "square";
  return null;
}

/**
 * The order to paint in, last on top: tier ascending, then area descending
 * (a smaller use nested in a larger one of its tier wins), then the OSM key,
 * so the result never depends on the data's order. Entries: `{ key, cls, area }`.
 */
export function paintOrder(entries) {
  return [...entries].sort((a, b) => {
    const tier = GROUND_CLASSES[a.cls].tier - GROUND_CLASSES[b.cls].tier;
    if (tier !== 0) return tier;
    if (a.area !== b.area) return b.area - a.area;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Chroma as DEC-R4-5 measures it: largest sRGB channel minus smallest. */
export function chroma(hex) {
  const channels = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  return Math.max(...channels) - Math.min(...channels);
}

/**
 * A class's colour pulled towards `neutral` (today's ground) by `strength`
 * in [0, 1]: 0 is the neutral ground, 1 the class colour. In sRGB, which is
 * how the canvas paints it.
 */
export function paintColour(cls, strength, neutral) {
  const target = GROUND_CLASSES[cls].colour;
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = (neutral >> shift) & 255;
    const b = (target >> shift) & 255;
    out |= Math.round(a + (b - a) * s) << shift;
  }
  return out;
}

/** Shoelace area of a polygon in m2: the outer ring minus its holes. */
export function polygonAreaM2(rings) {
  const ringArea = (ring) => {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      sum += p.x * q.y - q.x * p.y;
    }
    return Math.abs(sum) / 2;
  };
  const [outer, ...holes] = rings;
  if (!outer) return 0;
  return holes.reduce((area, hole) => area - ringArea(hole), ringArea(outer));
}

/** The largest texture side the page asks for; WebGL2 phones take 4096. */
export const MAX_TEXTURE_SIDE = 2048;

/**
 * The ground texture over a local box `{ minX, minY, maxX, maxY }` (metres)
 * at `texelM` metres a texel, capped at `MAX_TEXTURE_SIDE` a side (the texel
 * grows then). `bytes` is RGBA8 without mipmaps.
 */
export function rasterPlan(box, texelM) {
  const sizeX = box.maxX - box.minX;
  const sizeY = box.maxY - box.minY;
  const wanted = Math.max(0.05, Number(texelM) || 1);
  const texel = Math.max(wanted, Math.max(sizeX, sizeY) / MAX_TEXTURE_SIDE);
  const width = Math.min(MAX_TEXTURE_SIDE, Math.ceil(sizeX / texel - 1e-9));
  const height = Math.min(MAX_TEXTURE_SIDE, Math.ceil(sizeY / texel - 1e-9));
  return { width, height, texelM: texel, bytes: width * height * 4 };
}
