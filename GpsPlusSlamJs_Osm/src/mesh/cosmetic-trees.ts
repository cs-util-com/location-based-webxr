/**
 * Cosmetic trees: the trees a mapped wood, orchard or tree row implies but
 * does not map one by one.
 *
 * WHY INVENTED TREES ARE KEPT APART. `trees.ts` places a tree where a mapper
 * put a `natural=tree` node; everything here is a guess at where trees stand
 * inside a `landuse=forest` / `natural=wood` area, on an orchard's grid, or
 * along a `natural=tree_row` line. A guess must never be mistaken for data:
 * every placement says `cosmetic: true`, `buildCity` returns them in their own
 * field, never in `City.trees`, and they are never `OsmFeature`s, so
 * navigation and scoring cannot see them (city objects plan 2026-11-07-2315
 * section 4).
 *
 * THE WOOD GRID IS ANCHORED GLOBALLY, in latitude and longitude, not to the
 * frame origin. OsmDemo re-anchors its frame as the user walks and the globe
 * gives every city its own frame; a grid tied to the origin would move every
 * tree of a wood on each re-anchor. Rows of the grid are a fixed number of
 * degrees of latitude tall, and each row's cells a fixed number of degrees of
 * longitude wide for that row's latitude, so one wood gives the same trees in
 * every frame, on every device and on every reload (the determinism contract
 * of `trees.ts`). Orchards and rows take their own frame from their own first
 * vertex for the same reason.
 *
 * ORDER IS PART OF THE CONTRACT: placements come back sorted by a seeded rank
 * (`cosmeticRank`), so a cap, or a phone governor that draws only the first n
 * instances, thins a wood evenly rather than stopping at an edge.
 *
 * @see cosmetic-trees.ts.md
 */

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { featureKey } from "../model/osm-feature.js";
import { toGeometry, type OsmGeometry } from "../model/osm-geometry.js";
import { clipToBbox, type Bbox } from "../spatial/clip.js";
import { containsPoint, type PlanarPoint } from "../spatial/point-in-ring.js";
import {
  ENU_METRES_PER_DEG_LAT,
  ENU_METRES_PER_DEG_LNG_EQUATOR,
  enuFrameAt,
  type EnuFrame,
  type EnuPoint,
} from "./enu.js";
import { isRoad, roadWidthM } from "./roads.js";
import { stableRotationY, unit } from "./stable-jitter.js";
import {
  DEFAULT_CROWN_RATIO,
  DEFAULT_TREE_HEIGHT_M,
  TREE_COLOUR_JITTER,
  isTree,
  treeClass,
  treeColour,
  type TreeClass,
  type TreePlacement,
  type TreeVariant,
} from "./trees.js";

/** Trees per m2 in a wood (O1's value; at 0.01 a wood read as a park). */
export const COSMETIC_WOOD_DENSITY_PER_M2 = 0.02;
/**
 * The most cosmetic trees one build keeps, by seeded rank. A safety net, not
 * the phone answer (that is a governor drawing fewer instances); O1's 3,000
 * would bind at an ordinary forest edge.
 */
export const COSMETIC_TREE_CAP = 20_000;
/** Clearance a wood or orchard tree keeps beyond a road's half width, metres. */
export const COSMETIC_ROAD_MARGIN_M = 1;
/** A wood tree's default height, as a multiple of a lone tree's. */
const WOOD_HEIGHT_FACTOR = 1.5;
/** Orchard grid spacing, metres. */
const ORCHARD_SPACING_M = 6;
/** An orchard tree's default height, metres. */
export const ORCHARD_HEIGHT_M = 4.5;
/** Spacing of the trees along a `natural=tree_row`, metres. */
export const TREE_ROW_SPACING_M = 8;
/** A row tree is dropped this close to a mapped tree, metres. */
const TREE_ROW_CLEAR_M = 4;

/** Which kind of mapped feature implied a cosmetic tree. */
export type CosmeticTreeSource = "wood" | "orchard" | "tree_row";

/**
 * One invented tree. A `TreePlacement` (so it packs and draws exactly as a
 * mapped one) whose `feature` is the wood, orchard or row it was invented
 * for, plus its own stable `key`, its `source` and `cosmetic: true`.
 */
export interface CosmeticTreePlacement extends TreePlacement {
  /** Stable per tree: the source feature's key plus its grid cell or index. */
  readonly key: string;
  readonly source: CosmeticTreeSource;
  readonly cosmetic: true;
}

export interface BuildCosmeticTreesOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
  /**
   * The bounding box of the data the caller fetched. Required: a wood
   * relation reaches far outside any fetch, and no tree is placed outside
   * this box.
   */
  readonly window: Bbox;
  /**
   * Rings in the frame's ENU metres no wood or orchard tree stands inside
   * (the building footprints `buildBuildings` returns).
   */
  readonly excludeRings?: readonly (readonly EnuPoint[])[];
  /** Default `COSMETIC_WOOD_DENSITY_PER_M2`. Must be above zero. */
  readonly densityPerM2?: number;
  /** Default `COSMETIC_TREE_CAP`. A whole number above zero, or Infinity. */
  readonly cap?: number;
  /** Default `COSMETIC_ROAD_MARGIN_M`. Zero or more. */
  readonly roadMarginM?: number;
  /** The crown palette (a colour scheme's `trees`). Default `TREE_PALETTE`. */
  readonly treePalette?: ReadonlyMap<string, number>;
}

/** What implies cosmetic trees in a feature, or undefined. */
export function cosmeticTreeSource(
  feature: OsmFeature,
): CosmeticTreeSource | undefined {
  if (feature.type === "node") return undefined;
  const tags = feature.tags as Record<string, string>;
  if (tags["landuse"] === "forest" || tags["natural"] === "wood") return "wood";
  if (tags["landuse"] === "orchard") return "orchard";
  if (tags["natural"] === "tree_row") return "tree_row";
  return undefined;
}

/** A cosmetic tree's rank in [0, 1): lower ranks are kept and drawn first. */
export function cosmeticRank(key: string): number {
  return unit(key, "rank");
}

/** A candidate before the cap: where it stands and how it looks. */
interface Candidate {
  readonly key: string;
  readonly feature: string;
  readonly source: CosmeticTreeSource;
  readonly position: LatLng;
  readonly cls: Pick<TreeClass, "leafType" | "leafCycle">;
  readonly defaultHeightM: number;
}

/**
 * The cosmetic trees of `features`, within `options.window`, in rank order.
 * RangeError for a missing or empty window and for options out of range;
 * a feature whose geometry cannot be built places nothing.
 */
export function buildCosmeticTrees(
  features: Iterable<OsmFeature>,
  options: BuildCosmeticTreesOptions,
): CosmeticTreePlacement[] {
  const { window, density, cap, margin } = checkedOptions(options);
  const all = [...features];
  const sources = sortedSources(all);
  if (sources.length === 0) return [];

  const { frame } = options;
  const blocked = exclusion(all, frame, window, options.excludeRings, margin);
  const mapped = all
    .filter(isTree)
    .flatMap((f) => (f.type === "node" ? [frame.toEnu(f.position)] : []));

  const candidates: Candidate[] = [];
  const taken = new Set<string>();
  for (const source of sources) {
    const geometry = toGeometry(source.feature);
    if (!geometry.ok) continue;
    if (source.source === "tree_row") {
      candidates.push(
        ...rowCandidates(source, geometry.geometry, window, (at) =>
          mapped.some((t) => distance(t, frame.toEnu(at)) <= TREE_ROW_CLEAR_M),
        ),
      );
    } else {
      candidates.push(
        ...areaCandidates(source, geometry.geometry, {
          window,
          density,
          taken,
          blocked: (at) => blocked(frame.toEnu(at)),
        }),
      );
    }
  }
  return ranked(candidates, cap).map((c) => placementOf(c, options));
}

interface Source {
  readonly feature: OsmFeature;
  readonly source: CosmeticTreeSource;
  readonly key: string;
}

function checkedOptions(options: BuildCosmeticTreesOptions): {
  window: Bbox;
  density: number;
  cap: number;
  margin: number;
} {
  return {
    window: checkedWindow(options.window),
    density: checkedDensity(
      options.densityPerM2 ?? COSMETIC_WOOD_DENSITY_PER_M2,
    ),
    cap: checkedCap(options.cap ?? COSMETIC_TREE_CAP),
    margin: checkedMargin(options.roadMarginM ?? COSMETIC_ROAD_MARGIN_M),
  };
}

function checkedDensity(density: number): number {
  if (!(density > 0) || !Number.isFinite(density)) {
    throw new RangeError(`densityPerM2 must be above zero, got ${density}`);
  }
  return density;
}

/** A whole number of at least one, or `Infinity` for no cap. */
function checkedCap(cap: number): number {
  if (!(cap >= 1) || (Number.isFinite(cap) && !Number.isInteger(cap))) {
    throw new RangeError(`cap must be a whole number above zero, got ${cap}`);
  }
  return cap;
}

function checkedMargin(margin: number): number {
  if (!(margin >= 0) || !Number.isFinite(margin)) {
    throw new RangeError(`roadMarginM must be zero or more, got ${margin}`);
  }
  return margin;
}

/**
 * The woods, orchards and rows of `all`, in KEY ORDER, so two woods sharing a
 * cell give it to the same wood whatever order the features arrived in.
 */
function sortedSources(all: readonly OsmFeature[]): Source[] {
  const sources: Source[] = [];
  for (const feature of all) {
    const source = cosmeticTreeSource(feature);
    if (source !== undefined) {
      sources.push({ feature, source, key: featureKey(feature) });
    }
  }
  return sources.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A tree row's trees, none within the clearance of a mapped tree. */
function rowCandidates(
  { feature, key }: Source,
  geometry: OsmGeometry,
  window: Bbox,
  nearMappedTree: (at: LatLng) => boolean,
): Candidate[] {
  const cls = treeClass(feature.tags);
  const out: Candidate[] = [];
  for (const position of alongRow(geometry, key, window)) {
    if (nearMappedTree(position.at)) continue;
    out.push({
      key: position.key,
      feature: key,
      source: "tree_row",
      position: position.at,
      cls,
      defaultHeightM: DEFAULT_TREE_HEIGHT_M,
    });
  }
  return out;
}

/** A wood's or an orchard's trees, inside its rings and the window. */
function areaCandidates(
  { feature, source, key }: Source,
  geometry: OsmGeometry,
  context: {
    window: Bbox;
    density: number;
    taken: Set<string>;
    blocked: (at: LatLng) => boolean;
  },
): Candidate[] {
  const { window, density, taken, blocked } = context;
  const cls = treeClass(feature.tags);
  const defaultHeightM =
    source === "wood"
      ? DEFAULT_TREE_HEIGHT_M * WOOD_HEIGHT_FACTOR
      : ORCHARD_HEIGHT_M;
  const out: Candidate[] = [];
  for (const rings of polygonsOf(geometry)) {
    const clipped = clipToBbox({ kind: "polygon", rings }, window);
    if (clipped === undefined || clipped.kind !== "polygon") continue;
    const inside = planarRings(clipped.rings);
    const spots =
      source === "wood"
        ? woodSpots(clipped.rings, key, density, taken)
        : orchardSpots(rings, clipped.rings, key);
    const free = (at: LatLng): boolean =>
      // The window test is a guard: clipping already confines the spots.
      inWindow(window, at) &&
      insideByParity({ x: at.lng, y: at.lat }, inside) &&
      !blocked(at);
    for (const spot of spots) {
      if (!free(spot.at)) continue;
      if (source === "wood") taken.add(spot.cell);
      out.push({
        key: spot.key,
        feature: key,
        source,
        position: spot.at,
        cls: resolvedClass(source, cls, spot.key),
        defaultHeightM,
      });
    }
  }
  return out;
}

/** Sorted by seeded rank (ties by key), the first `cap` kept. */
function ranked(candidates: readonly Candidate[], cap: number): Candidate[] {
  return candidates
    .map((c) => ({ c, rank: cosmeticRank(c.key) }))
    .sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank : a.c.key < b.c.key ? -1 : 1,
    )
    .slice(0, Number.isFinite(cap) ? cap : candidates.length)
    .map(({ c }) => c);
}

function checkedWindow(window: Bbox | undefined): Bbox {
  if (
    window === undefined ||
    window === null ||
    ![window.south, window.west, window.north, window.east].every((v) =>
      Number.isFinite(v),
    ) ||
    !(window.south < window.north) ||
    !(window.west < window.east)
  ) {
    throw new RangeError(
      `window must be a bbox with south < north and west < east, got ${JSON.stringify(window)}`,
    );
  }
  return window;
}

function inWindow(window: Bbox, p: LatLng): boolean {
  return (
    p.lat >= window.south &&
    p.lat <= window.north &&
    p.lng >= window.west &&
    p.lng <= window.east
  );
}

function distance(a: EnuPoint, b: EnuPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rings as planar points, x = longitude, y = latitude. */
function planarRings(rings: readonly (readonly LatLng[])[]): PlanarPoint[][] {
  return rings.map((ring) => ring.map((p) => ({ x: p.lng, y: p.lat })));
}

/**
 * Inside by crossing parity over every ring, so a hole (an inner ring) is
 * outside. The affine lat/lng-to-ENU map keeps the answer the same in any
 * frame.
 */
function insideByParity(
  point: PlanarPoint,
  rings: readonly (readonly PlanarPoint[])[],
): boolean {
  let crossings = 0;
  for (const ring of rings) {
    if (ring.length >= 3 && containsPoint(ring, point)) crossings++;
  }
  return crossings % 2 === 1;
}

function polygonsOf(
  geometry: OsmGeometry,
): readonly (readonly (readonly LatLng[])[])[] {
  if (geometry.kind === "polygon") return [geometry.rings];
  if (geometry.kind === "multipolygon") return geometry.polygons;
  return [];
}

interface Spot {
  readonly at: LatLng;
  readonly key: string;
  /** The wood grid's global cell, or the orchard cell. */
  readonly cell: string;
}

/**
 * One candidate per cell of the global grid over the rings' box, jittered
 * inside its cell from the CELL alone, so two overlapping woods agree on
 * where the cell's tree stands and the first (key order) takes it.
 */
function* woodSpots(
  rings: readonly (readonly LatLng[])[],
  key: string,
  density: number,
  taken: ReadonlySet<string>,
): Generator<Spot> {
  const box = boxOf(rings);
  if (box === undefined) return;
  const stepM = 1 / Math.sqrt(density);
  const dLat = stepM / ENU_METRES_PER_DEG_LAT;
  for (let j = Math.floor(box.south / dLat); j * dLat <= box.north; j++) {
    const rowLat = (j + 0.5) * dLat;
    const cosLat = Math.cos((rowLat * Math.PI) / 180);
    if (!(cosLat > 1e-9)) continue;
    const dLng = stepM / (ENU_METRES_PER_DEG_LNG_EQUATOR * cosLat);
    for (let i = Math.floor(box.west / dLng); i * dLng <= box.east; i++) {
      const cell = `${i}:${j}`;
      if (taken.has(cell)) continue;
      yield {
        at: {
          lat: (j + 0.15 + 0.7 * unit(`wood ${cell}`, "y")) * dLat,
          lng: (i + 0.15 + 0.7 * unit(`wood ${cell}`, "x")) * dLng,
        },
        key: `${key}#${cell}`,
        cell,
      };
    }
  }
}

/**
 * An orchard's grid: rows along the longest edge of the UNCLIPPED outer
 * ring, from its first vertex, in a frame anchored there, so neither the
 * caller's frame nor the window moves a tree.
 */
function* orchardSpots(
  rings: readonly (readonly LatLng[])[],
  clipped: readonly (readonly LatLng[])[],
  key: string,
): Generator<Spot> {
  const outer = rings[0];
  const first = outer?.[0];
  if (outer === undefined || first === undefined || outer.length < 3) return;
  const local = enuFrameAt(first);
  const ring = outer.map((p) => local.toEnu(p));
  let angle = 0;
  let longest = -1;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!;
    const b = ring[(k + 1) % ring.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The clipped rings bound the loop: an orchard is rarely cut by the
  // window, but a box of a cut one would iterate cells nothing can use.
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const p of clipped.flat()) {
    const q = local.toEnu(p);
    const u = q.x * cos + q.y * sin;
    const v = -q.x * sin + q.y * cos;
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  const s = ORCHARD_SPACING_M;
  for (let i = Math.floor(minU / s); i * s <= maxU; i++) {
    for (let j = Math.floor(minV / s); j * s <= maxV; j++) {
      const cell = `o${i}:${j}`;
      const u = (i + 0.5 + (unit(`${key}|${cell}`, "u") - 0.5) * 0.16) * s;
      const v = (j + 0.5 + (unit(`${key}|${cell}`, "v") - 0.5) * 0.16) * s;
      yield {
        at: local.toLatLng({ x: u * cos - v * sin, y: u * sin + v * cos }),
        key: `${key}#${cell}`,
        cell,
      };
    }
  }
}

/**
 * Every `TREE_ROW_SPACING_M` along each line of a row, half a step in, in a
 * frame anchored at the line's own first vertex; inside the window only.
 * The whole line is walked, so a tree's index does not depend on the window.
 */
function* alongRow(
  geometry: OsmGeometry,
  key: string,
  window: Bbox,
): Generator<{ at: LatLng; key: string }> {
  const lines =
    geometry.kind === "linestring"
      ? [geometry.positions]
      : geometry.kind === "multilinestring"
        ? geometry.lines
        : geometry.kind === "polygon"
          ? // A closed tree row (around a field) reads as an area way.
            geometry.rings.slice(0, 1)
          : [];
  for (const [l, line] of lines.entries()) {
    const first = line[0];
    if (first === undefined) continue;
    const local = enuFrameAt(first);
    const points = line.map((p) => local.toEnu(p));
    let next = TREE_ROW_SPACING_M / 2;
    let walked = 0;
    let index = 0;
    for (let s = 0; s + 1 < points.length; s++) {
      const a = points[s]!;
      const b = points[s + 1]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      while (length > 0 && next <= walked + length) {
        const t = (next - walked) / length;
        const at = local.toLatLng({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
        if (inWindow(window, at)) yield { at, key: `${key}#r${l}:${index}` };
        index++;
        next += TREE_ROW_SPACING_M;
      }
      walked += length;
    }
  }
}

function boxOf(rings: readonly (readonly LatLng[])[]): Bbox | undefined {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of rings.flat()) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return south <= north && west <= east
    ? { south, west, north, east }
    : undefined;
}

/**
 * A wood's mixed class picks a form per tree; an orchard of unknown type is
 * broadleaved (fruit trees are). Everything else keeps its own class.
 */
function resolvedClass(
  source: CosmeticTreeSource,
  cls: TreeClass,
  key: string,
): Pick<TreeClass, "leafType" | "leafCycle"> {
  if (source === "wood" && cls.leafType === "mixed") {
    return {
      leafType: unit(key, "mix") < 0.5 ? "needleleaved" : "broadleaved",
      leafCycle: "unknown",
    };
  }
  if (source === "orchard" && cls.leafType === "unknown") {
    return { ...cls, leafType: "broadleaved" };
  }
  return cls;
}

function variantOf(cls: Pick<TreeClass, "leafType">): TreeVariant {
  return cls.leafType === "broadleaved" || cls.leafType === "needleleaved"
    ? cls.leafType
    : "unknown";
}

function placementOf(
  c: Candidate,
  options: BuildCosmeticTreesOptions,
): CosmeticTreePlacement {
  const heightM = c.defaultHeightM * (0.75 + unit(c.key, "h") * 0.5);
  return {
    feature: c.feature as TreePlacement["feature"],
    key: c.key,
    source: c.source,
    cosmetic: true,
    position: options.frame.toEnu(c.position),
    groundHeightM: options.groundHeightM?.(c.position) ?? 0,
    heightM,
    crownDiameterM: heightM * DEFAULT_CROWN_RATIO,
    rotationY: stableRotationY(c.key),
    variant: variantOf(c.cls),
    colour: treeColour(c.cls, c.key, TREE_COLOUR_JITTER, options.treePalette),
  };
}

/**
 * `(p) => true` where a wood or orchard tree must not stand: inside an
 * excluded ring, or within a road's half width plus `margin`. Bucketed on
 * 16 m cells of the frame, and only what touches the window is bucketed.
 */
function exclusion(
  features: readonly OsmFeature[],
  frame: EnuFrame,
  window: Bbox,
  rings: readonly (readonly EnuPoint[])[] | undefined,
  margin: number,
): (p: EnuPoint) => boolean {
  const cellM = 16;
  const sw = frame.toEnu({ lat: window.south, lng: window.west });
  const ne = frame.toEnu({ lat: window.north, lng: window.east });
  type Item =
    { ring: readonly EnuPoint[] } | { a: EnuPoint; b: EnuPoint; half: number };
  const buckets = new Map<string, Item[]>();
  const add = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    item: Item,
  ) => {
    if (maxX < sw.x || minX > ne.x || maxY < sw.y || minY > ne.y) return;
    const x0 = Math.floor(Math.max(minX, sw.x) / cellM);
    const x1 = Math.floor(Math.min(maxX, ne.x) / cellM);
    const y0 = Math.floor(Math.max(minY, sw.y) / cellM);
    const y1 = Math.floor(Math.min(maxY, ne.y) / cellM);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const id = `${i}:${j}`;
        const list = buckets.get(id);
        if (list === undefined) buckets.set(id, [item]);
        else list.push(item);
      }
    }
  };
  for (const ring of rings ?? []) {
    if (ring.length < 3) continue;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), {
      ring,
    });
  }
  for (const feature of features) {
    if (!isRoad(feature)) continue;
    const half = roadWidthM(feature.tags) / 2 + margin;
    for (const line of roadLines(feature)) {
      for (let k = 0; k + 1 < line.length; k++) {
        const a = frame.toEnu(line[k]!);
        const b = frame.toEnu(line[k + 1]!);
        add(
          Math.min(a.x, b.x) - half,
          Math.min(a.y, b.y) - half,
          Math.max(a.x, b.x) + half,
          Math.max(a.y, b.y) + half,
          { a, b, half },
        );
      }
    }
  }
  return (p) => {
    const items = buckets.get(
      `${Math.floor(p.x / cellM)}:${Math.floor(p.y / cellM)}`,
    );
    if (items === undefined) return false;
    return items.some((item) =>
      "ring" in item
        ? containsPoint(item.ring, p)
        : toSegment(p, item.a, item.b) < item.half,
    );
  };
}

/** A road's centre lines; none when its geometry does not resolve. */
function roadLines(feature: OsmFeature): readonly (readonly LatLng[])[] {
  const geometry = toGeometry(feature);
  if (!geometry.ok) return [];
  const g = geometry.geometry;
  if (g.kind === "linestring") return [g.positions];
  if (g.kind === "multilinestring") return g.lines;
  return [];
}

function toSegment(p: EnuPoint, a: EnuPoint, b: EnuPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
