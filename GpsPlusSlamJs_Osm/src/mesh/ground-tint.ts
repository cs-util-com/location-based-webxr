/**
 * The land-use ground tint: which mapped area paints which class into the
 * ground, in which muted colour, in which order, rasterised into a class
 * index over the build window (city objects plan 2026-11-07-2315 M3, a port
 * of the O2 painted-ground prototype the owner chose).
 *
 * A PURE RASTERISER, not `OffscreenCanvas`: it runs in both workers and in
 * node tests, and it is deterministic (the same features paint the same
 * texels on every device). Even-odd scanline fill per polygon, holes
 * included, sampled at texel centres.
 *
 * Renders nothing itself: `three/ground-tint.ts` turns the result into a
 * texture and patches a ground material with it.
 *
 * @see ground-tint.ts.md
 */

import type { Bbox } from "../spatial/clip.js";
import {
  featureKey,
  type OsmFeature,
  type OsmTags,
} from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import { ringToEnu, type EnuFrame, type EnuPoint } from "./enu.js";
import type { Rgb } from "./feature-colours.js";

/** The land-use classes the tint paints. */
export const GROUND_CLASS_NAMES = [
  "residential",
  "commercial",
  "industrial",
  "railway",
  "institutional",
  "construction",
  "farmyard",
  "farmland",
  "meadow",
  "grass",
  "park",
  "orchard",
  "allotments",
  "cemetery",
  "wood",
  "scrub",
  "wetland",
  "sand",
  "sport",
  "water",
  "pitch",
  "court",
  "playground",
  "parking",
  "square",
] as const;

export type GroundClass = (typeof GROUND_CLASS_NAMES)[number];

/**
 * The neutral ground: OsmDemo's ground colour (`surface-colours.ts`
 * `GROUND_COLOUR`), the colour of every texel no class paints and the blend
 * target of every class. sRGB.
 */
export const DEFAULT_GROUND_RGB: Rgb = 0x6b7280;

/**
 * O2's muted class colours, sRGB. All sit near the neutral ground in
 * lightness with a chroma (max minus min channel) under 45, so the heat ramp
 * stays the loudest colour (DEC-R4-5).
 */
export const DEFAULT_LAND_USE_RGB: ReadonlyMap<GroundClass, Rgb> = new Map<
  GroundClass,
  Rgb
>([
  ["residential", 0x74757a],
  ["commercial", 0x7c7579],
  ["industrial", 0x787570],
  ["railway", 0x6f6c6b],
  ["institutional", 0x77757f],
  ["construction", 0x7f786d],
  ["farmyard", 0x847c6d],
  ["farmland", 0x948e74],
  ["meadow", 0x878f70],
  ["grass", 0x7e8a6e],
  ["park", 0x7a866c],
  ["orchard", 0x858a69],
  ["allotments", 0x828867],
  ["cemetery", 0x737c6c],
  ["wood", 0x5f6e58],
  ["scrub", 0x6e765f],
  ["wetland", 0x6b7a72],
  ["sand", 0x9f9984],
  ["sport", 0x787e76],
  ["water", 0x6b8194],
  ["pitch", 0x7a8e74],
  ["court", 0x8b837e],
  ["playground", 0x928875],
  ["parking", 0x898b90],
  ["square", 0x8a8884],
]);

/**
 * The tier of each class. A higher tier paints later and wins where uses
 * overlap: 0 zoning (the broad use of a district), 1 open land, 2 water
 * (above the land it lies in), 3 surfaces (a pitch, a car park, a square, a
 * pier: laid over the others).
 */
export const GROUND_CLASS_TIERS: ReadonlyMap<GroundClass, 0 | 1 | 2 | 3> =
  new Map<GroundClass, 0 | 1 | 2 | 3>([
    ["residential", 0],
    ["commercial", 0],
    ["industrial", 0],
    ["railway", 0],
    ["institutional", 0],
    ["construction", 0],
    ["farmyard", 0],
    ["farmland", 1],
    ["meadow", 1],
    ["grass", 1],
    ["park", 1],
    ["orchard", 1],
    ["allotments", 1],
    ["cemetery", 1],
    ["wood", 1],
    ["scrub", 1],
    ["wetland", 1],
    ["sand", 1],
    ["sport", 1],
    ["water", 2],
    ["pitch", 3],
    ["court", 3],
    ["playground", 3],
    ["parking", 3],
    ["square", 3],
  ]);

/**
 * Value tables per key; the first key of `KEY_ORDER` a feature carries with
 * a known value decides. Maps, not objects: tag values are free text, and on
 * an object `landuse=constructor` finds an inherited function.
 */
const BY_KEY: ReadonlyMap<string, ReadonlyMap<string, GroundClass>> = new Map(
  Object.entries({
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
  }).map(([key, table]) => [
    key,
    new Map(Object.entries(table)) as ReadonlyMap<string, GroundClass>,
  ]),
);

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
] as const;

/** Pitch surfaces that make a pitch a court (a hard or laid surface). */
const HARD_SURFACES: ReadonlySet<string> = new Set([
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
 * A pedestrian area, any `highway=*` with `area=yes` (a square, a paved
 * plaza mapped as a footway area): a surface, never a street (`roads.ts`
 * `isRoad` leaves exactly these to the area builders). ONE predicate for the
 * tint and the area mesh (`pedestrian-areas.ts`), so a square is never
 * classified two ways. The set the chosen O3 prototype drew; it was
 * `highway=pedestrian` alone before the area mesh.
 */
export function isPedestrianArea(tags: OsmTags): boolean {
  return tags["highway"] !== undefined && tags["area"] === "yes";
}

/**
 * The class a feature's tags paint, or undefined for none. A building never
 * paints (its footprint is covered); any `water=*` value on a non-building
 * is water; a pitch with a hard `surface` is a court; a pedestrian area is
 * a square. Never throws: anything that is not a tag object paints nothing.
 */
export function groundClassOf(tags: unknown): GroundClass | undefined {
  if (typeof tags !== "object" || tags === null) return undefined;
  const t = tags as OsmTags;
  const building = t["building"];
  if (building !== undefined && building !== "no") return undefined;
  const cls = classByKeys(t);
  if (cls === "pitch" && HARD_SURFACES.has(t["surface"] ?? "")) {
    return "court";
  }
  return cls ?? (isPedestrianArea(t) ? "square" : undefined);
}

/** The first key of `KEY_ORDER` the tags carry with a known value. */
function classByKeys(t: OsmTags): GroundClass | undefined {
  for (const key of KEY_ORDER) {
    const value = t[key];
    if (typeof value !== "string") continue;
    const cls = key === "water" ? "water" : BY_KEY.get(key)?.get(value);
    if (cls !== undefined) return cls;
  }
  return undefined;
}

/** One area to paint: its class, key, area and polygons in ENU metres. */
export interface GroundTintEntry {
  readonly key: string;
  readonly cls: GroundClass;
  readonly areaM2: number;
  /** Polygons, each a ring list: the outer ring first, then its holes. */
  readonly polygons: readonly (readonly (readonly EnuPoint[])[])[];
}

/**
 * The order to paint in, last on top: tier ascending, then area descending
 * (a smaller use nested in a larger one of its tier wins), then the key, so
 * the result never depends on the data's order.
 */
export function paintOrder(
  entries: readonly GroundTintEntry[],
): GroundTintEntry[] {
  const tier = (cls: GroundClass): number => GROUND_CLASS_TIERS.get(cls) ?? 0;
  return [...entries].sort((a, b) => {
    const byTier = tier(a.cls) - tier(b.cls);
    if (byTier !== 0) return byTier;
    if (a.areaM2 !== b.areaM2) return b.areaM2 - a.areaM2;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function ringAreaM2(ring: readonly EnuPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as EnuPoint;
    const q = ring[(i + 1) % ring.length] as EnuPoint;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** Shoelace area of a polygon in m2: the outer ring minus its holes. */
export function polygonAreaM2(rings: readonly (readonly EnuPoint[])[]): number {
  const [outer, ...holes] = rings;
  if (outer === undefined) return 0;
  return holes.reduce(
    (area, hole) => area - ringAreaM2(hole),
    ringAreaM2(outer),
  );
}

/** The largest texture side asked for (WebGL2 phones take 4096). */
export const MAX_GROUND_TINT_SIDE = 2048;

/** The default texel, metres; it grows when the window would exceed the cap. */
export const DEFAULT_GROUND_TINT_TEXEL_M = 2;

/** A local box in ENU metres. */
export interface EnuBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The raster over a box: size, texel, and RGBA8 bytes without mipmaps. */
export interface GroundTintPlan {
  readonly width: number;
  readonly height: number;
  readonly texelM: number;
}

/**
 * The raster over `box` at `texelM` metres a texel, capped at
 * `MAX_GROUND_TINT_SIDE` a side (the texel grows then). RangeError for a
 * texel that is not a positive number or an empty or non-finite box.
 */
export function groundTintPlan(box: EnuBox, texelM: number): GroundTintPlan {
  if (!(texelM > 0) || !Number.isFinite(texelM)) {
    throw new RangeError(`texelM must be a positive number, got ${texelM}`);
  }
  const sizeX = box.maxX - box.minX;
  const sizeY = box.maxY - box.minY;
  if (!(sizeX > 0) || !(sizeY > 0) || !Number.isFinite(sizeX + sizeY)) {
    throw new RangeError("the ground tint needs a non-empty finite window");
  }
  const texel = Math.max(texelM, Math.max(sizeX, sizeY) / MAX_GROUND_TINT_SIDE);
  const width = Math.min(
    MAX_GROUND_TINT_SIDE,
    Math.max(1, Math.ceil(sizeX / texel - 1e-9)),
  );
  const height = Math.min(
    MAX_GROUND_TINT_SIDE,
    Math.max(1, Math.ceil(sizeY / texel - 1e-9)),
  );
  return { width, height, texelM: texel };
}

/**
 * Fills `polygon` (outer ring plus holes, even-odd) into `classes` with
 * `value`, at texel centres. Row 0 is the SOUTH edge of the box. Crossings
 * are bucketed per row, so a ring of many thousand points costs its edges
 * plus its crossings, not edges times rows.
 */
function fillPolygon(
  classes: Uint8Array,
  plan: GroundTintPlan,
  box: EnuBox,
  polygon: readonly (readonly EnuPoint[])[],
  value: number,
): void {
  const { width, texelM } = plan;
  const rows: number[][] = [];
  for (const ring of polygon) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      addCrossings(
        rows,
        plan,
        box,
        ring[i] as EnuPoint,
        ring[(i + 1) % n] as EnuPoint,
      );
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const xs = rows[r];
    if (xs === undefined) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Columns whose centre x = minX + (c + 0.5) * texel lies in [x0, x1).
      const x0 = xs[k] as number;
      const x1 = xs[k + 1] as number;
      const c0 = Math.max(0, Math.ceil((x0 - box.minX) / texelM - 0.5));
      const c1 = Math.min(
        width - 1,
        Math.ceil((x1 - box.minX) / texelM - 0.5) - 1,
      );
      classes.fill(
        value,
        r * width + c0,
        c1 < c0 ? r * width + c0 : r * width + c1 + 1,
      );
    }
  }
}

/**
 * Adds where edge a-b crosses each row's centre line to `rows`. Half-open
 * in y ([lo, hi)), so a vertex shared by two edges counts once.
 */
function addCrossings(
  rows: number[][],
  plan: GroundTintPlan,
  box: EnuBox,
  a: EnuPoint,
  b: EnuPoint,
): void {
  if (a.y === b.y) return;
  const { height, texelM } = plan;
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  // Rows whose centre y = minY + (r + 0.5) * texel lies in [lo, hi).
  const r0 = Math.max(0, Math.ceil((lo - box.minY) / texelM - 0.5));
  const r1 = Math.min(
    height - 1,
    Math.ceil((hi - box.minY) / texelM - 0.5) - 1,
  );
  for (let r = r0; r <= r1; r++) {
    const yc = box.minY + (r + 0.5) * texelM;
    if (!(yc >= lo && yc < hi)) continue;
    const x = a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y);
    (rows[r] ??= []).push(x);
  }
}

/** Options of `buildGroundTint`. */
export interface BuildGroundTintOptions {
  readonly frame: EnuFrame;
  /** The build window (lat/lng): the raster covers it and nothing else. */
  readonly window: Bbox;
  /** Metres a texel; default `DEFAULT_GROUND_TINT_TEXEL_M`. */
  readonly texelM?: number;
  /** The neutral ground (palette index 0). */
  readonly ground: Rgb;
  /** The class colours. */
  readonly landUse: ReadonlyMap<GroundClass, Rgb>;
}

/**
 * The painted ground over the build window, as a class index per texel and
 * the palette it indexes. Bytes cross the worker boundary as `classes`
 * (one byte a texel); the renderer expands it.
 */
export interface GroundTint {
  readonly width: number;
  readonly height: number;
  readonly texelM: number;
  /** ENU metres of the window's south-west corner (texel 0's corner). */
  readonly originX: number;
  readonly originY: number;
  /**
   * Row-major, row 0 the SOUTH edge: 0 for unpainted ground, `i + 1` for
   * `GROUND_CLASS_NAMES[i]`.
   */
  readonly classes: Uint8Array;
  /** sRGB, `palette[0]` the neutral ground, `palette[i + 1]` class i. */
  readonly palette: readonly Rgb[];
  /** Share of the window painted by each present class, 0..1. */
  readonly shares: Readonly<Partial<Record<GroundClass, number>>>;
  /** Areas with a class whose geometry gave no polygon (unclosed lines...). */
  readonly skipped: number;
}

function localBox(window: Bbox, frame: EnuFrame): EnuBox {
  const sw = frame.toEnu({ lat: window.south, lng: window.west });
  const ne = frame.toEnu({ lat: window.north, lng: window.east });
  return { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y };
}

/** Every land-use area of `features` with its class and polygons. */
function groundTintEntries(
  features: Iterable<OsmFeature>,
  frame: EnuFrame,
): { entries: GroundTintEntry[]; skipped: number } {
  const entries: GroundTintEntry[] = [];
  let skipped = 0;
  for (const feature of features) {
    if (feature.type === "node") continue;
    const cls = groundClassOf(feature.tags);
    if (cls === undefined) continue;
    const result = toGeometry(feature);
    const raw = !result.ok
      ? undefined
      : result.geometry.kind === "polygon"
        ? [result.geometry.rings]
        : result.geometry.kind === "multipolygon"
          ? result.geometry.polygons
          : undefined;
    const polygons = (raw ?? [])
      .map((rings) =>
        rings
          .map((ring) => ringToEnu(ring, frame))
          .filter((r) => r.length >= 3),
      )
      .filter((rings) => rings.length > 0);
    if (polygons.length === 0) {
      skipped++;
      continue;
    }
    const areaM2 = polygons.reduce((sum, p) => sum + polygonAreaM2(p), 0);
    entries.push({ key: featureKey(feature), cls, areaM2, polygons });
  }
  return { entries, skipped };
}

/**
 * Paints the land use of `features` over `options.window`. RangeError for a
 * bad texel, an empty window, or a colour map missing a class.
 */
export function buildGroundTint(
  features: Iterable<OsmFeature>,
  options: BuildGroundTintOptions,
): GroundTint {
  const box = localBox(options.window, options.frame);
  const plan = groundTintPlan(
    box,
    options.texelM ?? DEFAULT_GROUND_TINT_TEXEL_M,
  );
  const palette: Rgb[] = [options.ground];
  for (const cls of GROUND_CLASS_NAMES) {
    const colour = options.landUse.get(cls);
    if (colour === undefined) {
      throw new RangeError(`the ground tint has no colour for "${cls}"`);
    }
    palette.push(colour);
  }
  const { entries, skipped } = groundTintEntries(features, options.frame);
  const classes = new Uint8Array(plan.width * plan.height);
  for (const entry of paintOrder(entries)) {
    const value = GROUND_CLASS_NAMES.indexOf(entry.cls) + 1;
    for (const polygon of entry.polygons) {
      fillPolygon(classes, plan, box, polygon, value);
    }
  }
  const counts = new Array<number>(GROUND_CLASS_NAMES.length + 1).fill(0);
  for (const v of classes) counts[v] = (counts[v] ?? 0) + 1;
  const shares: Partial<Record<GroundClass, number>> = {};
  GROUND_CLASS_NAMES.forEach((cls, i) => {
    const n = counts[i + 1] ?? 0;
    if (n > 0) shares[cls] = n / classes.length;
  });
  return {
    width: plan.width,
    height: plan.height,
    texelM: plan.texelM,
    originX: box.minX,
    originY: box.minY,
    classes,
    palette,
    shares,
    skipped,
  };
}
