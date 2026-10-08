import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createWalkedDistanceTracker } from "./walked-distance-tracker.js";

const sampleArb = fc.record({
  n: fc.double({ min: -500, max: 500, noNaN: true }),
  e: fc.double({ min: -500, max: 500, noNaN: true }),
  synthetic: fc.boolean(),
});

type Sample = { n: number; e: number; synthetic: boolean };

/** The definition, from scratch: consecutive device fixes, horizontal. */
function bruteWalked(samples: readonly Sample[]): number {
  const device = samples.filter((s) => !s.synthetic);
  let total = 0;
  for (let i = 1; i < device.length; i += 1) {
    total += Math.hypot(
      device[i]!.n - device[i - 1]!.n,
      device[i]!.e - device[i - 1]!.e,
    );
  }
  return total;
}

describe("createWalkedDistanceTracker (property)", () => {
  // Why this test matters: the incremental fold is what keeps a long visit
  // from re-walking its whole history on every store change, and it must
  // never differ from the definition, whatever prefixes it is shown.
  it("equals the from-scratch path length after every growing prefix", () => {
    fc.assert(
      fc.property(
        fc.array(sampleArb, { maxLength: 40 }),
        fc.array(fc.nat({ max: 5 }), { maxLength: 10 }),
        (samples, steps) => {
          const fixes = samples.map((s) => ({
            latitude: 48.1,
            longitude: 11.5,
            latLongAccuracy: 5,
            timestamp: 1_000,
            ...(s.synthetic ? { source: "synthetic-qr" } : {}),
          }));
          const odom = samples.map((s) => [s.n, 1.4, s.e]);
          const tracker = createWalkedDistanceTracker();
          let end = 0;
          for (const step of [...steps, samples.length]) {
            end = Math.min(samples.length, end + step);
            const got = tracker.update({
              gpsPositions: fixes.slice(0, end),
              odometryPositions: odom.slice(0, end),
            });
            const want = bruteWalked(samples.slice(0, end));
            expect(got).toBeCloseTo(want, 6);
          }
        },
      ),
    );
  });
});
