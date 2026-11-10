/**
 * Road ribbons (W13, DEC-R2-12 / DEC-R2-13, joins since city objects M4a).
 *
 * ONE CONTINUOUS STRIP PER WAY, WITH MITRE JOINS (owner decision 2026-11-09,
 * city objects plan 2026-11-07-2315 sections 18 and 22). This is the standard
 * way of stroking a polyline: at an interior point both edges meet at the
 * mitre point on the bisector of the two segment normals, so the strip has no
 * wedge on the outside of a turn and no overlap on the inside. Above a mitre
 * limit the outer side is bevelled (one fill triangle). Two triangles a
 * segment, at most one more per join.
 *
 * WHAT IT REPLACED, AND WHY. DEC-R2-13 drew a quad per segment and a round
 * disc on every vertex: gap-free at any angle with no special cases, at eight
 * triangles a vertex. Dropping the disc where a turn was small (the O3 lab's
 * thinning) opened a sawtooth of notches along curved streets, which the owner
 * rejected on his phone. The strip is gap-free without either cost.
 *
 * WHERE THE DISC SURVIVES (DEC-R2-13's other half): at the ends (a rounded cap
 * instead of a hard edge across the carriageway), and as a FALLBACK where the
 * inner mitre point would run more than half way along a neighbouring
 * segment, or at a hairpin. That budget is what guarantees two joins on one
 * short segment can never cross and fold the strip; a clamped inner point
 * would no longer lie on both edge lines.
 *
 * A JUNCTION IS NOT A BREAK (M4a review, r1164). A way runs through a node it
 * shares with another way like through any other point, mitred where it
 * turns; the way that ends there brings its own end disc. Breaking the strip
 * there bought nothing visible without a kerb, cost eight triangles a
 * junction, and made every ribbon depend on the whole feature list. So each
 * ribbon depends on its own way alone, and roads can be built over a delta.
 *
 * CLASS ORDER. A carriageway covers the footway that crosses it: each way is
 * lifted by its class rank, its discs at its strip's own height (owner
 * decision 2026-11-09). The lift is geometric and fits inside one rung of
 * OsmDemo's 4 cm ground ladder.
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
import { isBelowSurface } from "../model/below-surface.js";
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
const DEFAULT_LANES: ReadonlyMap<string, number> = new Map([
  ["motorway", 2],
  ["trunk", 2],
  ["primary", 2],
  ["secondary", 2],
  ["tertiary", 2],
  ["unclassified", 2],
  ["residential", 2],
  ["living_street", 2],
  ["busway", 2],
  ["motorway_link", 1],
  ["trunk_link", 1],
  ["primary_link", 1],
  ["secondary_link", 1],
  ["tertiary_link", 1],
  ["track", 1],
  ["service", 1],
]);

/**
 * Classes with no lanes at all, given a flat width.
 *
 * A footway has no lanes, so multiplying a fictional lane count by a lane width
 * would be arithmetic dressed up as data.
 *
 * A `Map`, like `DEFAULT_LANES`: `highway` is free text, and on a plain object
 * `constructor` found an inherited function (M1 review finding 2).
 *
 * THE ONE PATH LIST of this file: `isPedestrianPath` tests against its keys
 * and `ROAD_RANK` puts exactly these at rank 0, so a class added here is a
 * path in this file's tables at once (the colour list, `PEDESTRIAN_CLASSES`
 * in feature-colours.ts, is separate and held to it by a test) (#909 review: `platform` once reached the rank
 * table alone and drew 6 m wide). `platform` is a bus or tram platform
 * mapped as a way, a pedestrian surface; it takes the pedestrian width.
 */
const PATH_WIDTH_M: ReadonlyMap<string, number> = new Map([
  ["footway", 2],
  ["path", 2],
  ["steps", 2],
  ["pedestrian", 2],
  ["platform", 2],
  ["bridleway", 2],
  ["cycleway", 3],
]);

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
  const flat = PATH_WIDTH_M.get(highway);
  if (flat !== undefined) return flat;

  const lanes =
    parseLanes(record["lanes"]) ??
    DEFAULT_LANES.get(highway) ??
    UNKNOWN_CLASS_LANES;
  return lanes * laneWidthM(lanes);
}

/**
 * Whether this way is one a person walks ALONG — the path-ness signal routing
 * needs (DEC-R2).
 *
 * **This is not the same question as the `walkable` score, and conflating them
 * is what six documents of routing analysis got wrong.** `walkable` rates
 * GROUND QUALITY: under "can a person walk on this surface", `surface=grass` 9
 * outranking `highway=footway` 3 is correct, because a footway LINE carries no
 * surface information of its own. Path-ness is a property of the way. A router
 * that wants "prefer the paths" needs both, as separate multipliers.
 *
 * It also answers a case the score structurally cannot. Scoring is
 * multiplicative with zero absorbing, so a footbridge sharing a res-13 cell with
 * a river scores exactly 0 — indistinguishable from open water. The provenance
 * map still records the footway as a contributor, so this predicate sees the
 * bridge the score cannot.
 *
 * **Allowlist rather than a `highway` presence test**, and it is `PATH_WIDTH_M`'s
 * key set by construction — one home for the list. A presence test would admit
 * motorways, and the rule table already scores those 0 for good reason.
 *
 * Exclusions are {@link isRoad}'s, deliberately shared: two predicates
 * disagreeing about one feature is a mistake this package has already had to fix.
 */
export function isPedestrianPath(feature: OsmFeature): boolean {
  if (!isRoad(feature)) return false;
  const tags = feature.tags as Record<string, string> | undefined;
  const highway = tags?.["highway"];
  // Narrowed first: `isRoad` has already established the tag exists, but the
  // compiler cannot see that across the call.
  return highway !== undefined && PATH_WIDTH_M.has(highway);
}

/**
 * Whether this way is a ground-level crossing carried over something — the
 * opener for a water bank (DEC-R1).
 *
 * **Three earlier formulations of this rule were refuted against real data, so
 * each clause is here for a named way in `testdata/sites/london-tower-bridge.json`:**
 *
 * - **Any truthy `bridge`, not `bridge=yes`.** Tower Bridge's own bascule spans
 *   are `bridge=movable` — 6 of the 14 ground-level ways at the site the rule
 *   was written for. An exact match misses the bridge the place is named after.
 * - **A `highway` is required.** Ways 367652753 / 367653917 are
 *   `bridge=yes building:part=yes min_height=40`, closed areas carrying no way
 *   at all. A bare `bridge=*` rule opens the bank along their whole outline,
 *   from a structure 40 m overhead.
 * - **`layer` must be ground level.** Ways 153173986 / 153173987 ARE
 *   `highway=footway bridge=yes` — and sit at `layer=2`, 43 m up, behind a
 *   turnstile. The highway clause alone admits them.
 *   - Absent `layer` reads as ground level, because that is the tag's default
 *     and most simple bridges carry none. Refusing the absent case would drop
 *     the common bridge to save the rare mis-tagged one.
 *
 * - **BELOW THE SURFACE IS NOT A CROSSING**, and that is decided by the SHARED
 *   {@link isBelowSurface} rather than by a bespoke test here. This rule used to
 *   be `tunnel === "yes"` plus `level <= 1`, which admitted NEGATIVE layers --
 *   so a `highway=* bridge=yes layer=-1` way counted as a ground-level deck and,
 *   through `bridgeDeckLines` -> `addWater`, opened a passage corridor through a
 *   river bank. It also missed `tunnel=culvert`, which `below-surface.ts` has
 *   classified as sub-surface all along.
 *   - The asymmetry was the tell (PR #315 review): `gateOpenings` vetoes a
 *     below-surface gate node and `canCorroborate` vetoes a below-surface way,
 *     while this -- the third sibling rule in the same package -- did not. One
 *     definition now serves all three.
 */
export function isBridgeCrossing(feature: OsmFeature): boolean {
  if (feature.type === "node") return false;
  const tags = feature.tags as Record<string, string> | undefined;
  if (tags === undefined) return false;

  const bridge = tags["bridge"];
  if (bridge === undefined || bridge === "no") return false;
  if (tags["highway"] === undefined) return false;
  if (isBelowSurface(feature)) return false;

  const layer = tags["layer"];
  if (layer === undefined) return true;
  const level = Number.parseInt(layer, 10);
  // A layer that is not a number tells us nothing; treat it as ground rather
  // than as a reason to refuse, matching the absent case.
  return !Number.isFinite(level) || level <= 1;
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
  /**
   * The largest ratio of a mitre's length to the half width before the outer
   * side is bevelled, `1 / cos(t / 2)` at a turn of t. Default
   * {@link ROAD_MITRE_LIMIT}. RangeError unless finite and at least 1.
   */
  readonly mitreLimit?: number;
  /**
   * Metres between two class ranks (`roadRank`). Default
   * {@link ROAD_RANK_STEP_M}; 0 draws every ribbon on the ground, as before
   * M4a. RangeError unless finite and at least 0.
   */
  readonly rankStepM?: number;
}

/**
 * The default mitre limit: 2 bevels every turn over 120 degrees (1.5 would
 * bevel over 96). The O3 lab's value; the mitre corner then reaches at most
 * one half width past the round join a disc would draw.
 */
export const ROAD_MITRE_LIMIT = 2;

/**
 * The default height between two class ranks, metres (the M4a spike's
 * choice, see `roads.ts.md`). The highest lift is 3.4 steps (rank 3 and
 * the tie lift), so over 2 cm stays free under OsmDemo's next rung (4 cm)
 * for M4b's zebras.
 */
export const ROAD_RANK_STEP_M = 0.005;

/**
 * Who covers whom where two ribbons overlap (M4a): paths 0, service and
 * track 1, local streets 2, every other class 3. A `Map`: `highway` is free
 * text (M1 review finding 2). O3's table; its paths are `PATH_WIDTH_M`'s
 * keys, so the two cannot disagree.
 */
const ROAD_RANK: ReadonlyMap<string, number> = new Map([
  ...[...PATH_WIDTH_M.keys()].map((path): [string, number] => [path, 0]),
  ["track", 1],
  ["service", 1],
  ["residential", 2],
  ["living_street", 2],
  ["unclassified", 2],
]);

/** The rank of every class the table does not name. */
const TOP_ROAD_RANK = 3;

/** A way's class rank, 0 (paths) to 3 (every main road). */
export function roadRank(tags: OsmTags): number {
  const highway = (tags as Record<string, string>)["highway"];
  return (
    (highway === undefined ? undefined : ROAD_RANK.get(highway)) ??
    TOP_ROAD_RANK
  );
}

/**
 * Inside a rank, the largest per-way lift (a fraction of the step), so two
 * ways of one rank but different colours do not z-fight where they meet.
 */
const TIE_LIFT_STEPS = 0.4;

export interface RoadRibbon {
  readonly feature: OsmFeatureKey;
  readonly widthM: number;
  readonly mesh: MeshData;
}

/** How many segments approximate each disc. */
const DISC_SEGMENTS = 8;

/** The narrowest bevel drawn; a smaller gap between the outer corners is mitred. */
const MIN_BEVEL_GAP_M = 0.001;

/** Ribbons for every road in `features`, in input order. */
export function buildRoads(
  features: Iterable<OsmFeature>,
  options: BuildRoadsOptions,
): RoadRibbon[] {
  const { mitreLimit, rankStepM } = validatedOptions(options);
  const ribbons: RoadRibbon[] = [];
  for (const feature of features) {
    if (!isRoad(feature)) continue;
    const geometry = (feature as { geometry?: readonly LatLng[] }).geometry;
    if (geometry === undefined) continue;
    const points = dedupe(geometry.map((p) => options.frame.toEnu(p)));
    const key = featureKey(feature);
    const widthM = roadWidthM(feature.tags);
    // A zero-length segment has no direction, so its normal is 0/0 = NaN —
    // and one NaN deletes the entire draw call in three.js with no error.
    if (points.length < 2) {
      ribbons.push({ feature: key, widthM, mesh: new MeshBuilder().build() });
      continue;
    }
    // One lift for the whole way, its discs included: a disc under its strip
    // would leave it a fraction of a step over the class below, which the
    // depth buffer does not resolve (roads.ts.md, "The depth spike").
    const liftM =
      rankStepM * (roadRank(feature.tags) + TIE_LIFT_STEPS * keyFraction(key));
    ribbons.push({
      feature: key,
      widthM,
      mesh: ribbonMesh(mitreStrip(points, widthM / 2, mitreLimit), {
        points,
        half: widthM / 2,
        liftM,
        options,
      }),
    });
  }
  return ribbons;
}

/** The mitre limit and rank step with their defaults; RangeError when invalid. */
function validatedOptions(options: BuildRoadsOptions): {
  mitreLimit: number;
  rankStepM: number;
} {
  const mitreLimit = options.mitreLimit ?? ROAD_MITRE_LIMIT;
  if (!(Number.isFinite(mitreLimit) && mitreLimit >= 1)) {
    throw new RangeError(
      `mitreLimit must be a finite number >= 1, got ${mitreLimit}`,
    );
  }
  const rankStepM = options.rankStepM ?? ROAD_RANK_STEP_M;
  if (!(Number.isFinite(rankStepM) && rankStepM >= 0)) {
    throw new RangeError(
      `rankStepM must be a finite number >= 0, got ${rankStepM}`,
    );
  }
  return { mitreLimit, rankStepM };
}

/** A stable [0, 1) per OSM key (FNV-1a), so a way's tie lift never moves. */
function keyFraction(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0) / 4294967296;
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

/** One corner of the strip, in ENU metres; shared corners are one object. */
interface Corner {
  readonly x: number;
  readonly y: number;
}

/** A cross-section of the strip at a point: its two edge corners. */
interface Section {
  readonly left: Corner;
  readonly right: Corner;
}

/** One way's strip: counter-clockwise ENU triangles and the disc points. */
interface Strip {
  readonly triangles: readonly (readonly [Corner, Corner, Corner])[];
  readonly discs: readonly number[];
}

/**
 * One way's continuous strip with mitre joins. `points` are ENU metres
 * without consecutive duplicates (at least two), `half` the half width.
 *
 * At an interior point both sides meet at the mitre point, on the bisector of
 * the two segment normals at `h / cos(t/2)`. Above `mitreLimit` the outer
 * side is bevelled: its two plain corners plus one fill triangle, the inner
 * side keeping the mitre point. Where the inner point would run more than
 * half way along either neighbouring segment (`h tan(t/2)`), or at a hairpin,
 * the point falls back to a disc and the strip breaks there.
 */
function mitreStrip(
  points: readonly EnuPoint[],
  half: number,
  mitreLimit: number,
): Strip {
  const n = points.length;
  const dirs: { x: number; y: number; len: number }[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const a = points[i] as EnuPoint;
    const b = points[i + 1] as EnuPoint;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    dirs.push({ x: (b.x - a.x) / len, y: (b.y - a.y) / len, len });
  }
  const dir = (i: number): { x: number; y: number; len: number } =>
    dirs[i] as { x: number; y: number; len: number };
  const at = (k: number, nx: number, ny: number, scale: number): Corner => {
    const p = points[k] as EnuPoint;
    return { x: p.x + nx * scale, y: p.y + ny * scale };
  };
  // A plain cross-section: perpendicular to one segment.
  const plain = (k: number, d: { x: number; y: number }): Section => ({
    left: at(k, -d.y, d.x, half),
    right: at(k, -d.y, d.x, -half),
  });

  const starts: Section[] = [plain(0, dir(0))];
  const ends: Section[] = [];
  const triangles: (readonly [Corner, Corner, Corner])[] = [];
  const discs = [0];
  for (let k = 1; k + 1 < n; k += 1) {
    const dIn = dir(k - 1);
    const dOut = dir(k);
    const cross = dIn.x * dOut.y - dIn.y * dOut.x;
    const dot = dIn.x * dOut.x + dIn.y * dOut.y;
    const halfTurn = Math.abs(Math.atan2(cross, dot)) / 2;
    const folds =
      halfTurn >= Math.PI / 2 - 1e-9 ||
      half * Math.tan(halfTurn) > 0.5 * Math.min(dIn.len, dOut.len);
    if (folds) {
      ends[k - 1] = plain(k, dIn);
      starts[k] = plain(k, dOut);
      discs.push(k);
      continue;
    }
    // The bisector of the two left normals, scaled to reach both edge lines.
    const mx = -dIn.y - dOut.y;
    const my = dIn.x + dOut.x;
    const norm = Math.hypot(mx, my);
    const length = half / Math.cos(halfTurn);
    const left = at(k, mx / norm, my / norm, length);
    const right = at(k, mx / norm, my / norm, -length);
    // A turn whose bevel gap is under a millimetre is mitred whatever the
    // limit: its mitre is the half width to the micrometre, and a bevel
    // there is a sliver of no area (limit 1 bevels every turn above zero).
    const bevelGapM = 2 * half * Math.sin(halfTurn);
    if (length / half <= mitreLimit || bevelGapM < MIN_BEVEL_GAP_M) {
      const joint = { left, right };
      ends[k - 1] = joint;
      starts[k] = joint;
      continue;
    }
    const inPlain = plain(k, dIn);
    const outPlain = plain(k, dOut);
    if (cross > 0) {
      // A left turn: the right side is outside.
      ends[k - 1] = { left, right: inPlain.right };
      starts[k] = { left, right: outPlain.right };
      triangles.push([left, inPlain.right, outPlain.right]);
    } else {
      ends[k - 1] = { left: inPlain.left, right };
      starts[k] = { left: outPlain.left, right };
      triangles.push([right, outPlain.left, inPlain.left]);
    }
  }
  ends[n - 2] = plain(n - 1, dir(n - 2));
  discs.push(n - 1);
  for (let i = 0; i + 1 < n; i += 1) {
    const s = starts[i] as Section;
    const e = ends[i] as Section;
    triangles.push([s.right, e.right, e.left], [s.right, e.left, s.left]);
  }
  return { triangles, discs };
}

/** The strip and its discs as one mesh, draped on the ground and lifted. */
function ribbonMesh(
  strip: Strip,
  input: {
    readonly points: readonly EnuPoint[];
    readonly half: number;
    readonly liftM: number;
    readonly options: BuildRoadsOptions;
  },
): MeshData {
  const { points, half, liftM, options } = input;
  const builder = new MeshBuilder();
  const sample = options.groundHeightM;

  /** Adds one vertex, sampling the ground under it. Normal is straight up. */
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

  const index = new Map<Corner, number>();
  const corner = (c: Corner): number => {
    let i = index.get(c);
    if (i === undefined) {
      i = vertex(c.x, c.y);
      index.set(c, i);
    }
    return i;
  };
  for (const [a, b, c] of strip.triangles) {
    // WOUND SO THE FACE NORMAL POINTS UP, and the order is not obvious enough
    // to leave unstated. `MeshBuilder` reflects ENU north onto `-z` and
    // reverses each triangle to compensate, so a triangle that is
    // counter-clockwise in ENU is handed over clockwise. The material uses
    // `flatShading`, which makes three.js recompute the normal from that
    // winding and ignore the per-vertex normals entirely — so getting this
    // backwards produces a ribbon lit from underneath and culled away, with the
    // status line still reporting every triangle. Pinned by "winds every
    // triangle so its FACE normal points UP".
    builder.triangle(corner(a), corner(c), corner(b));
  }

  // The discs: ends and fallbacks, at the strip's height.
  for (const k of strip.discs) {
    const point = points[k] as EnuPoint;
    const centre = vertex(point.x, point.y);
    let previous = vertex(point.x + half, point.y);
    for (let step = 1; step <= DISC_SEGMENTS; step += 1) {
      const angle = (step / DISC_SEGMENTS) * Math.PI * 2;
      const next = vertex(
        point.x + Math.cos(angle) * half,
        point.y + Math.sin(angle) * half,
      );
      // Same reversal as the strip above, for the same reason.
      builder.triangle(centre, next, previous);
      previous = next;
    }
  }

  return builder.build();
}
