import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  cameraVerdict,
  DEFAULT_PLAN,
  gapStats,
  REASON_MAX,
  shortReason,
  spikePlanFrom,
  spikeProgress,
  type SpikeStep,
} from "./worker-spike-model";

const anyNumber = fc.oneof(
  fc.double(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -1),
);
const gaps = fc.array(fc.double({ min: 0, max: 2000, noNaN: true }), {
  minLength: 1,
  maxLength: 200,
});

describe("worker spike model properties", () => {
  // Why: whatever a broken clock hands over, the statistics stay ordered
  // and finite, so the verdict never reads NaN as a pass.
  it("gap statistics stay ordered for any input", () => {
    fc.assert(
      fc.property(fc.array(anyNumber, { maxLength: 200 }), (values) => {
        const s = gapStats(values);
        if (s.count === 0) {
          return;
        }
        expect(s.p95).toBeLessThanOrEqual(s.p99);
        expect(s.p99).toBeLessThanOrEqual(s.max);
        expect(Number.isFinite(s.max)).toBe(true);
      }),
    );
  });

  // Why: a run with every gap shorter than a smooth run's is smooth too;
  // otherwise the verdict would punish a better phone.
  it("the verdict is monotone in the gaps", () => {
    fc.assert(
      fc.property(
        gaps,
        gaps,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (run, base, k) => {
          const b = gapStats(base);
          const r = gapStats(run);
          const shorter = gapStats(run.map((g) => g * k));
          // smooth implies shorter-is-smooth
          expect(
            cameraVerdict(r, b) !== "smooth" ||
              cameraVerdict(shorter, b) === "smooth",
          ).toBe(true);
        },
      ),
    );
  });

  // Why: the bar and the step text must never leave their range, and the
  // bar never runs backwards as the run moves through its steps.
  it("progress stays in range and the bar only moves forward", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.double({ min: 0, max: 120_000, noNaN: true }), {
          maxLength: 12,
        }),
        fc.double({ min: -1000, max: 1e7, noNaN: true }),
        (pairs, pairMs, elapsed) => {
          const plan = { ...DEFAULT_PLAN, pairs };
          const steps: SpikeStep[] = [
            { kind: "baseline" },
            ...Array.from({ length: 2 * pairs + 1 }, (_, taken) => ({
              kind: "photos" as const,
              taken,
            })),
            ...Array.from({ length: pairs }, (_, done) => ({
              kind: "pairs" as const,
              done,
            })),
            { kind: "xfeat" },
          ];
          let last = -1;
          for (const step of steps) {
            const at = (e: number) =>
              spikeProgress({
                plan,
                step,
                stepStartedAt: 0,
                pairMs,
                live: "unknown",
                now: e,
              });
            const start = at(0);
            const p = at(elapsed);
            expect(p.fraction).toBeGreaterThanOrEqual(0);
            expect(p.fraction).toBeLessThanOrEqual(1);
            expect(p.step).toBeGreaterThanOrEqual(1);
            expect(p.step).toBeLessThanOrEqual(p.of);
            expect(p.leftMs).toBeGreaterThanOrEqual(0);
            expect(start.fraction).toBeGreaterThanOrEqual(last);
            last = start.fraction;
          }
        },
      ),
    );
  });

  // Why: a URL is user input; any value gives a plan in range.
  it("any URL gives a plan in range", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (b, n) => {
        const p = spikePlanFrom(
          `?baseline=${encodeURIComponent(b)}&pairs=${encodeURIComponent(n)}`,
        );
        expect(p.baselineMs).toBeGreaterThanOrEqual(1000);
        expect(p.baselineMs).toBeLessThanOrEqual(60_000);
        expect(p.pairs).toBeGreaterThanOrEqual(1);
        expect(p.pairs).toBeLessThanOrEqual(12);
      }),
    );
  });

  // Why: the card has room for a few words whatever the error says.
  it("a short reason is short and one line", () => {
    fc.assert(
      fc.property(fc.string(), (t) => {
        const r = shortReason(t);
        expect(r.length).toBeGreaterThan(0);
        expect(r.length).toBeLessThanOrEqual(REASON_MAX);
        expect(r).not.toContain("\n");
      }),
    );
  });
});
