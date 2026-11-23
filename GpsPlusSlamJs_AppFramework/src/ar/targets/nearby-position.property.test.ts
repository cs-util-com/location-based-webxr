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

const sample = fc.record({
  age: fc.integer({ min: -5_000, max: 3 * H }),
  vote: fc.boolean(),
  acc: fc.oneof(
    fc.double({ min: 0.5, max: 40, noNaN: true }),
    fc.constant(Number.NaN)
  ),
  n: fc.double({ min: -100, max: 100, noNaN: true }),
});

describe('createNearbyPositionSource properties', () => {
  // Why this test matters: the kernel's scan and the binary search both
  // assume sorted series inside the window; whatever order the store holds,
  // the source hands over exactly the device fixes and AR samples within H,
  // sorted, and newestFixAtMs is the newest device time of the whole series.
  it('hands over the windowed samples, sorted, for any arrival order', () => {
    fc.assert(
      fc.property(fc.array(sample, { maxLength: 40 }), (rows) => {
        const gpsPositions: NearbyGpsPoint[] = rows.map((r) => ({
          latitude: 47,
          longitude: 8,
          latLongAccuracy: r.acc,
          timestamp: NOW - r.age,
          ...(r.vote ? { source: 'synthetic-qr' } : {}),
        }));
        const odometryPositions = rows.map((r) => [r.n, 0, 0]);
        const p = createNearbyPositionSource({
          gpsEvents: () => ({ gpsPositions, odometryPositions }),
          alignment: () => ALIGN,
          zero: () => ({ lat: 47, lon: 8 }),
          live: () => null,
          lookBackMs: H,
        }).position(NOW);

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
});
