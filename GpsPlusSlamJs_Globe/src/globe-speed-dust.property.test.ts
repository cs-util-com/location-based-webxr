/**
 * Property tests for the speed dust (round-3 plan 2026-10-08-2345 D1).
 * Why this file matters: its promises hold for ANY walk of the camera
 * (stops, reversals, jumps) and any frame rate, which fixed cases cannot
 * cover: the field never clumps, a steady motion reads the same speed at
 * any rate, and the drift over a second is the same at any rate up to the
 * per-frame cap.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_SPEED_DUST,
  advanceField,
  createSpeedField,
  startVelocity,
  stepVelocity,
  streaks,
} from "./globe-speed-dust.js";

const unit = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3)
  .map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as [number, number, number];
  });

describe("the speed dust's properties", () => {
  it("keeps every head in the box at its seed minus the offset, for any walk", () => {
    const seeds = createSpeedField(64, 5);
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            unit,
            fc.double({ min: -10, max: 10, noNaN: true }),
            fc.double({ min: 0, max: 0.5, noNaN: true }),
          ),
          { maxLength: 40 },
        ),
        (walk) => {
          let offset: [number, number, number] = [0, 0, 0];
          for (const [dir, rate, dt] of walk)
            offset = advanceField(offset, dir, rate, dt);
          const out = streaks(seeds, offset, [1, 0, 0], 0, 0.033, 1);
          for (let j = 0; j < out.heads.length; j++) {
            const h = out.heads[j] ?? 0;
            expect(h).toBeGreaterThanOrEqual(-1);
            expect(h).toBeLessThan(1);
            const e = (seeds[j] ?? 0) - offset[j % 3]!;
            expect(h).toBeCloseTo(e - 2 * Math.floor((e + 1) / 2), 6);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reads a steady motion the same at any frame rate", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 120 }),
        fc.double({ min: 1, max: 1e7, noNaN: true }),
        (hz, mps) => {
          let state = startVelocity();
          for (let i = 0; i <= hz; i++) {
            const t = (i * 1000) / hz;
            state = stepVelocity(state, [7e6 + (mps * t) / 1000, 0, 0], t, 1e9);
          }
          const expected = mps * (1 - Math.exp(-1000 / GLOBE_SPEED_DUST.tauMs));
          expect(state.velocity[0] / expected).toBeCloseTo(1, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("drifts the same over a second at any frame rate, up to the per-frame cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 120 }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (hz, rate) => {
          // The cap is 0.6 box a frame: at 5 Hz the drift holds up to 3 box/s.
          let offset: [number, number, number] = [0, 0, 0];
          let unwrapped = 0;
          for (let i = 0; i < hz; i++) {
            const next = advanceField(offset, [0, 0, 1], rate, 1 / hz);
            let d = next[2] - offset[2];
            if (d < -1) d += 2;
            unwrapped += d;
            offset = next;
          }
          expect(unwrapped).toBeCloseTo(rate, 6);
        },
      ),
      { numRuns: 200 },
    );
  });
});
