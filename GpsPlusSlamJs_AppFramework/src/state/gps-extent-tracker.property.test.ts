import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createGpsExtentTracker,
  type GpsExtentPoint,
} from './gps-extent-tracker.js';

/** The definition, brute force: every pair of device fixes. */
function bruteExtent(points: readonly GpsExtentPoint[]): number {
  const device = points.filter(
    (p) =>
      (p.source === undefined || p.source === 'device') &&
      Number.isFinite(p.coordinates[0]) &&
      Number.isFinite(p.coordinates[2])
  );
  let worst = 0;
  for (const a of device)
    for (const b of device)
      worst = Math.max(
        worst,
        Math.hypot(
          a.coordinates[0] - b.coordinates[0],
          a.coordinates[2] - b.coordinates[2]
        )
      );
  return worst;
}

const pointArb = fc.record({
  n: fc.double({ min: -500, max: 500, noNaN: true }),
  e: fc.double({ min: -500, max: 500, noNaN: true }),
  synthetic: fc.boolean(),
});

describe('createGpsExtentTracker (property)', () => {
  // Why this test matters: the incremental fold is the only thing standing
  // between the frame loop and an O(n^2) pass per frame, and it must never
  // differ from the definition, whatever slices of the list it is shown.
  it('equals the brute-force extent after every growing prefix', () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 0, maxLength: 40 }),
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 8 }),
        (raw, cuts) => {
          const points: GpsExtentPoint[] = raw.map((p, i) => ({
            id: `p${String(i)}`,
            timestamp: i,
            coordinates: [p.n, 0, p.e],
            ...(p.synthetic ? { source: 'synthetic-qr' } : {}),
          }));
          const tracker = createGpsExtentTracker();
          const prefixLengths = [...cuts, points.length]
            .map((c) => Math.min(c, points.length))
            .sort((a, b) => a - b);
          for (const len of prefixLengths) {
            const prefix = points.slice(0, len);
            expect(tracker.update(prefix)).toBeCloseTo(bruteExtent(prefix), 9);
          }
        }
      )
    );
  });
});
