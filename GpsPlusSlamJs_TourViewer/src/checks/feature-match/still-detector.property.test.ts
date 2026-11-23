import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  isStill,
  STILL_CONFIG,
  stillFor,
  stillProgress,
  stillStart,
  stillStep,
  type MotionSample,
} from "./still-detector";

/** Any number a sensor or a broken browser could hand over. */
const anyNumber = fc.oneof(
  fc.double(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, 1e308, -1e308, 0),
);
const rate = fc.oneof(
  fc.constant(null),
  fc.record({
    alpha: fc.option(anyNumber),
    beta: fc.option(anyNumber),
    gamma: fc.option(anyNumber),
  }),
);
/** Mostly forward times with some bad ones mixed in. */
const samples = fc.array(
  fc.record({ dt: fc.oneof(fc.double({ min: 0, max: 800 }), anyNumber), rate }),
  { maxLength: 200 },
);

const feed = (steps: readonly { dt: number; rate: MotionSample["rate"] }[]) => {
  let t = 0;
  return steps.map((s) => {
    t = Number.isFinite(s.dt) ? t + Math.abs(s.dt) : s.dt;
    const out: MotionSample = { t, rate: s.rate };
    if (!Number.isFinite(t)) {
      t = 0;
    }
    return out;
  });
};

describe("still-detector properties", () => {
  // Why: one NaN or overflow must never latch the detector, whatever the
  // sensor sends: the level, the times and the progress stay finite.
  it("keeps the state finite for any readings", () => {
    fc.assert(
      fc.property(samples, fc.boolean(), (steps, needMove) => {
        let st = stillStart(0, needMove);
        for (const s of feed(steps)) {
          st = stillStep(st, s);
          expect(Number.isFinite(st.level)).toBe(true);
          expect(st.level).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(st.lastT)).toBe(true);
          expect(Number.isFinite(stillFor(st))).toBe(true);
          expect(stillFor(st)).toBeGreaterThanOrEqual(0);
          const p = stillProgress(st);
          expect(p >= 0 && p <= 1).toBe(true);
        }
      }),
    );
  });

  // Why: "still" may only follow the move a pair needs, and a reading
  // above the threshold always ends it.
  it("is still only after the move, and never right after a fast reading", () => {
    fc.assert(
      fc.property(samples, fc.boolean(), (steps, needMove) => {
        let st = stillStart(0, needMove);
        for (const s of feed(steps)) {
          st = stillStep(st, s);
          expect(!isStill(st) || st.moved).toBe(true);
        }
        const fast = stillStep(st, {
          t: st.lastT + 10,
          rate: { alpha: 10_000, beta: 0, gamma: 0 },
        });
        expect(isStill(fast)).toBe(false);
        expect(fast.level).toBeGreaterThan(STILL_CONFIG.threshold);
      }),
    );
  });
});
