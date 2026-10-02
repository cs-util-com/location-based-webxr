import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { fitGaussMarkov, type ResidualSample } from "./gps-noise-fit.js";

/** An irregular residual series: increasing times, bounded values. */
const seriesArb = fc
  .array(
    fc.record({
      dtS: fc.double({ min: 0.6, max: 5, noNaN: true }),
      n: fc.double({ min: -50, max: 50, noNaN: true }),
      e: fc.double({ min: -50, max: 50, noNaN: true }),
    }),
    { minLength: 5, maxLength: 60 },
  )
  .map((steps) => {
    let t = 1_700_000_000_000;
    return steps.map((s): ResidualSample => {
      t += s.dtS * 1000;
      return { tMs: t, n: s.n, e: s.e };
    });
  });

/** Largest difference of two rho arrays; Infinity when one has a value
 *  (or an empty bin) where the other has not. */
function rhoDiff(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    ...a.map((r, k) => {
      const q = b[k]!;
      if (Number.isNaN(r) || Number.isNaN(q))
        return Number.isNaN(r) && Number.isNaN(q)
          ? 0
          : Number.POSITIVE_INFINITY;
      return Math.abs(r - q);
    }),
  );
}

describe("fitGaussMarkov properties", () => {
  // Why this test matters: north and east are pooled as one per-axis
  // process, so the fit must not depend on how the axes are oriented - a
  // walk heading north-east would otherwise read a different noise model
  // than the same walk heading north.
  it("is invariant under a rotation of the residuals", () => {
    fc.assert(
      fc.property(
        seriesArb,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (series, angle) => {
          const c = Math.cos(angle);
          const s = Math.sin(angle);
          const turned = series.map((r) => ({
            tMs: r.tMs,
            n: c * r.n - s * r.e,
            e: s * r.n + c * r.e,
          }));
          // Bounded random residuals are never all zero: both fits exist.
          const a = fitGaussMarkov([series], { maxLagS: 30 })!;
          const b = fitGaussMarkov([turned], { maxLagS: 30 })!;
          expect(b.sigmaM).toBeCloseTo(a.sigmaM, 6);
          expect(rhoDiff(a.rho, b.rho)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 40 },
    );
  });

  // Why this test matters: sigma is in metres and tau in seconds; scaling
  // the error must scale sigma alone, and shifting the clock must change
  // nothing (fix times are epoch milliseconds of any session).
  it("scales sigma with the error and ignores a clock shift", () => {
    fc.assert(
      fc.property(
        seriesArb,
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (series, k, shiftMs) => {
          const scaled = series.map((r) => ({
            tMs: r.tMs + shiftMs,
            n: k * r.n,
            e: k * r.e,
          }));
          const a = fitGaussMarkov([series], { maxLagS: 30 })!;
          const b = fitGaussMarkov([scaled], { maxLagS: 30 })!;
          expect(b.sigmaM / a.sigmaM).toBeCloseTo(k, 6);
          expect(rhoDiff(a.rho, b.rho)).toBeLessThan(1e-6);
          expect(b.tauS ?? -1).toBeCloseTo(a.tauS ?? -1, 4);
        },
      ),
      { numRuns: 40 },
    );
  });

  // Why this test matters: rho is a correlation; outside [-1, 1] (beyond
  // rounding) it would mean the pair sums and the variance disagree.
  it("keeps the zero-lag rho at 1 and every rho finite or NaN", () => {
    fc.assert(
      fc.property(seriesArb, (series) => {
        const fit = fitGaussMarkov([series], { maxLagS: 20 })!;
        expect(fit.rho[0]).toBeCloseTo(1, 9);
        expect(
          fit.rho.every((r) => Number.isNaN(r) || Number.isFinite(r)),
        ).toBe(true);
        expect(fit.sigmaM).toBeGreaterThan(0);
      }),
      { numRuns: 40 },
    );
  });
});
