import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { finitePositive, worse } from './finite-positive.js';

describe('finite-positive properties', () => {
  // Why this test matters: whatever arrives, the result is either the
  // value itself (finite and > 0) or null: never a coerced number.
  it('finitePositive returns the input unchanged or null', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const ok = typeof v === 'number' && Number.isFinite(v) && v > 0;
        expect(finitePositive(v)).toBe(ok ? v : null);
      })
    );
  });

  // Why this test matters: combining accuracies must not depend on the
  // order they are named in, and is never better than either.
  it('worse is symmetric and never below either input', () => {
    const acc = fc.option(fc.double({ min: 0.001, max: 1e6, noNaN: true }), {
      nil: null,
    });
    fc.assert(
      fc.property(acc, acc, (a, b) => {
        const r = worse(a, b);
        expect(r).toBe(worse(b, a));
        const inputs = [a, b].filter((x): x is number => x !== null);
        expect(r ?? -Infinity).toBeGreaterThanOrEqual(
          Math.max(-Infinity, ...inputs)
        );
        expect(r === null).toBe(inputs.length === 0);
      })
    );
  });
});
