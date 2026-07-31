/**
 * Ring stitching for multipolygon relations.
 *
 * Ported from the C# reference's `OsmExtensions.CombineToClosedArea`, and
 * generalised in two ways the reference could not handle:
 *
 *  - **Any number of rings.** The reference stitches every open way into ONE
 *    ring and throws if that fails. A real multipolygon can have several outer
 *    rings each split across several ways.
 *  - **Per-segment reversal.** The reference reverses its accumulated result
 *    when orientation flips, which only works for a single flip. Reversing the
 *    *incoming segment* instead handles arbitrarily many.
 *
 * Failure is returned, never thrown: this runs against whatever the real planet
 * contains, and one broken relation must not kill a tile.
 *
 * @see multipolygon-builder.ts.md
 */

import type { LatLng } from "./osm-feature.js";
import { positionsEqual } from "./osm-feature.js";

/** A closed ring: first position equals last. */
export type Ring = readonly LatLng[];

export type StitchResult =
  | { readonly ok: true; readonly rings: readonly Ring[] }
  | { readonly ok: false; readonly unclosed: readonly (readonly LatLng[])[] };

/**
 * Stitches way geometries head-to-tail into closed rings.
 *
 * Already-closed inputs pass through as their own ring. Open inputs are chained
 * by matching endpoints, reversing a segment when it attaches tail-first.
 *
 * @returns `ok: true` with every ring closed, or `ok: false` carrying the
 *   partial chains that could not be closed — which is what makes the failure
 *   debuggable rather than just "invalid".
 */
export function stitchRings(
  segments: readonly (readonly LatLng[])[],
): StitchResult {
  const rings: Ring[] = [];
  const unclosed: (readonly LatLng[])[] = [];

  // Segments still available to consume. Using a mutable array of
  // (segment | undefined) rather than removing from the array keeps indices
  // stable and avoids O(n^2) splices on large relations.
  const pool: (readonly LatLng[] | undefined)[] = segments.map((s) =>
    s.length >= 2 ? s : undefined,
  );
  const byEndpoint = indexEndpoints(pool);

  for (let i = 0; i < pool.length; i++) {
    const seed = pool[i];
    if (seed === undefined) {
      continue;
    }
    pool[i] = undefined;

    if (isClosedRing(seed)) {
      rings.push(seed);
      continue;
    }

    const chain = growChain(seed, pool, byEndpoint);
    if (isClosedRing(chain)) {
      rings.push(chain);
    } else {
      unclosed.push(chain);
    }
  }

  if (unclosed.length > 0) {
    return { ok: false, unclosed };
  }
  return { ok: true, rings };
}

/**
 * A chain being grown, held open at BOTH ends so extending it costs
 * O(segment) rather than O(chain).
 *
 * WHY NOT ONE ARRAY. The obvious form — rebuild `[...chain, ...segment]` on
 * every attach — copies the whole accumulated chain each time, which is
 * quadratic in the chain's POINT count. Measured 2026-07-31: that copy was the
 * single largest own-code frame in the entire `buildFeatureIndex` profile
 * (9.6 % of all sampled time), because the last attaches of a 26 778-point
 * boundary relation each copy ~26 000 points.
 *
 * `head` holds the points preceding the seed, stored REVERSED, so growing
 * either end is a `push`. Nothing is copied until `materialise`.
 */
interface Chain {
  /** Points before the seed, nearest-the-seed first (i.e. reversed). */
  readonly head: LatLng[];
  /** The seed, followed by everything appended after it. */
  readonly tail: LatLng[];
}

function chainStart(chain: Chain): LatLng {
  return chain.head.length > 0
    ? chain.head[chain.head.length - 1]!
    : chain.tail[0]!;
}

function chainEnd(chain: Chain): LatLng {
  return chain.tail[chain.tail.length - 1]!;
}

/** `isClosedRing`'s rule, without materialising the chain to ask. */
function chainIsClosed(chain: Chain): boolean {
  return (
    chain.head.length + chain.tail.length >= 4 &&
    positionsEqual(chainStart(chain), chainEnd(chain))
  );
}

/** The chain as one array, in order. The only copy `growChain` performs. */
function materialise(chain: Chain): LatLng[] {
  const out: LatLng[] = [];
  for (let i = chain.head.length - 1; i >= 0; i--) {
    out.push(chain.head[i]!);
  }
  // A loop rather than `push(...tail)`: `tail` reaches tens of thousands of
  // points on real boundary relations, and spreading that many arguments
  // overflows the stack.
  for (const point of chain.tail) {
    out.push(point);
  }
  return out;
}

/**
 * Endpoint hash key, faithful to `positionsEqual` (which is `===`).
 *
 * NaN is deliberately UNKEYED: `NaN !== NaN`, so a NaN endpoint must match
 * nothing — yet `${NaN}` gives every NaN endpoint the same key, which would
 * join them. Infinity stays keyed, because `Infinity === Infinity` and the
 * linear scan this replaces did join on it.
 *
 * `-0` needs no special case: `-0 === 0` and both stringify to `"0"`, so the
 * key agrees with `positionsEqual` in both directions.
 */
function endpointKey(position: LatLng): string | undefined {
  if (Number.isNaN(position.lat) || Number.isNaN(position.lng)) {
    return undefined;
  }
  return `${position.lat},${position.lng}`;
}

/** endpoint → pool indices of every segment starting or ending there. */
function indexEndpoints(
  pool: readonly (readonly LatLng[] | undefined)[],
): Map<string, number[]> {
  const byEndpoint = new Map<string, number[]>();

  const add = (position: LatLng | undefined, index: number): void => {
    if (position === undefined) return;
    const key = endpointKey(position);
    if (key === undefined) return;
    const bucket = byEndpoint.get(key);
    if (bucket === undefined) {
      byEndpoint.set(key, [index]);
      // A CLOSED segment has both endpoints at the same key; indexing it twice
      // would make it look like two candidates. Only ever an adjacent
      // duplicate, because both `add` calls for one segment run together.
    } else if (bucket[bucket.length - 1] !== index) {
      bucket.push(index);
    }
  };

  for (let i = 0; i < pool.length; i++) {
    const segment = pool[i];
    if (segment === undefined) continue;
    add(segment[0], i);
    add(segment[segment.length - 1], i);
  }
  return byEndpoint;
}

/**
 * The LOWEST-indexed unconsumed segment with an endpoint at `position`.
 *
 * Lowest index, not "first found", and that is the whole equivalence argument
 * with the linear scan this replaces: the old loop walked the pool in index
 * order and took the first segment matching ANY of `attach`'s four cases. A
 * lookup that instead preferred, say, tail matches globally would choose a
 * different segment wherever more than one fits, which is observable on
 * branching data.
 *
 * Buckets are compacted in place as consumed entries are found, so repeated
 * lookups do not keep re-walking dead indices.
 */
function candidateAt(
  byEndpoint: Map<string, number[]>,
  pool: readonly (readonly LatLng[] | undefined)[],
  position: LatLng,
): number | undefined {
  const key = endpointKey(position);
  if (key === undefined) return undefined;
  const bucket = byEndpoint.get(key);
  if (bucket === undefined) return undefined;

  let best: number | undefined;
  let live = 0;
  for (const index of bucket) {
    if (pool[index] === undefined) continue;
    bucket[live++] = index;
    if (best === undefined || index < best) best = index;
  }
  bucket.length = live;
  return best;
}

/** The smaller of two optional pool indices. */
function lowerOf(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a < b ? a : b;
}

/**
 * Extends `seed` by repeatedly attaching whichever remaining segment shares an
 * endpoint, consuming segments from `pool` as it goes.
 *
 * Attaches at BOTH ends. Attaching only at the tail would fail on a ring whose
 * seed happens to sit in the middle of the chain — a case the C# reference
 * papered over by reversing its whole accumulated result.
 *
 * Candidates come from an endpoint hash map rather than a rescan of the pool,
 * which removes the second of the two quadratic terms (the first being the
 * chain copy, see `Chain`).
 */
function growChain(
  seed: readonly LatLng[],
  pool: (readonly LatLng[] | undefined)[],
  byEndpoint: Map<string, number[]>,
): readonly LatLng[] {
  const chain: Chain = { head: [], tail: [...seed] };

  while (!chainIsClosed(chain)) {
    const index = lowerOf(
      candidateAt(byEndpoint, pool, chainEnd(chain)),
      candidateAt(byEndpoint, pool, chainStart(chain)),
    );
    if (index === undefined) {
      break;
    }
    const segment = pool[index]!;
    pool[index] = undefined;
    attach(chain, segment);
  }

  return materialise(chain);
}

/**
 * Attaches `segment` to whichever end of `chain` shares a position with it,
 * reversing it if needed. Mutates `chain`.
 *
 * The four cases are tried in the order the previous linear scan used, so a
 * segment that could attach at both ends still attaches the same way.
 *
 * The final fall-through is unreachable by construction — `candidateAt` only
 * ever returns a segment indexed under one of the two chain endpoints, and
 * `endpointKey` is built to agree with `positionsEqual` in both directions. It
 * returns rather than throws anyway: this module's contract is that a broken
 * relation is REPORTED, never thrown (one bad relation must not kill a tile),
 * and the caller has already consumed the segment, so falling through drops
 * exactly that segment and lets the chain close or be reported unclosed.
 */
function attach(chain: Chain, segment: readonly LatLng[]): void {
  const start = chainStart(chain);
  const end = chainEnd(chain);
  const segStart = segment[0]!;
  const segEnd = segment[segment.length - 1]!;

  // chain -> segment
  if (positionsEqual(end, segStart)) {
    for (let i = 1; i < segment.length; i++) chain.tail.push(segment[i]!);
    return;
  }
  // chain -> reversed(segment)
  if (positionsEqual(end, segEnd)) {
    for (let i = segment.length - 2; i >= 0; i--) chain.tail.push(segment[i]!);
    return;
  }
  // segment -> chain
  if (positionsEqual(segEnd, start)) {
    for (let i = segment.length - 2; i >= 0; i--) chain.head.push(segment[i]!);
    return;
  }
  // reversed(segment) -> chain
  if (positionsEqual(segStart, start)) {
    for (let i = 1; i < segment.length; i++) chain.head.push(segment[i]!);
  }
}

/** A ring is closed when it has real extent and its ends coincide. */
export function isClosedRing(positions: readonly LatLng[]): boolean {
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (positions.length < 4 || first === undefined || last === undefined) {
    return false;
  }
  return positionsEqual(first, last);
}

/**
 * Ray-casting point-in-ring test, used to assign holes to the outer ring that
 * actually contains them.
 *
 * Operates directly on lat/lng degrees. That is correct here because
 * containment is a purely topological question — no distance or area is
 * computed — so the degree anisotropy that matters elsewhere (plan §4.5) is
 * irrelevant. The antimeridian is NOT handled; a multipolygon spanning it would
 * need splitting first, and none exist at the scales this package works at.
 */
export function isPointInRing(point: LatLng, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng <
        ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Groups outer rings with the inner rings they contain.
 *
 * The C# reference throws `NotImplementedException` for "multiple outer rings
 * AND holes" precisely because it had no containment test. With one, the case
 * is ordinary: test each hole against each outer ring by a representative
 * vertex.
 *
 * A hole matching no outer ring is dropped rather than attached to an arbitrary
 * one — silently punching a hole in the wrong building is worse than ignoring a
 * malformed relation member.
 */
export function groupRingsIntoPolygons(
  outerRings: readonly Ring[],
  innerRings: readonly Ring[],
): Ring[][] {
  const polygons: Ring[][] = outerRings.map((outer) => [outer]);

  for (const hole of innerRings) {
    const probe = hole[0];
    if (probe === undefined) {
      continue;
    }
    // Smallest containing ring wins, so a hole inside a courtyard inside a
    // block attaches to the courtyard rather than the block.
    let bestIndex = -1;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let i = 0; i < outerRings.length; i++) {
      const outer = outerRings[i]!;
      if (!isPointInRing(probe, outer)) {
        continue;
      }
      const area = Math.abs(signedRingArea(outer));
      if (area < bestArea) {
        bestArea = area;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      polygons[bestIndex]!.push(hole);
    }
  }

  return polygons;
}

/**
 * Shoelace area in squared degrees. Used ONLY to compare rings against each
 * other (smallest-containing-ring selection), never as a real-world area —
 * squared degrees are not squared metres and vary with latitude.
 */
export function signedRingArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    sum += (b.lng + a.lng) * (b.lat - a.lat);
  }
  return sum / 2;
}
