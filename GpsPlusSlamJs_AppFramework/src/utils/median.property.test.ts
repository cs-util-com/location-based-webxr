/**
 * `weightedMedian` — the invariants examples cannot cover.
 *
 * Why this file matters (PR #391 review): `weightedMedian` is new to this
 * package and already has two consumers that turn its output into real-world
 * coordinates — `qr-anchor-mint.combinePlacements` (the x/y/z of a minted
 * anchor) and `elevation-offset-estimator.tickAggregate`. `median.test.ts`
 * covers it well by example, but three properties it depends on are the kind a
 * refactor breaks silently and a fixed example set does not notice.
 *
 * The second one below is the load-bearing one. `combinePlacements` computes
 * the UNWEIGHTED comparison by calling `weightedMedian` with flat weights, and
 * the session summary reports the distance between that and the weighted
 * answer as "recency weighting moved the anchor N m". If flat-weight
 * behaviour ever drifted from `lowerMedian`, that readout would report a
 * difference the weighting did not cause — and the number looks equally
 * plausible either way, so nothing downstream could catch it.
 *
 * @see median.ts.md
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lowerMedian, weightedMedian } from './median.js';

/** Finite doubles only — the degenerate inputs have their own example tests. */
const finiteValue = fc.double({
  noNaN: true,
  noDefaultInfinity: true,
  min: -1e6,
  max: 1e6,
});

/** Strictly positive finite weights — zero and negative are dropped by design. */
const positiveWeight = fc.double({
  noNaN: true,
  noDefaultInfinity: true,
  min: 1e-6,
  max: 1e6,
});

const pairs = fc.array(
  fc.record({ value: finiteValue, weight: positiveWeight }),
  { minLength: 1, maxLength: 40 }
);

describe('weightedMedian invariants', () => {
  it('returns one of the input values, never a fabricated one', () => {
    // The whole reason `combinePlacements` uses this rather than
    // `interpolatingMedian`: a minted anchor must sit at an OBSERVED pose, not
    // at an average of two that were never seen. An implementation that
    // interpolated on an even split would satisfy every example test that
    // happens to use odd-length input.
    fc.assert(
      fc.property(pairs, (ps) => {
        const values = ps.map((p) => p.value);
        const result = weightedMedian(
          values,
          ps.map((p) => p.weight)
        );
        expect(values).toContain(result);
      }),
      { numRuns: 300 }
    );
  });

  it('agrees with lowerMedian when every weight is equal', () => {
    // THE LOAD-BEARING ONE. `combinePlacements` builds its unweighted
    // comparison this way, and the summary screen subtracts the two to say how
    // far the recency weighting moved the anchor. Drift here does not break a
    // test - it makes a plausible-looking number wrong.
    fc.assert(
      fc.property(
        fc.array(finiteValue, { minLength: 1, maxLength: 40 }),
        fc.double({
          noNaN: true,
          noDefaultInfinity: true,
          min: 1e-6,
          max: 1e3,
        }),
        (values, weight) => {
          const flat = values.map(() => weight);
          expect(weightedMedian(values, flat)).toBe(lowerMedian(values));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('does not depend on the order the pairs arrive in', () => {
    // Worth pinning specifically because `MintQrAnchorInput.sightings` carries
    // a documented ascending-timestamp ordering contract, so the pairs reach
    // this function in a caller-chosen order. A median must not care, and an
    // implementation that broke ties by position rather than by value would
    // pass every example test whose input is already sorted.
    fc.assert(
      fc.property(pairs, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (ps, k) => {
        // A deterministic rotation is enough to reorder without needing a
        // shuffle arbitrary, and it keeps each value with its own weight.
        const shift = ps.length === 0 ? 0 : k % ps.length;
        const rotated = [...ps.slice(shift), ...ps.slice(0, shift)];
        expect(
          weightedMedian(
            rotated.map((p) => p.value),
            rotated.map((p) => p.weight)
          )
        ).toBe(
          weightedMedian(
            ps.map((p) => p.value),
            ps.map((p) => p.weight)
          )
        );
      }),
      { numRuns: 300 }
    );
  });

  it('puts at least half the weight at or below the result', () => {
    // The definition itself, stated as a property rather than trusted from the
    // loop. It is what makes the result a median at all, and it is the one
    // invariant that would survive a subtly wrong comparison in the scan.
    fc.assert(
      fc.property(pairs, (ps) => {
        const result = weightedMedian(
          ps.map((p) => p.value),
          ps.map((p) => p.weight)
        );
        const total = ps.reduce((sum, p) => sum + p.weight, 0);
        const atOrBelow = ps
          .filter((p) => p.value <= result)
          .reduce((sum, p) => sum + p.weight, 0);
        // Floating-point summation of up to 40 terms: compare with a relative
        // slack rather than exactly, or the property fails on arithmetic
        // rather than on behaviour.
        expect(atOrBelow).toBeGreaterThanOrEqual(total / 2 - total * 1e-9);
      }),
      { numRuns: 300 }
    );
  });
});
