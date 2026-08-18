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
 * CANDIDATES ARE VISITED NEAREST-FIRST AND THE SEARCH STOPS AT THE FIRST VISIBLE
 * ONE, which is the whole performance story of this function. The obvious
 * formulation — walk the ring in order, and re-test visibility whenever
 * something closer turns up — is quadratic for a reason that is easy to miss:
 * the running best distance only tightens on a candidate that turned out to be
 * VISIBLE, so until the first visible one is found it is still infinite and
 * *every* candidate pays a full `crossesRing` scan of the ring's edges. On the
 * Royal Parks relation in `london-westminster` (1 031 outer points, 33 holes
 * after clipping to the demo's extent) that was 8 812 `crossesRing` calls and
 * **5.2 million segment-intersection tests**, 41.7 ms of the 42.5 ms the whole
 * triangulation took. Nearest-first makes it 33 calls — one per hole — and
 * 0.96 ms. See `triangulate.ts.md` for the numbers and `triangulate.bench.ts`.
 *
 * ORDER IS THE ONLY THING THAT CHANGED — nearest-first returns the same vertex
 * the ring-order scan did, ties included, because it keeps the FIRST of equal
 * distances exactly as `distance >= bestDistance` did. Two one-off differentials
 * against the previous implementation found zero differences: `triangulate`'s
 * full output over all 7 141 corpus polygons, and the bridged ring over the 157
 * holed ones plus 20 000 generated cases.
 *
 * Still O(ring²) per hole in the worst case, when every candidate nearer than the
 * answer is blocked — but that worst case is now reached only by input that
 * genuinely has that many blocked candidates, rather than by every input.
 *
 * HOLES ARE RARE IN BUILDINGS, NOT IN AREAS, and that distinction is what makes
 * the cost real rather than theoretical. A courtyard gives a building one inner
 * ring; a landuse or natural relation routinely carries dozens. Any reasoning
 * here that assumes "a handful of holes" is reasoning about the building
 * extruder, which stopped being the only caller when the plate layer arrived.
 */
function nearestVisible(
  vertices: readonly EnuPoint[],
  ring: readonly number[],
  from: number,
): number {
  const p = vertices[from];
  if (p === undefined) return -1;

  // Candidates found nearest but NOT visible. Normally empty: the nearest ring
  // vertex is visible on the first try for every hole in the corpus, so this
  // allocates nothing per candidate and the loop below runs once.
  const blocked = new Set<number>();

  // Terminates because every pass either returns or blocks one more index, and
  // `ring` holds finitely many distinct ones. It does repeat indices — a bridge
  // puts its attachment vertex in twice — and blocking by index value covers
  // every occurrence at once, which is also why a repeat costs nothing.
  for (;;) {
    let best = -1;
    let bestPoint: EnuPoint | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of ring) {
      if (blocked.has(candidate)) continue;
      const q = vertices[candidate];
      if (q === undefined) continue;
      const distance = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (distance >= bestDistance) continue;
      best = candidate;
      bestPoint = q;
      bestDistance = distance;
    }

    if (bestPoint === undefined) return -1; // nothing left to try: no bridge
    if (!crossesRing(vertices, ring, p, bestPoint)) return best;
    blocked.add(best);
  }
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
      // DEGENERATE TRIANGLES ARE CLIPPED BUT NOT EMITTED. The ear still has to
      // come off the ring — skipping the splice would spin — but a zero-area
      // face is never useful to any consumer and is actively harmful to one.
      // See `emit` below.
      emit(vertices, indices, prev, curr, next);
      ring.splice(i % ring.length, 1);
      sinceProgress = 0;
      i = i % Math.max(1, ring.length);
    } else {
      i = (i + 1) % ring.length;
      sinceProgress++;
    }
  }

  if (ring.length === 3) {
    emit(
      vertices,
      indices,
      ring[0] as number,
      ring[1] as number,
      ring[2] as number,
    );
  }
  return { indices, forcedEars };
}

/**
 * Twice the unsigned area of a triangle, in the plane.
 *
 * Squared units of whatever the vertices are in — metres for a mesh ring — so
 * the threshold below is an area rather than a length.
 */
function doubleArea(a: EnuPoint, b: EnuPoint, c: EnuPoint): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

/**
 * Below this, a triangle is treated as having no area at all.
 *
 * 1e-9 m² is a square 30 µm on a side. Nothing in OSM is that small, and
 * floating-point noise on a legitimately thin sliver stays far above it — so
 * this rejects the genuinely collapsed without touching the merely thin.
 */
const MIN_DOUBLE_AREA = 1e-9;

/**
 * Appends a triangle unless it has collapsed to a line or a point.
 *
 * WHY THIS FILTER EXISTS (DEC-R7b-5). A zero-area triangle has no defined face
 * normal. Under `flatShading` — which `plates.ts`, `region-slabs.ts` and the road
 * ribbons all use — three derives the shading FROM that normal, so a collapsed
 * face renders as a black sliver beside its correctly-lit neighbours. That is the
 * mechanism behind a testing session's report of the Thames going black once
 * landuse was switched on.
 *
 * WHERE THEY COME FROM. `spatial/clip.ts` warns that Sutherland–Hodgman "can
 * produce degenerate 'seams' for concave subjects", and since `2262e6a`
 * `mesh/plates.ts` clips and hands the result straight here. A river is the
 * textbook concave subject: `plates-concave.test.ts` reproduces it and finds
 * two collapsed triangles in one meander.
 *
 * WHY DROPPING IS SAFE FOR EVERY CONSUMER, not just the renderer. A zero-area
 * triangle contributes nothing to `triangulatedArea`, covers no H3 cell, and
 * occupies no pixels — it is invisible to everything except the shading it
 * breaks. There is no consumer for which emitting one is better.
 *
 * `forcedEars` is deliberately NOT suppressed alongside it. That counter is the
 * triangulator admitting it could not find a valid ear, which stays true whether
 * or not the resulting triangle is kept — and it is the signal that the INPUT
 * ring was bad, which is a different problem from this output filter.
 */
function emit(
  vertices: readonly EnuPoint[],
  indices: number[],
  a: number,
  b: number,
  c: number,
): void {
  const pa = vertices[a];
  const pb = vertices[b];
  const pc = vertices[c];
  if (pa === undefined || pb === undefined || pc === undefined) return;
  if (doubleArea(pa, pb, pc) < MIN_DOUBLE_AREA) return;
  indices.push(a, b, c);
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
