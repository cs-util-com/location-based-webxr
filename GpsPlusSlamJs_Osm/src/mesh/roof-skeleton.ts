/**
 * A roof over any footprint: a weighted straight skeleton by wavefront
 * simulation, courtyards included.
 *
 * Every wall line moves inwards at its own weight, and the surface it sweeps
 * is its roof plane: weight 1 is a slope, weight 0 stays put and sweeps a
 * vertical gable. A face's points carry `t`, the time the wavefront reached
 * them, so a caller turns the result into heights with one number:
 * `eave + t * slope`.
 *
 * Brute force on purpose: the next event is searched afresh every step,
 * O(n^3) at worst and fine for a building's corners (the caller caps the ring
 * size). A position is always computed from the two wall lines that define it,
 * so no error accumulates from step to step.
 *
 * Every footprint is prepared before the run, because OSM rings are full of
 * exact degeneracies the simulation cannot settle: duplicate and collinear
 * corners are dropped, then every corner is nudged by half a millimetre,
 * deterministically, so no two walls are exactly parallel and no two events
 * happen at exactly one time. After the run the eaves are put back exactly on
 * the given corners, dropped ones included, so they meet the unnudged walls.
 *
 * The result is checked before it is returned (it covers the given ring's area,
 * no slope lies over air or over a courtyard, no number is NaN) and anything
 * that fails is a `SkeletonFailure`, which the caller's fallback ladder takes
 * as "try the next step".
 *
 * @see roof-skeleton.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { signedArea2 } from "./enu.js";
import { stableNudge } from "./stable-jitter.js";
import { dropClosingPoint, triangulate } from "./triangulate.js";
import { containsPoint } from "../spatial/point-in-ring.js";

/** Two events this close in time are one event. */
const TIME_EPS = 1e-9;
/** A computed event may lie this far before now and still count. */
const PAST_EPS = 1e-7;
/** How far a hit may miss the end of a wall and still count. */
const SPAN_EPS = 1e-7;
/** Below this the two lines of a corner are treated as parallel. */
const PARALLEL_EPS = 1e-11;
/** A run that takes more steps than this per wall has lost its way. */
const MAX_STEPS_PER_WALL = 12;

/**
 * How far each corner is nudged, metres, on each axis. Swept 0.1 to 2 mm in
 * `roof-skeleton.ts.md`: below about 0.25 mm exact parallels survive in the
 * corpus, above about 1 mm the eave snap tilts short walls visibly in tests.
 */
const JITTER_M = 0.0005;
/** A corner nearer than this to its neighbour, or to the line past it, is dropped. */
const COLLINEAR_M = 1e-4;
/** The roof's plan area may differ from the given ring's by this fraction. */
const AREA_TOLERANCE = 0.004;
/** Corners of one face nearer than this are one corner when finding wing ends. */
const END_APEX_M = 0.01;
/** A wall faces along an axis when its normal is within 45 degrees of it. */
const AXIS_COS = Math.SQRT1_2;

/** Thrown for a footprint that cannot be roofed soundly. */
export class SkeletonFailure extends Error {
  override name = "SkeletonFailure";
}

/** A roof point: plan position and the time the wavefront reached it. */
export interface SkeletonPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** One wall's swept surface. */
export interface SkeletonFace {
  /** The ring (0 is the outer one) and the wall in that ring AS GIVEN. */
  readonly ring: number;
  readonly wall: number;
  /** Weight 0: the face stands vertically over its wall (a gable). */
  readonly vertical: boolean;
  readonly weight: number;
  /** The wall's inward unit normal, in plan. */
  readonly nx: number;
  readonly ny: number;
  /** The wall's unit direction, in plan. */
  readonly dx: number;
  readonly dy: number;
  /** The face outline. An eave face starts and ends on its wall, at t = 0. */
  readonly points: readonly SkeletonPoint[];
}

/** A flat top left where the run stopped at `maxT`. */
export interface SkeletonCap {
  readonly outer: readonly EnuPoint[];
  readonly holes: readonly (readonly EnuPoint[])[];
}

export interface SkeletonRoof {
  readonly faces: readonly SkeletonFace[];
  readonly caps: readonly SkeletonCap[];
  /** The time the last event happened, or `maxT`: the ridge's `t`. */
  readonly ridgeT: number;
  /** How many faces stand vertically. */
  readonly gables: number;
}

/**
 * How extra gable ends are chosen from the all-slopes run.
 *
 * Candidates are the outer walls whose whole slope is one triangle resting on
 * the wall (a wing's end). `neighbours` takes a candidate when neither
 * neighbouring wall is a candidate too; `axis` takes those whose wall normal
 * lies within 45 degrees of `axis` (the tagged ridge axis).
 */
export type GableRule =
  | { readonly kind: "neighbours" }
  | { readonly kind: "axis"; readonly axis: EnuPoint };

export interface SkeletonOptions {
  /**
   * One array per ring, one weight per wall of the ring AS GIVEN (wall `i`
   * runs from corner `i` to corner `i + 1`): 1 a slope, 0 a vertical gable.
   * Default 1. Of collinear walls merged by the preparation, the first one's
   * weight counts.
   */
  readonly weights?: readonly (readonly number[])[];
  /** Turn the wing ends this rule picks into gables. */
  readonly gableEnds?: GableRule;
  /**
   * Stop at this time and close what is left with flat caps. For invented
   * roofs that must not grow taller than a limit; tagged roofs never pass it.
   */
  readonly maxT?: number;
  /** A different nudge for each attempt, so a retry is a different run. */
  readonly attempt?: number;
}

/**
 * The roof over `rings` (outer first, then courtyards; either winding, a
 * repeated closing point allowed).
 *
 * `rings` is the ring the roof STANDS ON, and everything is checked against
 * it: the tagged path passes the footprint; an invented roof with an eave
 * overhang passes its offset ring, and the area check and the eave snap then
 * work against that ring rather than the walls'.
 *
 * Throws `SkeletonFailure` for a ring that is not simple, has fewer than three
 * usable corners or non-finite numbers, or whose roof fails the soundness
 * check.
 */
export function skeletonRoof(
  rings: readonly (readonly EnuPoint[])[],
  options: SkeletonOptions = {},
): SkeletonRoof {
  const prepared = prepareRings(rings);
  assertSimple(prepared);
  const attempt = options.attempt ?? 0;
  const nudged = prepared.map((ring, r) => nudgedRing(ring, r, attempt));
  let weights = preparedWeights(prepared, options.weights);
  if (options.gableEnds !== undefined) {
    const hip = runSkeleton(nudged, weights, Number.POSITIVE_INFINITY);
    const gables = chooseGables(hip, options.gableEnds, prepared[0]);
    weights = weights.map((ring, r) =>
      r === 0 ? ring.map((w, i) => (gables.has(i) ? 0 : w)) : ring,
    );
  }
  const maxT = options.maxT ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(maxT) || maxT <= 0) {
    throw new SkeletonFailure("maxT must be positive");
  }
  const run = runSkeleton(nudged, weights, maxT);
  const roof = finish(run, prepared);
  assertSound(roof, prepared);
  return roof;
}

/** A face's triangles, as triples of its own points. */
export function faceTriangles(
  face: SkeletonFace,
): [SkeletonPoint, SkeletonPoint, SkeletonPoint][] {
  // Along the wall against time: a one-to-one map of the planar face (for a
  // vertical face, of its wall plane), so the polygon stays simple.
  const source = new Map<EnuPoint, SkeletonPoint>();
  const flat = face.points.map((p) => {
    const q = { x: p.x * face.dx + p.y * face.dy, y: p.t };
    source.set(q, p);
    return q;
  });
  const result = triangulate([flat]);
  const pick = (k: number | undefined): SkeletonPoint | undefined => {
    const v = k === undefined ? undefined : result.vertices[k];
    return v === undefined ? undefined : source.get(v);
  };
  const out: [SkeletonPoint, SkeletonPoint, SkeletonPoint][] = [];
  for (let i = 0; i + 2 < result.indices.length; i += 3) {
    const a = pick(result.indices[i]);
    const b = pick(result.indices[i + 1]);
    const c = pick(result.indices[i + 2]);
    if (a !== undefined && b !== undefined && c !== undefined) {
      out.push([a, b, c]);
    }
  }
  return out;
}

/** A cap's triangles, as triples of plan points. */
export function capTriangles(
  cap: SkeletonCap,
): [EnuPoint, EnuPoint, EnuPoint][] {
  const result = triangulate([cap.outer, ...cap.holes]);
  const out: [EnuPoint, EnuPoint, EnuPoint][] = [];
  for (let i = 0; i + 2 < result.indices.length; i += 3) {
    const a = result.vertices[result.indices[i] ?? -1];
    const b = result.vertices[result.indices[i + 1] ?? -1];
    const c = result.vertices[result.indices[i + 2] ?? -1];
    if (a !== undefined && b !== undefined && c !== undefined) {
      out.push([a, b, c]);
    }
  }
  return out;
}

/** The plan area the roof covers (slopes and caps; gables cover none). */
export function skeletonPlanArea(roof: SkeletonRoof): number {
  let area = 0;
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of faceTriangles(face)) area += triangleArea(a, b, c);
  }
  for (const cap of roof.caps) {
    for (const [a, b, c] of capTriangles(cap)) area += triangleArea(a, b, c);
  }
  return area;
}

const triangleArea = (a: EnuPoint, b: EnuPoint, c: EnuPoint): number =>
  Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

// ---------------------------------------------------------------------------
// Preparation

/** A ring as given, oriented, and the corners that survive preparation. */
interface PreparedRing {
  /** The given ring without a closing point, outer counter-clockwise, holes clockwise. */
  readonly oriented: readonly EnuPoint[];
  /** True when `oriented` is the given ring reversed. */
  readonly reversed: boolean;
  /** Indices into `oriented` of the corners the run uses. */
  readonly keep: readonly number[];
}

function prepareRings(rings: readonly (readonly EnuPoint[])[]): PreparedRing[] {
  if (rings.length === 0) throw new SkeletonFailure("no rings");
  return rings.map((ring, r) => {
    const open = dropClosingPoint(ring);
    for (const p of open) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new SkeletonFailure("a corner that is not a finite number");
      }
    }
    // Inside on the left: the outer ring counter-clockwise, holes clockwise.
    const reversed = signedArea2(open) > 0 !== (r === 0);
    const oriented = reversed ? [...open].reverse() : open;
    const keep = keptCorners(oriented);
    if (keep.length < 3) throw new SkeletonFailure("fewer than three corners");
    return { oriented, reversed, keep };
  });
}

/** Indices of the corners left after dropping duplicate and collinear ones. */
function keptCorners(points: readonly EnuPoint[]): number[] {
  const keep = points.map((_, i) => i);
  let changed = true;
  while (changed && keep.length >= 3) {
    changed = false;
    for (let k = 0; k < keep.length && keep.length >= 3; k++) {
      const p = corner(points, keep, k);
      const prev = corner(points, keep, k - 1);
      const next = corner(points, keep, k + 1);
      if (lineGap(p, prev, next) < COLLINEAR_M) {
        keep.splice(k, 1);
        changed = true;
      }
    }
  }
  return keep;
}

function corner(
  points: readonly EnuPoint[],
  keep: readonly number[],
  k: number,
): EnuPoint {
  const n = keep.length;
  return at(points, at(keep, ((k % n) + n) % n));
}

/** Distance from `p` to the line through `a` and `b` (to `a` if they meet). */
function lineGap(p: EnuPoint, a: EnuPoint, b: EnuPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

/** The kept corners, each nudged by its own stable offset. */
function nudgedRing(
  ring: PreparedRing,
  r: number,
  attempt: number,
): EnuPoint[] {
  return ring.keep.map((k) => {
    const p = at(ring.oriented, k);
    const nudge = stableNudge(
      `${attempt}/${r}/${p.x.toFixed(3)}/${p.y.toFixed(3)}`,
    );
    return { x: p.x + nudge.x * JITTER_M, y: p.y + nudge.y * JITTER_M };
  });
}

/** The given ring's index of the wall that starts at oriented corner `k`. */
function givenWall(ring: PreparedRing, k: number): number {
  const n = ring.oriented.length;
  return ring.reversed ? (((n - 2 - k) % n) + n) % n : k;
}

function preparedWeights(
  prepared: readonly PreparedRing[],
  weights: readonly (readonly number[])[] | undefined,
): number[][] {
  return prepared.map((ring, r) =>
    ring.keep.map((k) => {
      const w = weights?.[r]?.[givenWall(ring, k)] ?? 1;
      if (!Number.isFinite(w) || w < 0) {
        throw new SkeletonFailure("a weight that is not a finite number >= 0");
      }
      return w;
    }),
  );
}

/** Every ring simple, none crossing another, every hole inside the outer ring. */
function assertSimple(prepared: readonly PreparedRing[]): void {
  const rings = prepared.map((ring) =>
    ring.keep.map((k) => at(ring.oriented, k)),
  );
  const segments = rings.flatMap((ring, r) =>
    ring.map((a, i) => ({
      r,
      i,
      n: ring.length,
      a,
      b: at(ring, (i + 1) % ring.length),
    })),
  );
  for (let s = 0; s < segments.length; s++) {
    for (let u = s + 1; u < segments.length; u++) {
      const one = at(segments, s);
      const two = at(segments, u);
      if (adjacent(one, two)) continue;
      if (segmentsTouch(one.a, one.b, two.a, two.b)) {
        throw new SkeletonFailure("a ring that is not simple");
      }
    }
  }
  const [outer, ...holes] = rings;
  for (const [h, hole] of holes.entries()) {
    const probe = at(hole, 0);
    const nested = holes.some(
      (other, o) => o !== h && containsPoint(other, probe),
    );
    if (outer === undefined || !containsPoint(outer, probe) || nested) {
      throw new SkeletonFailure("a hole outside its outer ring");
    }
  }
}

interface Segment {
  readonly r: number;
  readonly i: number;
  readonly n: number;
  readonly a: EnuPoint;
  readonly b: EnuPoint;
}

function adjacent(one: Segment, two: Segment): boolean {
  if (one.r !== two.r) return false;
  const gap = Math.abs(one.i - two.i);
  return gap === 1 || gap === one.n - 1;
}

/** True when the bounding boxes of segments a-b and c-d do not overlap. */
function boxesApart(
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
  d: EnuPoint,
): boolean {
  return (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  );
}

/** True when segments a-b and c-d cross or touch. */
function segmentsTouch(
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
  d: EnuPoint,
): boolean {
  if (boxesApart(a, b, c, d)) return false;
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    touchesAt(d1, a, b, c) ||
    touchesAt(d2, a, b, d) ||
    touchesAt(d3, c, d, a) ||
    touchesAt(d4, c, d, b)
  );
}

/** True when `p`, on the line through a-b (`side` 0), lies on the segment. */
function touchesAt(
  side: number,
  a: EnuPoint,
  b: EnuPoint,
  p: EnuPoint,
): boolean {
  return side === 0 && onSegment(a, b, p);
}

const side = (a: EnuPoint, b: EnuPoint, c: EnuPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** For `p` collinear with a-b: does it lie within the segment? */
const onSegment = (a: EnuPoint, b: EnuPoint, p: EnuPoint): boolean =>
  Math.min(a.x, b.x) <= p.x &&
  p.x <= Math.max(a.x, b.x) &&
  Math.min(a.y, b.y) <= p.y &&
  p.y <= Math.max(a.y, b.y);

// ---------------------------------------------------------------------------
// Gable choice

/** The outer walls whose whole slope is one triangle resting on the wall. */
function triangularEnds(run: Run): Map<number, Wall> {
  const ends = new Map<number, Wall>();
  for (const face of run.faces) {
    const { edge, points } = face;
    if (edge.ring !== 0 || edge.w === 0) continue;
    const corners = distinctCorners(points);
    if (corners.length !== 3) continue;
    if (corners.filter((p) => p.t === 0).length === 2) ends.set(edge.at, edge);
  }
  return ends;
}

/**
 * A face outline with runs of corners nearer than `END_APEX_M` to each other
 * counted once: the nudge splits one hip apex into two events a fraction of a
 * millimetre apart, and that sliver must not make a wing end a quadrilateral.
 */
function distinctCorners(points: readonly SkeletonPoint[]): SkeletonPoint[] {
  const out: SkeletonPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (
      last === undefined ||
      Math.hypot(p.x - last.x, p.y - last.y) > END_APEX_M
    ) {
      out.push(p);
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first !== undefined && last !== undefined) {
    if (Math.hypot(first.x - last.x, first.y - last.y) <= END_APEX_M) out.pop();
  }
  return out;
}

function chooseGables(
  run: Run,
  rule: GableRule,
  outer: PreparedRing | undefined,
): Set<number> {
  const n = outer?.keep.length ?? 0;
  const ends = triangularEnds(run);
  const chosen = new Set<number>();
  for (const [i, wall] of ends) {
    const lonely = !ends.has((i + n - 1) % n) && !ends.has((i + 1) % n);
    const facing =
      rule.kind === "axis" &&
      Math.abs(wall.nx * rule.axis.x + wall.ny * rule.axis.y) >= AXIS_COS;
    if (rule.kind === "neighbours" ? lonely : facing) chosen.add(i);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// The wavefront

interface Wall {
  readonly ring: number;
  readonly at: number;
  readonly dx: number;
  readonly dy: number;
  readonly nx: number;
  readonly ny: number;
  readonly c: number;
  readonly w: number;
}

/** One wall's live stretch of wavefront and the outline its face has so far. */
interface Item {
  readonly edge: Wall;
  readonly left: SkeletonPoint[];
  readonly right: SkeletonPoint[];
}

type Loop = Item[];

interface RawFace {
  readonly edge: Wall;
  readonly points: SkeletonPoint[];
}

interface Run {
  readonly faces: RawFace[];
  readonly caps: SkeletonCap[];
  readonly ridgeT: number;
}

type WaveEvent =
  | {
      readonly kind: "edge";
      readonly t: number;
      readonly loop: number;
      readonly i: number;
    }
  | {
      readonly kind: "split";
      readonly t: number;
      readonly loop: number;
      readonly i: number;
      readonly other: number;
      readonly j: number;
    };

/** `list[i]`, or a failure: an index the simulation lost. */
function at<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new SkeletonFailure("an index out of range");
  return value;
}

const prevIn = (loop: Loop, i: number): Item =>
  at(loop, (i + loop.length - 1) % loop.length);
const nextIn = (loop: Loop, i: number): Item => at(loop, (i + 1) % loop.length);

function makeLoops(
  rings: readonly (readonly EnuPoint[])[],
  weights: readonly (readonly number[])[],
): Loop[] {
  return rings.map((ring, r) =>
    ring.map((a, i) => {
      const b = at(ring, (i + 1) % ring.length);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) throw new SkeletonFailure("a zero-length wall");
      const nx = -dy / length;
      const ny = dx / length;
      const edge: Wall = {
        ring: r,
        at: i,
        dx: dx / length,
        dy: dy / length,
        nx,
        ny,
        c: nx * a.x + ny * a.y,
        w: weights[r]?.[i] ?? 1,
      };
      return {
        edge,
        left: [{ x: a.x, y: a.y, t: 0 }],
        right: [{ x: b.x, y: b.y, t: 0 }],
      };
    }),
  );
}

/** Where two offset wall lines cross at time `t`. */
function crossing(l: Wall, r: Wall, t: number): SkeletonPoint {
  const det = l.nx * r.ny - l.ny * r.nx;
  if (Math.abs(det) < PARALLEL_EPS) throw new SkeletonFailure("parallel walls");
  const cl = l.c + l.w * t;
  const cr = r.c + r.w * t;
  return {
    x: (cl * r.ny - cr * l.ny) / det,
    y: (l.nx * cr - r.nx * cl) / det,
    t,
  };
}

/** The time this wall's stretch of wavefront shrinks to nothing, or undefined. */
function edgeCollapse(loop: Loop, i: number, now: number): number | undefined {
  const { edge } = at(loop, i);
  const prev = prevIn(loop, i).edge;
  const next = nextIn(loop, i).edge;
  const span = (t: number): number => {
    const a = crossing(prev, edge, t);
    const b = crossing(edge, next, t);
    return (b.x - a.x) * edge.dx + (b.y - a.y) * edge.dy;
  };
  const s0 = span(0);
  const rate = span(1) - s0;
  if (rate >= -1e-12) return undefined;
  const t = -s0 / rate;
  return t >= now - PAST_EPS ? Math.max(t, now) : undefined;
}

/** May this corner's walk end on `target`? Not on its own or next walls. */
function isCandidate(loop: Loop, i: number, target: Item): boolean {
  const l = i === 0 ? loop.length - 1 : i - 1;
  return (
    target !== at(loop, i) &&
    target !== at(loop, l) &&
    target !== nextIn(loop, i) &&
    target !== prevIn(loop, l)
  );
}

interface Motion {
  readonly p0: SkeletonPoint;
  readonly vx: number;
  readonly vy: number;
}

/** When and where a moving corner reaches wall `e`, or undefined. */
function reach(m: Motion, e: Wall, now: number): SkeletonPoint | undefined {
  const denom = e.nx * m.vx + e.ny * m.vy - e.w;
  if (Math.abs(denom) < 1e-12) return undefined;
  const t = (e.c - e.nx * m.p0.x - e.ny * m.p0.y) / denom;
  if (t < now - PAST_EPS) return undefined;
  const hit = Math.max(t, now);
  // It has to arrive from the wall's inner side.
  const gap =
    e.nx * (m.p0.x + m.vx * now) +
    e.ny * (m.p0.y + m.vy * now) -
    e.c -
    e.w * now;
  if (gap < -1e-6) return undefined;
  return { t: hit, x: m.p0.x + m.vx * hit, y: m.p0.y + m.vy * hit };
}

/** The time a moving corner hits wall `j` of `other` within its span, if before `before`. */
function hitOn(
  m: Motion,
  other: Loop,
  j: number,
  now: number,
  before: number,
): number | undefined {
  const e = at(other, j).edge;
  const hit = reach(m, e, now);
  if (hit === undefined || hit.t >= before - TIME_EPS) return undefined;
  const a = crossing(prevIn(other, j).edge, e, hit.t);
  const b = crossing(e, nextIn(other, j).edge, hit.t);
  if ((hit.x - a.x) * e.dx + (hit.y - a.y) * e.dy < -SPAN_EPS) return undefined;
  if ((b.x - hit.x) * e.dx + (b.y - hit.y) * e.dy < -SPAN_EPS) return undefined;
  return hit.t;
}

/** The earliest wall this reflex corner runs into, or `best`. */
function cornerHit(
  loops: readonly Loop[],
  li: number,
  i: number,
  now: number,
  best: WaveEvent | undefined,
): WaveEvent | undefined {
  const loop = at(loops, li);
  const l = prevIn(loop, i).edge;
  const r = at(loop, i).edge;
  if (l.dx * r.dy - l.dy * r.dx > -1e-9) return best;
  const p0 = crossing(l, r, 0);
  const p1 = crossing(l, r, 1);
  const motion = { p0, vx: p1.x - p0.x, vy: p1.y - p0.y };
  let found = best;
  for (const [m, other] of loops.entries()) {
    for (const [j, target] of other.entries()) {
      if (m === li && !isCandidate(loop, i, target)) continue;
      const t = hitOn(
        motion,
        other,
        j,
        now,
        found?.t ?? Number.POSITIVE_INFINITY,
      );
      if (t !== undefined)
        found = { kind: "split", t, loop: li, i, other: m, j };
    }
  }
  return found;
}

function nextEvent(loops: readonly Loop[], now: number): WaveEvent | undefined {
  let best: WaveEvent | undefined;
  for (const [l, loop] of loops.entries()) {
    for (let i = 0; i < loop.length; i++) {
      const t = edgeCollapse(loop, i, now);
      if (t !== undefined && (best === undefined || t < best.t)) {
        best = { kind: "edge", t, loop: l, i };
      }
    }
  }
  for (const [l, loop] of loops.entries()) {
    for (let i = 0; i < loop.length; i++)
      best = cornerHit(loops, l, i, now, best);
  }
  return best;
}

function closeItem(faces: RawFace[], item: Item): void {
  const points = [...item.left];
  for (let i = item.right.length - 1; i >= 0; i--) {
    const p = at(item.right, i);
    const last = at(points, points.length - 1);
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1e-9 || p.t !== last.t) {
      points.push(p);
    }
  }
  if (points.length >= 3) faces.push({ edge: item.edge, points });
}

/** Closes a whole loop at `t`: every wall ends at its two corners of then. */
function closeLoop(faces: RawFace[], loop: Loop, t: number): void {
  if (loop.length >= 3) {
    const corners = loop.map((item, i) =>
      crossing(prevIn(loop, i).edge, item.edge, t),
    );
    loop.forEach((item, i) => {
      item.left.push(at(corners, i));
      item.right.push(at(corners, (i + 1) % loop.length));
    });
  }
  for (const item of loop) closeItem(faces, item);
}

function applyEdge(
  faces: RawFace[],
  loops: Loop[],
  event: Extract<WaveEvent, { kind: "edge" }>,
): void {
  const loop = at(loops, event.loop);
  if (loop.length <= 3) {
    closeLoop(faces, loop, event.t);
    loops.splice(event.loop, 1);
    return;
  }
  const item = at(loop, event.i);
  const prev = prevIn(loop, event.i);
  const next = nextIn(loop, event.i);
  const a = crossing(prev.edge, item.edge, event.t);
  const b = crossing(item.edge, next.edge, event.t);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: event.t };
  item.left.push(m);
  item.right.push(m);
  closeItem(faces, item);
  prev.right.push(m);
  next.left.push(m);
  loop.splice(event.i, 1);
}

const rotated = <T>(list: readonly T[], from: number): T[] => [
  ...list.slice(from),
  ...list.slice(0, from),
];

function applySplit(
  faces: RawFace[],
  loops: Loop[],
  event: Extract<WaveEvent, { kind: "split" }>,
): void {
  const loop = at(loops, event.loop);
  const other = at(loops, event.other);
  const { t, i, j } = event;
  const l = prevIn(loop, i);
  const r = at(loop, i);
  const target = at(other, j);
  const q = crossing(l.edge, r.edge, t);
  const a = crossing(prevIn(other, j).edge, target.edge, t);
  const b = crossing(target.edge, nextIn(other, j).edge, t);
  l.right.push(q);
  r.left.push(q);
  // The hit wall ends here and goes on as two; its neighbours note the two
  // corners, so their faces carry the same vertices and no crack can open.
  prevIn(other, j).right.push(a);
  nextIn(other, j).left.push(b);
  target.left.push(a);
  target.right.push(b);
  closeItem(faces, target);
  const first: Item = { edge: target.edge, left: [a], right: [q] };
  const second: Item = { edge: target.edge, left: [q], right: [b] };
  const fromR = rotated(loop, i);
  if (event.loop === event.other) {
    splitOneLoop(faces, loops, event.loop, fromR, target, first, second, t);
    return;
  }
  const merged = [...fromR, second, ...rotated(other, j).slice(1), first];
  for (const index of [event.loop, event.other].sort((x, y) => y - x)) {
    loops.splice(index, 1);
  }
  loops.push(merged);
}

/** A corner hit its own loop's wall: the loop becomes two. */
function splitOneLoop(
  faces: RawFace[],
  loops: Loop[],
  index: number,
  fromR: Loop,
  target: Item,
  first: Item,
  second: Item,
  t: number,
): void {
  const where = fromR.indexOf(target);
  if (where < 0) throw new SkeletonFailure("a split lost its wall");
  const pieces = [
    [...fromR.slice(0, where), first],
    [second, ...fromR.slice(where + 1)],
  ];
  loops.splice(index, 1);
  for (const piece of pieces) {
    if (piece.length >= 3) loops.push(piece);
    else closeLoop(faces, piece, t);
  }
}

/** The loops left at the limit, as flat tops. */
function capsFrom(loops: readonly Loop[], t: number): SkeletonCap[] {
  const rings = loops.map((loop) =>
    loop.map((item, i) => crossing(prevIn(loop, i).edge, item.edge, t)),
  );
  const outers = rings.filter((ring) => signedArea2(ring) > 0);
  const holes = rings.filter((ring) => signedArea2(ring) < 0);
  return outers.map((outer) => ({
    outer,
    holes: holes.filter((hole) => containsPoint(outer, at(hole, 0))),
  }));
}

function runSkeleton(
  rings: readonly (readonly EnuPoint[])[],
  weights: readonly (readonly number[])[],
  maxT: number,
): Run {
  const loops = makeLoops(rings, weights);
  const wallCount = rings.reduce((sum, ring) => sum + ring.length, 0);
  const faces: RawFace[] = [];
  let now = 0;
  for (let step = 0; loops.length > 0; step++) {
    if (step > wallCount * MAX_STEPS_PER_WALL) {
      throw new SkeletonFailure("no end in sight");
    }
    const event = nextEvent(loops, now);
    if (event === undefined && maxT === Number.POSITIVE_INFINITY) {
      throw new SkeletonFailure("no event left");
    }
    if (event === undefined || event.t > maxT) {
      const caps = capsFrom(loops, maxT);
      for (const loop of loops) closeLoop(faces, loop, maxT);
      return { faces, caps, ridgeT: maxT };
    }
    now = event.t;
    if (event.kind === "edge") applyEdge(faces, loops, event);
    else applySplit(faces, loops, event);
  }
  return { faces, caps: [], ridgeT: now };
}

// ---------------------------------------------------------------------------
// Finishing and checking

/** The run's faces with their eaves back on the given corners. */
function finish(run: Run, prepared: readonly PreparedRing[]): SkeletonRoof {
  const faces = run.faces.map((face) =>
    finishFace(face, at(prepared, face.edge.ring)),
  );
  return {
    faces,
    caps: run.caps,
    ridgeT: run.ridgeT,
    gables: faces.filter((face) => face.vertical).length,
  };
}

function finishFace(raw: RawFace, ring: PreparedRing): SkeletonFace {
  const { edge } = raw;
  const n = ring.keep.length;
  const from = at(ring.keep, edge.at);
  const to = at(ring.keep, (edge.at + 1) % n);
  const points = [...raw.points];
  const last = points.length - 1;
  if (at(points, 0).t === 0 && at(points, last).t === 0) {
    // Snap the eave back to the given corners, and put back the corners the
    // preparation dropped between them, in the face's order (b back to a).
    points[0] = snapped(ring.oriented, from);
    points[last] = snapped(ring.oriented, to);
    const size = ring.oriented.length;
    const between: SkeletonPoint[] = [];
    for (let k = (from + 1) % size; k !== to; k = (k + 1) % size) {
      between.push(snapped(ring.oriented, k));
    }
    points.push(...between.reverse());
  }
  return {
    ring: edge.ring,
    wall: givenWall(ring, from),
    vertical: edge.w === 0,
    weight: edge.w,
    nx: edge.nx,
    ny: edge.ny,
    dx: edge.dx,
    dy: edge.dy,
    points,
  };
}

function snapped(points: readonly EnuPoint[], k: number): SkeletonPoint {
  const p = at(points, k);
  return { x: p.x, y: p.y, t: 0 };
}

function assertSound(
  roof: SkeletonRoof,
  prepared: readonly PreparedRing[],
): void {
  const [outer, ...holes] = prepared.map((ring) => ring.oriented);
  if (outer === undefined) throw new SkeletonFailure("no outer ring");
  if (!allFinite(roof))
    throw new SkeletonFailure("a number that is not finite");
  const want =
    Math.abs(signedArea2(outer)) / 2 -
    holes.reduce((sum, hole) => sum + Math.abs(signedArea2(hole)) / 2, 0);
  const covered = skeletonPlanArea(roof);
  if (!(want > 0) || Math.abs(covered - want) > want * AREA_TOLERANCE) {
    throw new SkeletonFailure("the roof does not cover its ring");
  }
  const overAir = roof.faces
    .filter((face) => !face.vertical)
    .flatMap((face) => faceTriangles(face))
    .some(([a, b, c]) => {
      const mid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
      return (
        !containsPoint(outer, mid) ||
        holes.some((hole) => containsPoint(hole, mid))
      );
    });
  if (overAir) {
    throw new SkeletonFailure("a slope over air or over a courtyard");
  }
}

/** True when every number of the roof is finite. */
function allFinite(roof: SkeletonRoof): boolean {
  const finite = (p: EnuPoint & { t?: number }): boolean =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t ?? 0);
  return (
    Number.isFinite(roof.ridgeT) &&
    roof.faces.every((face) => face.points.every(finite)) &&
    roof.caps.every((cap) =>
      [cap.outer, ...cap.holes].every((r) => r.every(finite)),
    )
  );
}
