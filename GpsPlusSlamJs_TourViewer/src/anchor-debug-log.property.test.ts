import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nearestRankPercentile } from "gps-plus-slam-app-framework/utils/percentile";
import {
  createAnchorDebugLog,
  PASS_P95_LIMIT_MS,
  summarizeSamples,
} from "./anchor-debug-log.js";

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true });

describe("summarizeSamples (properties)", () => {
  // Why: the field test's p95 must be the framework's nearest rank, never
  // a second rounding rule; the order p50 <= p95 <= max and a mean inside
  // the range hold for any input, and non-finite values change nothing.
  it("matches nearest rank, keeps the order, and ignores non-finite values", () => {
    fc.assert(
      fc.property(
        fc.array(finite, { minLength: 1, maxLength: 200 }),
        fc.array(fc.constantFrom(NaN, Infinity, -Infinity), { maxLength: 5 }),
        (values, junk) => {
          const s = summarizeSamples([...junk, ...values])!;
          expect(s.count).toBe(values.length);
          expect(s.p50).toBe(nearestRankPercentile(values, 0.5));
          expect(s.p95).toBe(nearestRankPercentile(values, 0.95));
          expect(s.max).toBe(Math.max(...values));
          expect(s.p50).toBeLessThanOrEqual(s.p95);
          expect(s.p95).toBeLessThanOrEqual(s.max);
          const min = Math.min(...values);
          expect(s.mean).toBeGreaterThanOrEqual(min - 1e-6);
          expect(s.mean).toBeLessThanOrEqual(s.max + 1e-6);
        },
      ),
    );
  });
});

describe("createAnchorDebugLog (properties)", () => {
  // Why: however long the walk, the summaries cover exactly the newest
  // `passes` passes (a bounded ring), and every pass is counted as seen.
  it("summarizes exactly the newest passes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16 }),
        fc.array(fc.double({ min: 0, max: 50, noNaN: true }), {
          minLength: 1,
          maxLength: 60,
        }),
        (cap, passes) => {
          const log = createAnchorDebugLog({ passes: cap });
          for (const passMs of passes) {
            log.pass({
              passMs,
              dt: 1 / 60,
              deferring: true,
              commits: [],
              counts: {
                sphereTests: 0,
                traversals: 0,
                windowOpen: false,
                followUpdates: 0,
              },
            });
          }
          const kept = passes.slice(-cap);
          const text = log.text();
          expect(text).toContain(
            `passes ${String(passes.length)} seen, last ${String(kept.length)} summarized`,
          );
          expect(text).toContain(
            `max ${Math.max(...kept).toFixed(3)} (n ${String(kept.length)})`,
          );
        },
      ),
    );
  });
});

describe("the pass verdict (properties)", () => {
  // Why: the printed PASS or FAIL must be exactly the nearest-rank p95 of
  // the deferral-on passes against the limit, whatever deferral-off passes
  // an A/B session mixes in.
  it("is PASS exactly when the deferral-on p95 is within the limit", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            passMs: fc.double({ min: 0, max: 2, noNaN: true }),
            deferring: fc.boolean(),
          }),
          { minLength: 1, maxLength: 80 },
        ),
        (passes) => {
          const log = createAnchorDebugLog();
          for (const p of passes) {
            log.pass({
              passMs: p.passMs,
              dt: 1 / 60,
              deferring: p.deferring,
              counts: {
                sphereTests: 0,
                traversals: 0,
                windowOpen: false,
                followUpdates: 0,
              },
              commits: [],
            });
          }
          const onMs = passes.filter((p) => p.deferring).map((p) => p.passMs);
          const word =
            onMs.length === 0
              ? "not measured"
              : nearestRankPercentile(onMs, 0.95) <= PASS_P95_LIMIT_MS
                ? "PASS"
                : "FAIL";
          const line = log
            .text()
            .split(/\n/)
            .find((l) => l.startsWith("pass p95"));
          expect(line).toMatch(new RegExp(`(: ${word}$)|(^pass p95: ${word})`));
        },
      ),
    );
  });
});
