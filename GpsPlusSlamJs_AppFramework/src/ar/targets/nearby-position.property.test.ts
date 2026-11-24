import '../../test-setup.js';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createNearbyPositionSource,
  type NearbyGpsPoint,
} from './nearby-position.js';

const NOW = 1_800_000_000_000;
const H = 60_000;
const ALIGN = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const finiteAcc = fc.double({ min: 0.5, max: 40, noNaN: true });

const sampleWith = (acc: fc.Arbitrary<number>) =>
  fc.record({
    age: fc.integer({ min: -5_000, max: 3 * H }),
    vote: fc.boolean(),
    acc,
    n: fc.double({ min: -100, max: 100, noNaN: true }),
  });

const sample = sampleWith(fc.oneof(finiteAcc, fc.constant(Number.NaN)));

type Row = typeof sample extends fc.Arbitrary<infer R> ? R : never;

function positionOf(rows: readonly Row[]) {
  const gpsPositions: NearbyGpsPoint[] = rows.map((r) => ({
    latitude: 47,
    longitude: 8,
    latLongAccuracy: r.acc,
    timestamp: NOW - r.age,
    ...(r.vote ? { source: 'synthetic-qr' } : {}),
  }));
  const odometryPositions = rows.map((r) => [r.n, 0, 0]);
  return createNearbyPositionSource({
    gpsEvents: () => ({ gpsPositions, odometryPositions }),
    alignment: () => ALIGN,
    zero: () => ({ lat: 47, lon: 8 }),
    live: () => null,
    lookBackMs: H,
  }).position(NOW);
}

describe('createNearbyPositionSource properties', () => {
  // Why this test matters: the kernel's scan and the binary search both
  // assume sorted series inside the window; whatever order the store holds,
  // the source hands over exactly the device fixes and AR samples within H,
  // sorted, and newestFixAtMs is the newest device time of the whole series.
  it('hands over the windowed samples, sorted, for any arrival order', () => {
    fc.assert(
      fc.property(fc.array(sample, { maxLength: 40 }), (rows) => {
        const p = positionOf(rows);

        const inWindow = rows.filter((r) => r.age <= H);
        expect(p.arPoses).toHaveLength(inWindow.length);
        for (const series of [p.arPoses, p.fixes]) {
          const times = series.map((s) => s.t);
          expect(times).toEqual([...times].sort((a, b) => a - b));
          expect(times.every((t) => t >= NOW - H)).toBe(true);
        }
        // A fix needs an accuracy: the first device sample (in time) with
        // none has no median yet; later ones inherit the rolling median.
        expect(p.fixes.length).toBeLessThanOrEqual(
          inWindow.filter((r) => !r.vote).length
        );
        const devices = rows.filter((r) => !r.vote);
        expect(p.newestFixAtMs).toBe(
          devices.length === 0
            ? null
            : NOW - Math.min(...devices.map((r) => r.age))
        );
      })
    );
  });

  // Why this test matters: the bound above (at most one fix per device
  // sample) would also hold for a source that dropped fixes. With every
  // accuracy finite each device sample has a median from the first one
  // on, so every device sample in the window must come out as a fix.
  it('hands over every windowed device fix when all accuracies are finite', () => {
    fc.assert(
      fc.property(
        fc.array(sampleWith(finiteAcc), { maxLength: 40 }),
        (rows) => {
          const p = positionOf(rows);
          expect(p.fixes).toHaveLength(
            rows.filter((r) => !r.vote && r.age <= H).length
          );
        }
      )
    );
  });
});
