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

    const chain = growChain(seed, pool);
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
 * Extends `seed` by repeatedly attaching whichever remaining segment shares an
 * endpoint, consuming segments from `pool` as it goes.
 *
 * Attaches at BOTH ends. Attaching only at the tail would fail on a ring whose
 * seed happens to sit in the middle of the chain — a case the C# reference
 * papered over by reversing its whole accumulated result.
 */
function growChain(
  seed: readonly LatLng[],
  pool: (readonly LatLng[] | undefined)[],
): readonly LatLng[] {
  let chain = [...seed];

  let extended = true;
  while (extended && !isClosedRing(chain)) {
    extended = false;
    for (let j = 0; j < pool.length; j++) {
      const candidate = pool[j];
      if (candidate === undefined) {
        continue;
      }
      const attached = attach(chain, candidate);
      if (attached !== undefined) {
        chain = attached;
        pool[j] = undefined;
        extended = true;
        break;
      }
    }
  }
  return chain;
}

/**
 * Attaches `segment` to either end of `chain`, reversing it if needed.
 * Returns `undefined` when they do not share an endpoint.
 */
function attach(
  chain: readonly LatLng[],
  segment: readonly LatLng[],
): LatLng[] | undefined {
  const chainStart = chain[0];
  const chainEnd = chain[chain.length - 1];
  const segStart = segment[0];
  const segEnd = segment[segment.length - 1];
  if (
    chainStart === undefined ||
    chainEnd === undefined ||
    segStart === undefined ||
    segEnd === undefined
  ) {
    return undefined;
  }

  // chain -> segment
  if (positionsEqual(chainEnd, segStart)) {
    return [...chain, ...segment.slice(1)];
  }
  // chain -> reversed(segment)
  if (positionsEqual(chainEnd, segEnd)) {
    return [...chain, ...[...segment].reverse().slice(1)];
  }
  // segment -> chain
  if (positionsEqual(segEnd, chainStart)) {
    return [...segment, ...chain.slice(1)];
  }
  // reversed(segment) -> chain
  if (positionsEqual(segStart, chainStart)) {
    return [...[...segment].reverse(), ...chain.slice(1)];
  }
  return undefined;
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
