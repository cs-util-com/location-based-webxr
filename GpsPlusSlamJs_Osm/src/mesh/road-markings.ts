/**
 * Zebra crossings from the map: stripes along every zebra-marked crossing
 * way, and across the road under every zebra-marked crossing node that no
 * striped way passes through. Nothing is invented: a crossing the map does
 * not call a zebra gets no paint, and a node on no car road is skipped
 * rather than given a guessed direction.
 *
 * Draped per vertex on the ground and lifted over every road class
 * (`roadMarkingLiftM`), one mesh per crossing, so `buildCity` can merge them
 * into the road chunks (one draw).
 *
 * @see road-markings.ts.md
 */

import type { LatLng, OsmFeature, OsmTags } from "../model/osm-feature.js";
import { featureKey, type OsmFeatureKey } from "../model/osm-feature.js";
import { parseLengthMetres } from "./building-heights.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { isRoad, roadMarkingLiftM, roadRank, roadWidthM } from "./roads.js";

/** The stripe geometry, metres (the O3 lab's values, the owner's choice). */
export const ZEBRA_PARAMS = Object.freeze({
  /** One stripe plus one gap, along the walking direction. */
  pitchM: 1,
  /** A stripe's width along the walking direction. */
  barM: 0.5,
  /** A stripe's length across the walking direction, without a `width` tag. */
  lengthM: 3,
  /** How close a node must lie to a way's vertex to sit on it. */
  snapM: 0.05,
});

const ZEBRA_MARKINGS: ReadonlySet<string> = new Set([
  "zebra",
  "ladder",
  "zebra:double",
  "ladder:skewed",
]);

/**
 * Whether a crossing's tags say there is zebra paint on the ground:
 * `crossing:markings` zebra, ladder, zebra:double or ladder:skewed, or the
 * older `crossing=zebra` / `crossing_ref=zebra`. `crossing:markings=yes`
 * says there is paint but not which, so it is not a zebra.
 */
export function isZebraTags(tags: OsmTags | undefined): boolean {
  if (tags === undefined) return false;
  return (
    ZEBRA_MARKINGS.has(tags["crossing:markings"] ?? "") ||
    tags["crossing"] === "zebra" ||
    tags["crossing_ref"] === "zebra"
  );
}

/**
 * One stripe in ENU metres: its centre, its long axis `(ux, uy)` (a unit
 * vector across the walking direction), its length along that axis and its
 * width along the walking direction.
 */
export interface ZebraStripe {
  readonly cx: number;
  readonly cy: number;
  readonly ux: number;
  readonly uy: number;
  readonly lengthM: number;
  readonly widthM: number;
}

/** The stripes of one crossing: a way, or a lone node. */
export interface ZebraCrossing {
  readonly feature: OsmFeatureKey;
  readonly stripes: readonly ZebraStripe[];
}

export interface ZebraCrossingOptions {
  /** One stripe plus one gap, metres. Default `ZEBRA_PARAMS.pitchM`. */
  readonly pitchM?: number;
}

/** A way as the stripe rules read it: its key, tags and ENU points. */
interface StreetWay {
  readonly key: OsmFeatureKey;
  readonly tags: OsmTags;
  readonly points: readonly EnuPoint[];
}

/**
 * The zebra crossings in `features`, ways first in input order, then the
 * lone nodes in input order. Crossings with no stripe (shorter than one
 * pitch) are left out. RangeError for a pitch that is not a finite number
 * wider than a bar (stripes would touch or overlap).
 */
export function zebraCrossings(
  features: Iterable<OsmFeature>,
  frame: EnuFrame,
  options: ZebraCrossingOptions = {},
): ZebraCrossing[] {
  const pitchM = validPitch(options.pitchM);
  const { crossingWays, carRoads, zebraNodes } = sortFeatures(features, frame);
  const out: ZebraCrossing[] = [];
  const striped = new PointIndex();
  for (const crossing of crossingWays) {
    const lengthM =
      positive(parseLengthMetres(crossing.tags["width"])) ??
      ZEBRA_PARAMS.lengthM;
    const stripes = stripesAlong(crossing.points, lengthM, pitchM);
    if (stripes.length === 0) continue;
    out.push({ feature: crossing.key, stripes });
    for (const p of crossing.points) striped.add(p, crossing);
  }

  return [...out, ...loneNodeCrossings(zebraNodes, carRoads, striped, pitchM)];
}

/**
 * The zebra nodes no striped way passes through, striped across the first
 * car road with a vertex there; a node on none is skipped.
 */
function loneNodeCrossings(
  zebraNodes: readonly { key: OsmFeatureKey; point: EnuPoint }[],
  carRoads: readonly CarRoad[],
  striped: PointIndex,
  pitchM: number,
): ZebraCrossing[] {
  const roadVertices = new PointIndex<CarRoad>();
  for (const road of carRoads) {
    for (const p of road.points) roadVertices.add(p, road);
  }
  const out: ZebraCrossing[] = [];
  for (const zebra of zebraNodes) {
    // A crossing mapped as a way and as its node is ONE crossing.
    if (striped.near(zebra.point) !== undefined) continue;
    const road = roadVertices.near(zebra.point);
    if (road === undefined) continue;
    const stripes = stripesAcross(road, zebra.point, pitchM);
    if (stripes.length > 0) out.push({ feature: zebra.key, stripes });
  }
  return out;
}

type CarRoad = StreetWay & { readonly widthM: number };

/** The zebra-tagged crossing ways, the car roads and the zebra nodes. */
function sortFeatures(
  features: Iterable<OsmFeature>,
  frame: EnuFrame,
): {
  crossingWays: StreetWay[];
  carRoads: CarRoad[];
  zebraNodes: { key: OsmFeatureKey; point: EnuPoint }[];
} {
  const crossingWays: StreetWay[] = [];
  const carRoads: CarRoad[] = [];
  const zebraNodes: { key: OsmFeatureKey; point: EnuPoint }[] = [];
  for (const feature of features) {
    if (feature.type === "node") {
      if (isZebraTags(feature.tags)) {
        zebraNodes.push({
          key: featureKey(feature),
          point: frame.toEnu(feature.position),
        });
      }
      continue;
    }
    const street = streetWayOf(feature, frame);
    if (street === undefined) continue;
    if (roadRank(street.tags) > 0) {
      carRoads.push({ ...street, widthM: roadWidthM(street.tags) });
    } else if (isCrossingWay(street.tags) && isZebraTags(street.tags)) {
      crossingWays.push(street);
    }
  }

  return { crossingWays, carRoads, zebraNodes };
}

/** A path crossing a road: `footway=crossing`, or any `crossing` tag. */
function isCrossingWay(tags: OsmTags): boolean {
  return tags["footway"] === "crossing" || tags["crossing"] !== undefined;
}

/** A road way in ENU without consecutive duplicates, or undefined. */
function streetWayOf(
  feature: OsmFeature,
  frame: EnuFrame,
): StreetWay | undefined {
  if (!isRoad(feature)) return undefined;
  const geometry = (feature as { geometry?: readonly LatLng[] }).geometry;
  if (geometry === undefined) return undefined;
  const points: EnuPoint[] = [];
  for (const position of geometry) {
    const p = frame.toEnu(position);
    const last = points[points.length - 1];
    if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) {
      continue;
    }
    points.push(p);
  }
  if (points.length < 2) return undefined;
  return { key: featureKey(feature), tags: feature.tags, points };
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

function validPitch(pitchM: number | undefined): number {
  const pitch = pitchM ?? ZEBRA_PARAMS.pitchM;
  if (!(Number.isFinite(pitch) && pitch > ZEBRA_PARAMS.barM)) {
    throw new RangeError(
      `pitchM must be a finite number > ${ZEBRA_PARAMS.barM}, got ${pitch}`,
    );
  }
  return pitch;
}

/**
 * Stripes centred along a polyline at the pitch, each across it: as many
 * whole pitches as the line is long, the remainder split between both ends.
 */
function stripesAlong(
  points: readonly EnuPoint[],
  lengthM: number,
  pitchM: number,
): ZebraStripe[] {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const count = Math.floor(total / pitchM + 1e-9);
  const start = (total - count * pitchM) / 2 + pitchM / 2;
  const out: ZebraStripe[] = [];
  let segment = 0;
  let before = 0;
  for (let k = 0; k < count; k += 1) {
    const along = start + k * pitchM;
    while (
      segment < lengths.length - 1 &&
      along > before + (lengths[segment] as number)
    ) {
      before += lengths[segment] as number;
      segment += 1;
    }
    const a = points[segment] as EnuPoint;
    const b = points[segment + 1] as EnuPoint;
    const len = lengths[segment] as number;
    const t = (along - before) / len;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    out.push({
      cx: a.x + (b.x - a.x) * t,
      cy: a.y + (b.y - a.y) * t,
      // The long axis: across the walking direction.
      ux: -dy,
      uy: dx,
      lengthM,
      widthM: ZEBRA_PARAMS.barM,
    });
  }
  return out;
}

/**
 * The stripes of a lone node: a line across the road through the node, the
 * road's width long, walked like a crossing way. The road's direction there
 * is taken from the vertex before to the vertex after the node.
 */
function stripesAcross(
  road: StreetWay & { readonly widthM: number },
  node: EnuPoint,
  pitchM: number,
): ZebraStripe[] {
  const i = road.points.findIndex((p) => nearPoint(p, node));
  const a = road.points[Math.max(0, i - 1)] as EnuPoint;
  const b = road.points[Math.min(road.points.length - 1, i + 1)] as EnuPoint;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const half = road.widthM / 2;
  return stripesAlong(
    [
      { x: node.x + uy * half, y: node.y - ux * half },
      { x: node.x - uy * half, y: node.y + ux * half },
    ],
    ZEBRA_PARAMS.lengthM,
    pitchM,
  );
}

function nearPoint(p: EnuPoint, q: EnuPoint): boolean {
  return Math.hypot(p.x - q.x, p.y - q.y) <= ZEBRA_PARAMS.snapM;
}

/**
 * Points hashed into cells of the snap distance, so finding the vertex a
 * node sits on is a look into nine cells, not a scan of every road. The
 * first value added near a point wins (input order).
 */
class PointIndex<T = unknown> {
  private readonly cells = new Map<
    string,
    { p: EnuPoint; value: T; order: number }[]
  >();
  private added = 0;

  add(p: EnuPoint, value: T): void {
    const key = cellKey(cellOf(p.x), cellOf(p.y));
    const entry = { p, value, order: this.added++ };
    const list = this.cells.get(key);
    if (list === undefined) this.cells.set(key, [entry]);
    else list.push(entry);
  }

  /** The earliest-added value near `q`, across all nine cells. */
  near(q: EnuPoint): T | undefined {
    const cx = cellOf(q.x);
    const cy = cellOf(q.y);
    let best: { value: T; order: number } | undefined;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const entry of this.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (!nearPoint(entry.p, q)) continue;
          if (best === undefined || entry.order < best.order) best = entry;
        }
      }
    }
    return best?.value;
  }
}

const cellOf = (v: number): number => Math.floor(v / ZEBRA_PARAMS.snapM);
const cellKey = (x: number, y: number): string => `${x},${y}`;

export interface BuildRoadMarkingsOptions extends ZebraCrossingOptions {
  readonly frame: EnuFrame;
  /** Ground elevation at a position, metres. Absent: flat at 0. */
  readonly groundHeightM?: (position: LatLng) => number;
  /** Metres over the ground. Default `roadMarkingLiftM()`. */
  readonly liftM?: number;
}

/** One crossing's paint as a mesh. */
export interface RoadMarking {
  readonly feature: OsmFeatureKey;
  readonly stripeCount: number;
  readonly mesh: MeshData;
}

/**
 * The zebra crossings in `features` as meshes, one per crossing, each stripe
 * two up-facing triangles draped on the ground (a ground that is not a
 * number reads as 0) and lifted by `liftM`. RangeError for an invalid pitch
 * or a lift that is not finite.
 */
export function buildRoadMarkings(
  features: Iterable<OsmFeature>,
  options: BuildRoadMarkingsOptions,
): RoadMarking[] {
  const liftM = options.liftM ?? roadMarkingLiftM();
  if (!Number.isFinite(liftM)) {
    throw new RangeError(`liftM must be a finite number, got ${liftM}`);
  }
  return zebraCrossings(features, options.frame, options).map((crossing) => ({
    feature: crossing.feature,
    stripeCount: crossing.stripes.length,
    mesh: stripeMesh(crossing.stripes, liftM, options),
  }));
}

function stripeMesh(
  stripes: readonly ZebraStripe[],
  liftM: number,
  options: BuildRoadMarkingsOptions,
): MeshData {
  const builder = new MeshBuilder();
  const sample = options.groundHeightM;
  const vertex = (x: number, y: number): number => {
    const height =
      sample === undefined ? 0 : sample(options.frame.toLatLng({ x, y }));
    return builder.vertex(
      x,
      (Number.isFinite(height) ? height : 0) + liftM,
      y,
      0,
      1,
      0,
    );
  };
  for (const s of stripes) {
    // (nx, ny) is the long axis turned left, so (u, n) is counter-clockwise.
    const nx = -s.uy;
    const ny = s.ux;
    const corner = (su: number, sn: number): number =>
      vertex(
        s.cx + (s.ux * su * s.lengthM) / 2 + (nx * sn * s.widthM) / 2,
        s.cy + (s.uy * su * s.lengthM) / 2 + (ny * sn * s.widthM) / 2,
      );
    const a = corner(-1, -1);
    const b = corner(1, -1);
    const c = corner(1, 1);
    const d = corner(-1, 1);
    // Counter-clockwise in ENU, handed over reversed: `MeshBuilder` reflects
    // north onto -z (see roads.ts's ribbon winding).
    builder.triangle(a, c, b);
    builder.triangle(a, d, c);
  }
  return builder.build();
}
