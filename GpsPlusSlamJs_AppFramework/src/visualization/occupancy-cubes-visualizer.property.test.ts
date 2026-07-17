/**
 * Property tests for `pickNearestSubset` — the viewer-local over-cap cube
 * selector (Issue B1 of the 2026-06-22 cube cadence/locality plan).
 *
 * Why this test file matters:
 * The whole point of B1 is "draw the cells around the user, not a random
 * scatter." A single example test cannot prove the ranking is correct for
 * arbitrary cell clouds and eye positions. These properties pin the contract
 * across the full space of inputs the way examples cannot:
 *  - result size is exactly min(count, n) — never over the cap, never short;
 *  - the partition is correct: EVERY kept cell is at least as near as EVERY
 *    dropped cell (the defining property of nearest-N);
 *  - the carried position matches what `positionOf` returns for that cell, so
 *    the draw loop never re-fetches or mismatches;
 *  - selection is deterministic for a fixed eye (no RNG).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { pickNearestSubset } from './occupancy-cubes-visualizer';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const arbVec3: fc.Arbitrary<readonly [number, number, number]> = fc.tuple(
  finite(-50, 50),
  finite(-50, 50),
  finite(-50, 50)
);

/** A flat list of 3D points used as the "cells". */
const arbPoints = fc.array(arbVec3, { minLength: 0, maxLength: 40 });

const d2 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

describe('pickNearestSubset', () => {
  it('returns exactly min(count, n) items', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const result = pickNearestSubset(points, count, eye, (p) => p);
          expect(result).toHaveLength(Math.min(count, points.length));
        }
      )
    );
  });

  it('keeps the nearest cells: every kept cell ≤ every dropped cell by distance', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const kept = pickNearestSubset(points, count, eye, (p) => p);
          const keptSet = new Set(kept.map((k) => k.item));
          const dropped = points.filter((p) => !keptSet.has(p));

          const maxKept = Math.max(0, ...kept.map((k) => d2(k.item, eye)));
          for (const drop of dropped) {
            // Every dropped cell must be at least as far as the farthest kept
            // one (the defining nearest-N partition). `>=` not `>` because
            // equidistant ties may land on either side.
            expect(d2(drop, eye)).toBeGreaterThanOrEqual(maxKept);
          }
        }
      )
    );
  });

  it('carries each cell its own position from positionOf', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          // Offset position so a mismatch (carrying the wrong cell's pos) is
          // detectable, while keeping the ranking well-defined.
          const positionOf = (
            p: readonly [number, number, number]
          ): readonly [number, number, number] => [p[0] + 100, p[1], p[2]];
          const result = pickNearestSubset(points, count, eye, positionOf);
          for (const { item, pos } of result) {
            expect(pos).toEqual(positionOf(item));
          }
        }
      )
    );
  });

  it('is deterministic for a fixed eye (no RNG)', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const a = pickNearestSubset(points, count, eye, (p) => p);
          const b = pickNearestSubset(points, count, eye, (p) => p);
          expect(a.map((x) => x.item)).toEqual(b.map((x) => x.item));
        }
      )
    );
  });

  it('treats a negative or zero count as an empty selection', () => {
    const points: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, 0],
      [2, 0, 0],
    ];
    expect(pickNearestSubset(points, 0, [0, 0, 0], (p) => p)).toHaveLength(0);
    expect(pickNearestSubset(points, -5, [0, 0, 0], (p) => p)).toHaveLength(0);
  });

  // --- Radius pre-filter (Step 1.1 of the 2026-07-03 long-session fps plan) ---
  // Why these properties matter: on a long walk the over-cap sort runs over
  // every minConfidence-passing cell ever seen (~40k after 5 min in the
  // 2026-07-02 corpus). The radius pre-filter bounds the scored/sorted set to
  // the viewer's neighbourhood — but it must be BEHAVIOUR-PRESERVING whenever
  // the cap'th-nearest cell lies within the radius, or the cubes would change
  // appearance for no reason.

  describe('maxRadius pre-filter', () => {
    const arbRadius = finite(0.5, 120);

    it('is behaviour-preserving when the count-th nearest cell lies within the radius', () => {
      fc.assert(
        fc.property(
          arbPoints,
          fc.integer({ min: 1, max: 60 }),
          arbVec3,
          arbRadius,
          (points, count, eye, radius) => {
            const unfiltered = pickNearestSubset(points, count, eye, (p) => p);
            const last = unfiltered[unfiltered.length - 1];
            // Precondition of the property: the selection already fits in R.
            fc.pre(last === undefined || d2(last.pos, eye) <= radius * radius);
            const filtered = pickNearestSubset(
              points,
              count,
              eye,
              (p) => p,
              radius
            );
            expect(filtered).toEqual(unfiltered);
          }
        )
      );
    });

    it('never returns a cell beyond the radius', () => {
      fc.assert(
        fc.property(
          arbPoints,
          fc.integer({ min: 0, max: 60 }),
          arbVec3,
          arbRadius,
          (points, count, eye, radius) => {
            const result = pickNearestSubset(
              points,
              count,
              eye,
              (p) => p,
              radius
            );
            for (const { pos } of result) {
              expect(d2(pos, eye)).toBeLessThanOrEqual(radius * radius);
            }
          }
        )
      );
    });

    it('returns exactly the within-radius cells when fewer than count survive (distant cells vanish by design)', () => {
      fc.assert(
        fc.property(arbPoints, arbVec3, arbRadius, (points, eye, radius) => {
          const within = points.filter((p) => d2(p, eye) <= radius * radius);
          // count larger than the whole input: the only bound left is R.
          const result = pickNearestSubset(
            points,
            points.length + 10,
            eye,
            (p) => p,
            radius
          );
          expect(result).toHaveLength(within.length);
        })
      );
    });

    it('an omitted or non-finite radius means unbounded (legacy behaviour)', () => {
      fc.assert(
        fc.property(
          arbPoints,
          fc.integer({ min: 0, max: 60 }),
          arbVec3,
          (points, count, eye) => {
            const legacy = pickNearestSubset(points, count, eye, (p) => p);
            expect(
              pickNearestSubset(points, count, eye, (p) => p, Infinity)
            ).toEqual(legacy);
          }
        )
      );
    });
  });
});
