/**
 * Road ribbons (W13, DEC-R2-12 / DEC-R2-13).
 *
 * WHY SEGMENT QUADS PLUS A DISC AT EVERY VERTEX, and not mitred joins. Two quads
 * meeting at an angle leave a wedge of bare ground on the outside of the turn,
 * and closing it properly means computing the mitre — which needs the join angle,
 * a limit for near-reversals, and a special case at every degeneracy. A disc of
 * the road's own width centred on each vertex fills the wedge **by construction,
 * at any angle, with no cases at all**.
 *
 * Its only cost is overlap: the disc is drawn over the quads. DEC-R2-13 already
 * requires roads to be opaque, and overlap is invisible in opaque geometry — so
 * the cost is paid by a decision that was taken for a different reason.
 *
 * `streets-gl` does it the other way and the cost is visible in its file list: a
 * whole `road-graph/` package with an `IntersectionPolygonBuilder` that offsets
 * and pairwise-intersects every incident road. That produces genuinely correct
 * junctions; it is also several hundred lines and the hardest code in their tree.
 * See `2026-07-30-1520-streets-gl-road-modelling-findings.md` §2.
 *
 * WHY `three`'s `Line` IS NOT AN OPTION: `linewidth > 1` is unsupported on every
 * major platform. This is triangulated geometry either way, and that is not a
 * choice being made here.
 *
 * @see roads.ts.md
 */

import type { LatLng, OsmFeature, OsmTags } from "../model/osm-feature.js";
import { featureKey, type OsmFeatureKey } from "../model/osm-feature.js";
import { parseLengthMetres } from "./building-heights.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";

/**
 * Default lane count per `highway` class.
 *
 * FROM `streets-gl`, whose model is the oracle this table's shape came from —
 * width is derived from LANES rather than assigned per class, because `lanes` is
 * real mapped data on exactly the classes where width varies most. A flat table
 * cannot tell a two-lane primary from a six-lane one.
 *
 * ONE DELIBERATE DIFFERENCE (filed as F9): `service` gets **1** lane where
 * streets-gl gives it 2. `service` is driveways and parking aisles, which are
 * numerous in a residential working set and are not two lanes wide. Expressed as
 * a lane count rather than as a width override, so there is still one mechanism.
 */
const DEFAULT_LANES: Readonly<Record<string, number>> = {
  motorway: 2,
  trunk: 2,
  primary: 2,
  secondary: 2,
  tertiary: 2,
  unclassified: 2,
  residential: 2,
  living_street: 2,
  busway: 2,
  motorway_link: 1,
  trunk_link: 1,
  primary_link: 1,
  secondary_link: 1,
  tertiary_link: 1,
  track: 1,
  service: 1,
};

/**
 * Classes with no lanes at all, given a flat width.
 *
 * A footway has no lanes, so multiplying a fictional lane count by a lane width
 * would be arithmetic dressed up as data.
 */
const PATH_WIDTH_M: Readonly<Record<string, number>> = {
  footway: 2,
  path: 2,
  steps: 2,
  pedestrian: 2,
  bridleway: 2,
  cycleway: 3,
};

/** Lanes assumed for a `highway` value nothing else recognises. */
const UNKNOWN_CLASS_LANES = 2;

/**
 * Metres per lane.
 *
 * A SINGLE lane gets 4 m rather than 3, and that is not a rounding convenience:
 * a one-lane road's drawn width has to cover the carriageway plus the verge that
 * makes it passable, while a lane inside a multi-lane road is just a lane. Three
 * metres for a one-lane residential street reads as a footpath. Taken from
 * `streets-gl`, which arrived at the same rule independently of any table.
 */
function laneWidthM(lanes: number): number {
  return lanes === 1 ? 4 : 3;
}

/** A positive integer lane count, or `undefined` for anything else. */
function parseLanes(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // `lanes=1;2` and `lanes=none` both occur. `Number` gives a surprise or NaN,
  // and a NaN width silently deletes the road from the scene.
  if (!/^\d+$/.test(raw.trim())) return undefined;
  const lanes = Number(raw);
  return Number.isInteger(lanes) && lanes > 0 ? lanes : undefined;
}

/**
 * Drawn width of a road, metres. Never `NaN`, never zero.
 *
 * Precedence: the `width` tag, then `lanes` × lane width, then the class's
 * default lanes × lane width. A zero-width ribbon is invisible and a `NaN` one
 * removes the geometry entirely — both are the silent-absence failure this round
 * has met repeatedly, so the fallback chain has no hole in it.
 */
export function roadWidthM(tags: OsmTags): number {
  const record = tags as Record<string, string>;
  // `parseLengthMetres`, not `Number`: `width=7 m` is ordinary and `Number`
  // returns NaN for it, which the fallback would then swallow — a tagged road
  // silently becoming an untagged one at a plausible width.
  const tagged = parseLengthMetres(record["width"]);
  if (tagged !== undefined && tagged > 0) return tagged;

  const highway = record["highway"] ?? "";
  const flat = PATH_WIDTH_M[highway];
  if (flat !== undefined) return flat;

  const lanes =
    parseLanes(record["lanes"]) ??
    DEFAULT_LANES[highway] ??
    UNKNOWN_CLASS_LANES;
  return lanes * laneWidthM(lanes);
}

/** Whether this builder owns the feature. */
export function isRoad(feature: OsmFeature): boolean {
  if (feature.type === "node") return false;
  const tags = feature.tags as Record<string, string> | undefined;
  if (tags === undefined) return false;
  if (tags["highway"] === undefined) return false;
  // UNDERGROUND. Drawing a tunnel as a surface ribbon puts a road across ground
  // it runs beneath — a confident, plausible lie about the world (F10).
  if (tags["tunnel"] === "yes" || tags["covered"] === "yes") return false;
  // A highway AREA is a surface, not a ribbon: `highway=pedestrian` + `area=yes`
  // belongs to the plate builder. Two builders drawing one feature is the mistake
  // every builder in this package has had to avoid explicitly.
  if (tags["area"] === "yes") return false;
  return true;
}

export interface BuildRoadsOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
}

export interface RoadRibbon {
  readonly feature: OsmFeatureKey;
  readonly widthM: number;
  readonly mesh: MeshData;
}

/** How many segments approximate each vertex disc. */
const DISC_SEGMENTS = 8;

/** Ribbons for every road in `features`, in input order. */
export function buildRoads(
  features: Iterable<OsmFeature>,
  options: BuildRoadsOptions,
): RoadRibbon[] {
  const ribbons: RoadRibbon[] = [];
  for (const feature of features) {
    if (!isRoad(feature)) continue;
    const geometry = (feature as { geometry?: readonly LatLng[] }).geometry;
    if (geometry === undefined) continue;

    const points = dedupe(geometry.map((p) => options.frame.toEnu(p)));
    // A zero-length segment has no direction, so its quad normal is 0/0 = NaN —
    // and one NaN deletes the entire draw call in three.js with no error.
    if (points.length < 2) {
      ribbons.push({
        feature: featureKey(feature),
        widthM: roadWidthM(feature.tags),
        mesh: new MeshBuilder().build(),
      });
      continue;
    }

    const widthM = roadWidthM(feature.tags);
    ribbons.push({
      feature: featureKey(feature),
      widthM,
      mesh: ribbonMesh(points, widthM, options),
    });
  }
  return ribbons;
}

/** Drops consecutive duplicates, which are what make a segment degenerate. */
function dedupe(points: readonly EnuPoint[]): EnuPoint[] {
  const out: EnuPoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      Math.hypot(point.x - last.x, point.y - last.y) < 1e-6
    ) {
      continue;
    }
    out.push(point);
  }
  return out;
}

function ribbonMesh(
  points: readonly EnuPoint[],
  widthM: number,
  options: BuildRoadsOptions,
): MeshData {
  const builder = new MeshBuilder();
  const half = widthM / 2;
  const sample = options.groundHeightM;

  /** Adds one vertex, sampling the ground under it. Normal is straight up. */
  const vertex = (x: number, y: number): number => {
    const height =
      sample === undefined ? 0 : sample(options.frame.toLatLng({ x, y }));
    return builder.vertex(x, Number.isFinite(height) ? height : 0, y, 0, 1, 0);
  };

  // One quad per segment.
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    // Left normal of the segment, in plan.
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;

    const al = vertex(a.x + nx, a.y + ny);
    const ar = vertex(a.x - nx, a.y - ny);
    const bl = vertex(b.x + nx, b.y + ny);
    const br = vertex(b.x - nx, b.y - ny);
    // WOUND SO THE FACE NORMAL POINTS UP, and the order is not obvious enough
    // to leave unstated. `MeshBuilder` reflects ENU north onto `-z` and reverses
    // each triangle to compensate, so the winding that survives to the buffer is
    // the mirror of the one written here. The material uses `flatShading`, which
    // makes three.js recompute the normal from that winding and ignore the
    // per-vertex normals below entirely — so getting this backwards produces a
    // ribbon lit from underneath and culled away, with the status line still
    // reporting every triangle. Pinned by "winds every triangle so its FACE
    // normal points UP".
    builder.triangle(al, bl, ar);
    builder.triangle(bl, br, ar);
  }

  // One disc per vertex, INCLUDING the ends. The ends are the cheap half of the
  // same decision: a rounded cap costs the same eight triangles and stops a road
  // ending in a hard edge across the carriageway.
  for (const point of points) {
    const centre = vertex(point.x, point.y);
    let previous = vertex(point.x + half, point.y);
    for (let step = 1; step <= DISC_SEGMENTS; step += 1) {
      const angle = (step / DISC_SEGMENTS) * Math.PI * 2;
      const next = vertex(
        point.x + Math.cos(angle) * half,
        point.y + Math.sin(angle) * half,
      );
      // Same reversal as the quads above, for the same reason.
      builder.triangle(centre, next, previous);
      previous = next;
    }
  }

  return builder.build();
}
