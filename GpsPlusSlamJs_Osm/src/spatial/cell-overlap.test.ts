/**
 * The hand-rolled overlapping cover, checked against h3 itself.
 *
 * WHY THIS FILE IS A DIFFERENTIAL AND NOT A SET OF EXAMPLES. The module exists
 * only to give the SAME answer as `polygonToCellsExperimental` with
 * `containmentOverlapping`, more cheaply. So h3 is not a dependency to be
 * avoided here — it is the oracle, and any hand-written expectation would be a
 * second, weaker statement of what h3 already defines exactly.
 *
 * The properties that matter, in the order they can break:
 *
 * 1. **Never MISS a cell h3 reports.** A missing cell is a piece of wall that
 *    stops blocking, which is an agent walking through geometry a viewer can
 *    see — the failure `nav/obstacles.ts` exists to prevent.
 * 2. **Never ADD one h3 does not report.** An extra cell is a phantom obstacle:
 *    a route detours around nothing, or a cell is vetoed as unwalkable when it
 *    is open.
 * 3. **Decline rather than guess.** Returning `undefined` is always safe, since
 *    the caller falls back to h3; returning a wrong set is not. Every
 *    precondition is therefore tested for the DECLINE, not for a best effort.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS } from "h3-js";

import { overlappingCells } from "./cell-overlap.js";
import type { PlanarPoint } from "./point-in-ring.js";
import { AFFORDANCE_RES } from "./resolutions.js";

/** h3's answer for the same ring — the oracle this module must reproduce. */
function h3Cover(ring: readonly PlanarPoint[], res: number): Set<string> {
  return new Set(
    polygonToCellsExperimental(
      [ring.map((p) => [p.y, p.x] as [number, number])],
      res,
      POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
    ),
  );
}

/** A rectangle `wM x hM` metres with its south-west corner at `lat`/`lng`. */
function rect(lat: number, lng: number, wM: number, hM: number): PlanarPoint[] {
  const dLat = hM / 111320;
  const dLng = wM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    { x: lng, y: lat },
    { x: lng + dLng, y: lat },
    { x: lng + dLng, y: lat + dLat },
    { x: lng, y: lat + dLat },
  ];
}

/** Asserts our cover equals h3's exactly, reporting the direction of any gap. */
function expectAgreesWithH3(
  ring: readonly PlanarPoint[],
  res = AFFORDANCE_RES,
): void {
  const ours = overlappingCells(ring, res);
  expect(ours).toBeDefined();
  const theirs = h3Cover(ring, res);
  const missing = [...theirs].filter((c) => !ours?.includes(c));
  const extra = (ours ?? []).filter((c) => !theirs.has(c));
  // Reported as two separate arrays because the two failures mean opposite
  // things — see the header — and a set-equality diff would blur them.
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
}

describe("overlappingCells — agreement with h3", () => {
  it("matches h3 on a barrier-sized quad", () => {
    // 1 x 20 m is the shape `barrierFootprints` emits per wall segment, and
    // those are 43 % of the calls the obstacle sweep makes.
    expectAgreesWithH3(rect(51.5, -0.12, 1, 20));
  });

  it("matches h3 on a building-sized rectangle", () => {
    expectAgreesWithH3(rect(51.5, -0.12, 15, 20));
  });

  it("matches h3 on a polygon smaller than one cell", () => {
    // A res-13 cell is ~39 m^2. A half-metre square is well inside one, and is
    // the case where a cover that reasoned from cell centres alone would return
    // nothing at all.
    expectAgreesWithH3(rect(51.5, -0.12, 0.5, 0.5));
  });

  it("matches h3 on a concave ring", () => {
    // An L. Concavity is what separates a real overlap test from a bounding-box
    // one: the notch must NOT be covered, and h3 says so exactly.
    const base = rect(51.5, -0.12, 20, 20);
    const mid = {
      x: (base[0]!.x + base[1]!.x) / 2,
      y: (base[0]!.y + base[3]!.y) / 2,
    };
    expectAgreesWithH3([
      base[0]!,
      base[1]!,
      { x: base[1]!.x, y: mid.y },
      mid,
      { x: mid.x, y: base[3]!.y },
      base[3]!,
    ]);
  });

  it("matches h3 whichever way the ring winds", () => {
    // Real OSM rings arrive both ways and h3 does not care; neither may we.
    const ring = rect(51.5, -0.12, 8, 12);
    expectAgreesWithH3(ring);
    expectAgreesWithH3([...ring].reverse());
  });

  it("matches h3 across resolutions, not just the affordance one", () => {
    // The module takes a resolution because `h3-feature-index` passes its own.
    for (const res of [9, 11, 13, 15]) {
      expectAgreesWithH3(rect(51.5, -0.12, 5, 5), res);
    }
  });

  it("matches h3 at high latitude and across the antimeridian", () => {
    // Longitude degrees shrink towards the poles and wrap at 180. Both are
    // places a planar candidate-disk calculation can quietly under-reach.
    expectAgreesWithH3(rect(78.2, 15.6, 10, 10));
    expectAgreesWithH3(rect(-16.9, 179.995, 10, 10));
  });

  it("still matches h3 for rings that SHARE candidate cells", () => {
    // Why this test matters: cell boundaries are memoised across calls, because
    // the obstacle sweep asks for the same cell up to 11x more often than it has
    // distinct cells — neighbouring barrier quads and adjacent buildings share
    // candidates. So the second ring here is served largely from cache, and this
    // is the case where a memo that handed back a mutated or mis-keyed array
    // would produce a wrong cover while every isolated test stayed green.
    //
    // Overlapping and offset, so the two candidate disks intersect without
    // coinciding: some cells are cache hits, some are fresh.
    const first = rect(51.5, -0.12, 12, 12);
    const second = rect(51.50005, -0.11994, 12, 12);
    expectAgreesWithH3(first);
    expectAgreesWithH3(second);
    // And the first again, now entirely from cache.
    expectAgreesWithH3(first);
  });

  it("returns a stable answer when the same ring is covered repeatedly", () => {
    // The memo must be transparent: repetition is exactly what it optimises, so
    // repetition is exactly where it would show if it were not.
    const ring = rect(48.85, 2.29, 9, 14);
    const first = overlappingCells(ring, AFFORDANCE_RES);
    expect(first).toBeDefined();
    for (let i = 0; i < 5; i++) {
      expect(overlappingCells(ring, AFFORDANCE_RES)).toEqual(first);
    }
  });

  it("matches h3 for slivers, where a bounding-box reject is most tempting", () => {
    // Why this test matters: a candidate cell whose bounding box is disjoint
    // from the ring's is rejected before the exact predicate runs, which is what
    // makes a MISS cheap — and misses are almost all of the work, since a
    // rejection costs ~37x what an overlap does (see spatial-query.bench.ts).
    //
    // That reject is only sound if it is CONSERVATIVE. Touching must not count
    // as disjoint, because `segmentsIntersect` counts a shared edge as an
    // overlap, so a cell grazing the ring's bounding box is a cell h3 keeps. A
    // sliver has a near-degenerate bounding box and therefore the highest
    // possible proportion of grazing candidates, which is exactly where an
    // off-by-one in the comparison would silently drop cells.
    expectAgreesWithH3(rect(51.5, -0.12, 0.5, 40));
    expectAgreesWithH3(rect(51.5, -0.12, 40, 0.5));
    expectAgreesWithH3(rect(-33.86, 151.21, 0.2, 25));
  });

  it("agrees with h3 for arbitrary small rings (property)", () => {
    // The generated case the examples cannot reach: skewed, thin, and
    // degenerate-ish quads at arbitrary places on the planet.
    //
    // FIFTY RUNS, NOT TWO HUNDRED, and the number is a gate constraint rather
    // than a statement about how much evidence this property needs. Each run
    // costs an h3 call at ~0.5 ms, so 200 is ~200 ms in isolation and **over the
    // 5 s per-test timeout inside the full package run**, where this file
    // competes with a hundred others — it duly failed that way before being cut.
    // That is the same trap `poi-models.test.ts` was fixed for on the same day.
    //
    // The evidence is not lost, only moved: equivalence was established offline
    // over 40 000 generated rings and every one of the 3 397 rings the obstacle
    // sweep covers, with zero differences (see `cell-overlap.ts.md`). What stays
    // here is a REGRESSION guard, and fifty randomised rings is ample for that.
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: 0.2, max: 40, noNaN: true }),
        fc.double({ min: 0.2, max: 40, noNaN: true }),
        (lat, lng, wM, hM) => {
          const ring = rect(lat, lng, wM, hM);
          const ours = overlappingCells(ring, AFFORDANCE_RES);
          if (ours === undefined) return; // declining is always allowed
          const theirs = h3Cover(ring, AFFORDANCE_RES);
          expect(new Set(ours)).toEqual(theirs);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("overlappingCells — when it declines", () => {
  it("declines a ring that cannot bound an area", () => {
    expect(overlappingCells([], AFFORDANCE_RES)).toBeUndefined();
    expect(
      overlappingCells(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        AFFORDANCE_RES,
      ),
    ).toBeUndefined();
  });

  it("declines a ring with a non-finite coordinate", () => {
    // Real Overpass output contains these, and a NaN would otherwise propagate
    // into the candidate disk and produce an empty cover that looks legitimate.
    expect(
      overlappingCells(
        [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 1 },
          { x: 1, y: 1 },
        ],
        AFFORDANCE_RES,
      ),
    ).toBeUndefined();
  });

  it("declines a ring too large to be worth covering by hand", () => {
    // The whole point is to be cheaper than h3. Past a few hundred candidate
    // cells it is not, so it steps aside rather than winning the correctness
    // argument and losing the performance one.
    expect(
      overlappingCells(rect(51.5, -0.12, 5000, 5000), AFFORDANCE_RES),
    ).toBeUndefined();
  });
});
