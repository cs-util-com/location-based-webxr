/**
 * Hole-aware ear-clipping triangulation.
 *
 * WHY OURS RATHER THAN `earcut`. The owner's decision is that production code
 * takes no runtime dependency but `h3-js` (plan §4.2). The plan's answer to
 * "then how do you know it is right?" is §4.2.1's comparison harness: `earcut`
 * is a **devDependency** used as a differential oracle and a benchmark, never
 * shipped. Hole-aware ear clipping is named there as the pairing most likely to
 * earn its keep, because it is a classic correctness sink.
 *
 * THE ALGORITHM, and where each part earns its place:
 *
 * 1. **Holes are bridged into the outer ring** before clipping, so the whole
 *    thing becomes one simple polygon. This is the standard approach and it is
 *    also where hand-rolled implementations usually go wrong — the bridge has
 *    to be a segment that intersects nothing.
 * 2. **Ear clipping** on the merged ring: repeatedly remove a convex vertex
 *    whose triangle contains no other vertex.
 * 3. **A progress guard.** Degenerate input (collinear runs, repeated points,
 *    self-touching rings — all of which real OSM contains) can make no vertex
 *    look like a valid ear. Rather than loop forever, the clipper forces the
 *    least-bad ear and records that it did. **Non-termination is the failure
 *    mode that hurts most** — this package already lost a test run to a
 *    coverage call that never finished, and that lesson applies here too.
 *
 * Output is index triples into the input vertex list, so the caller owns the
 * vertex buffer and no coordinates are copied.
 *
 * @see triangulate.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { isCounterClockwise } from "./enu.js";

export interface TriangulationResult {
  /** Flat vertex list: outer ring followed by each hole, in input order. */
  readonly vertices: readonly EnuPoint[];
  /** Triangle indices into `vertices`, three per triangle. */
  readonly indices: readonly number[];
  /**
   * Ears forced by the progress guard.
   *
   * Non-zero means the input was degenerate somewhere. The result is still a
   * usable triangulation — it just may contain a sliver. Surfaced rather than
   * hidden so a caller can count how much of the real planet is malformed.
   */
  readonly forcedEars: number;
}

/**
 * Triangulates a polygon with holes.
 *
 * `rings[0]` is the outer ring; the rest are holes. Rings must NOT repeat their
 * first point as their last — `osm-geometry.ts` produces closed rings, so
 * `dropClosingPoint` exists for that and is applied here.
 *
 * Returns an empty triangulation rather than throwing for input that cannot
 * form a triangle. A library that has to survive whatever the planet contains
 * cannot make a degenerate building fatal.
 */
export function triangulate(
  rings: readonly (readonly EnuPoint[])[],
): TriangulationResult {
  const outer = dropClosingPoint(rings[0] ?? []);
  if (outer.length < 3) return { vertices: [], indices: [], forcedEars: 0 };

  const holes = rings
    .slice(1)
    .map(dropClosingPoint)
    .filter((hole) => hole.length >= 3);

  // Winding is normalised so the ear test's orientation assumption holds:
  // outer counter-clockwise, holes clockwise. Real OSM rings arrive both ways.
  const vertices: EnuPoint[] = [...orient(outer, true)];
  const holeStarts: number[] = [];
  for (const hole of holes) {
    holeStarts.push(vertices.length);
    vertices.push(...orient(hole, false));
  }

  const ring =
    holes.length === 0
      ? vertices.map((_, i) => i)
      : bridgeHoles(vertices, outer.length, holeStarts);

  return { vertices, ...clipEars(vertices, ring) };
}

/** Removes a duplicated final point, if present. */
export function dropClosingPoint(ring: readonly EnuPoint[]): EnuPoint[] {
  if (ring.length < 2) return [...ring];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    return ring.slice(0, -1);
  }
  return [...ring];
}

/** Returns the ring wound the requested way. */
function orient(
  ring: readonly EnuPoint[],
  counterClockwise: boolean,
): EnuPoint[] {
  return isCounterClockwise(ring) === counterClockwise
    ? [...ring]
    : [...ring].reverse();
}

/**
 * Merges holes into the outer ring by cutting a bridge to each.
 *
 * For each hole, the bridge runs from the hole's rightmost vertex to the
 * nearest visible vertex of the ring built so far. "Rightmost" is the classic
 * choice because a ray cast to the right from it is guaranteed to leave the
 * hole, which is what makes the visibility test cheap.
 *
 * Holes are processed rightmost-first. That ordering matters: bridging a
 * left-hand hole first can put its bridge across a right-hand one, and the
 * result is a self-intersecting ring that triangulates into overlapping
 * garbage — a failure that renders as flickering rather than as an error.
 */
function bridgeHoles(
  vertices: readonly EnuPoint[],
  outerCount: number,
  holeStarts: readonly number[],
): number[] {
  let ring = Array.from({ length: outerCount }, (_, i) => i);

  const ordered = [...holeStarts]
    .map((start, i) => {
      const end = holeStarts[i + 1] ?? vertices.length;
      return { start, end, right: rightmostIndex(vertices, start, end) };
    })
    .sort((a, b) => (vertices[b.right]?.x ?? 0) - (vertices[a.right]?.x ?? 0));

  for (const hole of ordered) {
    const bridge = nearestVisible(vertices, ring, hole.right);
    if (bridge === -1) continue; // no bridge found: skip the hole, keep the outline

    const holeIndices: number[] = [];
    const length = hole.end - hole.start;
    for (let k = 0; k < length; k++) {
      holeIndices.push(hole.start + ((hole.right - hole.start + k) % length));
    }

    const at = ring.indexOf(bridge);
    ring = [
      ...ring.slice(0, at + 1),
      ...holeIndices,
      holeIndices[0] as number,
      ...ring.slice(at),
    ];
  }
  return ring;
}

function rightmostIndex(
  vertices: readonly EnuPoint[],
  start: number,
  end: number,
): number {
  let best = start;
  for (let i = start; i < end; i++) {
    const p = vertices[i];
    const b = vertices[best];
    if (p !== undefined && b !== undefined && p.x > b.x) best = i;
  }
  return best;
}

/**
 * The ring vertex nearest to `from` whose connecting segment crosses nothing.
 *
 * O(ring²) in the worst case, which is fine: holes are rare, and a building
 * with a courtyard has tens of vertices, not thousands.
 */
function nearestVisible(
  vertices: readonly EnuPoint[],
  ring: readonly number[],
  from: number,
): number {
  const p = vertices[from];
  if (p === undefined) return -1;

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of ring) {
    const q = vertices[candidate];
    if (q === undefined) continue;
    const distance = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (distance >= bestDistance) continue;
    if (crossesRing(vertices, ring, p, q)) continue;
    best = candidate;
    bestDistance = distance;
  }
  return best;
}

function crossesRing(
  vertices: readonly EnuPoint[],
  ring: readonly number[],
  a: EnuPoint,
  b: EnuPoint,
): boolean {
  for (let i = 0; i < ring.length; i++) {
    const c = vertices[ring[i] as number];
    const d = vertices[ring[(i + 1) % ring.length] as number];
    if (c === undefined || d === undefined) continue;
    // Segments sharing an endpoint with the bridge are not crossings.
    if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

const same = (a: EnuPoint, b: EnuPoint): boolean => a.x === b.x && a.y === b.y;

function cross(o: EnuPoint, a: EnuPoint, b: EnuPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
  d: EnuPoint,
): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Ear-clips a simple ring given as indices into `vertices`. */
function clipEars(
  vertices: readonly EnuPoint[],
  ringIndices: readonly number[],
): { indices: number[]; forcedEars: number } {
  const ring = [...ringIndices];
  const indices: number[] = [];
  let forcedEars = 0;

  // The guard: each pass around the ring that clips nothing means the input is
  // degenerate. Two full passes without progress and we force an ear rather
  // than spin. Non-termination is the failure mode that costs most here.
  let sinceProgress = 0;
  let i = 0;

  while (ring.length > 3) {
    const prev = ring[(i - 1 + ring.length) % ring.length] as number;
    const curr = ring[i % ring.length] as number;
    const next = ring[(i + 1) % ring.length] as number;

    const forced = sinceProgress > ring.length * 2;
    if (forced || isEar(vertices, ring, prev, curr, next)) {
      if (forced) forcedEars++;
      indices.push(prev, curr, next);
      ring.splice(i % ring.length, 1);
      sinceProgress = 0;
      i = i % Math.max(1, ring.length);
    } else {
      i = (i + 1) % ring.length;
      sinceProgress++;
    }
  }

  if (ring.length === 3) {
    indices.push(ring[0] as number, ring[1] as number, ring[2] as number);
  }
  return { indices, forcedEars };
}

function isEar(
  vertices: readonly EnuPoint[],
  ring: readonly number[],
  prev: number,
  curr: number,
  next: number,
): boolean {
  const a = vertices[prev];
  const b = vertices[curr];
  const c = vertices[next];
  if (a === undefined || b === undefined || c === undefined) return false;

  // Reflex or degenerate vertices are not ears. `<= 0` rather than `< 0` so a
  // collinear triple is rejected — clipping it would emit a zero-area triangle,
  // which renders as nothing and breaks normal computation.
  if (cross(a, b, c) <= 0) return false;
  return !containsAnyVertex(vertices, ring, [prev, curr, next], a, b, c);
}

/** True when any ring vertex other than the corners falls inside the triangle. */
function containsAnyVertex(
  vertices: readonly EnuPoint[],
  ring: readonly number[],
  corners: readonly number[],
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
): boolean {
  for (const index of ring) {
    if (corners.includes(index)) continue;
    const p = vertices[index];
    if (p === undefined) continue;
    if (pointInTriangle(p, a, b, c)) return true;
  }
  return false;
}

function pointInTriangle(
  p: EnuPoint,
  a: EnuPoint,
  b: EnuPoint,
  c: EnuPoint,
): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

/** Total area of a triangulation, m². Used by tests to prove nothing was lost. */
export function triangulatedArea(result: TriangulationResult): number {
  let total = 0;
  for (let i = 0; i + 2 < result.indices.length; i += 3) {
    const a = result.vertices[result.indices[i] as number];
    const b = result.vertices[result.indices[i + 1] as number];
    const c = result.vertices[result.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    total += Math.abs(cross(a, b, c)) / 2;
  }
  return total;
}
