/**
 * buildSessionSummary property tests
 *
 * Why these tests matter:
 * The distance integration and rawGpsPath mapping are simple folds, and folds
 * are exactly where off-by-one/aliasing bugs hide. These properties pin the
 * invariants that no example-based case can exhaust:
 *   - distance is non-negative and translation-invariant (it must depend only
 *     on segment deltas, never on absolute NUE coordinates),
 *   - distance is additive under path concatenation (splitting a recording's
 *     odometry anywhere must not change the total),
 *   - rawGpsPath preserves sample count and order.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { buildSessionSummary } from './build-session-summary';
import type { SessionSummaryInputs } from './build-session-summary';

function baseInputs(
  overrides: Partial<SessionSummaryInputs> = {}
): SessionSummaryInputs {
  return {
    endTime: 2_000,
    startTime: 1_000,
    imageCount: 0,
    depthSampleCount: 0,
    errors: [],
    qrAnchors: [],
    failedWriteCount: 0,
    gpsPositions: [],
    odometryPositions: [],
    alignmentMatrix: null,
    alignmentSnapshotNuePositions: [],
    refPoints: [],
    syncResult: null,
    zipFilename: undefined,
    ...overrides,
  };
}

/** Bounded finite coordinate — keeps float error far below the assertions' epsilon. */
const coordArb = fc.double({ min: -1000, max: 1000, noNaN: true });

const vector3Arb: fc.Arbitrary<Vector3> = fc.tuple(
  coordArb,
  coordArb,
  coordArb
);

const pathArb = fc.array(vector3Arb, { maxLength: 30 });

function distanceOf(odometryPositions: readonly Vector3[]): number {
  return buildSessionSummary(baseInputs({ odometryPositions }))
    .totalDistanceMeters;
}

describe('buildSessionSummary — distance integration properties', () => {
  it('is non-negative for any path', () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        expect(distanceOf(path)).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('is exactly zero for paths with fewer than 2 points (no segments)', () => {
    fc.assert(
      fc.property(fc.array(vector3Arb, { maxLength: 1 }), (path) => {
        expect(distanceOf(path)).toBe(0);
      })
    );
  });

  it('is translation-invariant (depends only on segment deltas)', () => {
    fc.assert(
      fc.property(pathArb, vector3Arb, (path, offset) => {
        const shifted = path.map(
          (p): Vector3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]
        );
        expect(distanceOf(shifted)).toBeCloseTo(distanceOf(path), 6);
      })
    );
  });

  it('is additive when a path is split at any index (joined at the split point)', () => {
    fc.assert(
      fc.property(
        fc.array(vector3Arb, { minLength: 2, maxLength: 30 }),
        fc.nat(),
        (path, seed) => {
          // Split so both halves share the split point — re-concatenating the
          // halves reproduces the original segment sequence exactly.
          const splitAt = 1 + (seed % (path.length - 1));
          const head = path.slice(0, splitAt + 1);
          const tail = path.slice(splitAt);
          expect(distanceOf(head) + distanceOf(tail)).toBeCloseTo(
            distanceOf(path),
            6
          );
        }
      )
    );
  });
});

describe('buildSessionSummary — rawGpsPath properties', () => {
  it('preserves sample count and lat/lng order', () => {
    const gpsPointArb = fc.record({
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      longitude: fc.double({ min: -180, max: 180, noNaN: true }),
      latLongAccuracy: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
        nil: undefined,
      }),
      zeroRef: fc.constant({ lat: 0, lon: 0 }),
    });
    fc.assert(
      fc.property(fc.array(gpsPointArb, { maxLength: 20 }), (gpsPositions) => {
        const summary = buildSessionSummary(baseInputs({ gpsPositions }));
        expect(summary.rawGpsPath).toHaveLength(gpsPositions.length);
        summary.rawGpsPath!.forEach((sample, i) => {
          expect(sample.lat).toBe(gpsPositions[i]!.latitude);
          expect(sample.lng).toBe(gpsPositions[i]!.longitude);
        });
      })
    );
  });
});
