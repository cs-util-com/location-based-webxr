// Why this test matters: the CI skip is a guard that DISABLES another guard,
// which is the shape that rots quietly — a later refactor that reintroduces the
// enforcement on CI would fail no example test that happened to pick a duration
// under the ceiling. These properties pin the invariant across every stage and
// duration, not the handful of numbers in budget.test.mjs.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { budgetBreach } from './budget.mjs';

/** Any finite duration, including the absurd ones a hung stage would produce. */
const durationArb = fc.double({
  min: 0,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});
const budgetArb = fc.double({
  min: 1,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('budgetBreach properties', () => {
  it('never breaches on CI, for any stage, budget or duration', () => {
    fc.assert(
      fc.property(
        fc.string(),
        budgetArb,
        durationArb,
        fc.constantFrom('1', 'true', 'yes', 'github'),
        (name, budgetSeconds, durationMs, ciValue) => {
          expect(
            budgetBreach({ name, budgetSeconds }, durationMs, { CI: ciValue })
          ).toBeNull();
        }
      )
    );
  });

  it('off CI, breaches exactly when the duration exceeds the budget', () => {
    // The complement of the property above: the skip must cost nothing off CI,
    // where the timing history — and therefore the calibration — actually lives.
    fc.assert(
      fc.property(
        budgetArb,
        durationArb,
        fc.constantFrom(undefined, {}, { CI: '' }, { CI: undefined }),
        (budgetSeconds, durationMs, env) => {
          const breached =
            budgetBreach({ name: 'test:e2e', budgetSeconds }, durationMs, env) !==
            null;
          expect(breached).toBe(durationMs / 1000 > budgetSeconds);
        }
      )
    );
  });
});
