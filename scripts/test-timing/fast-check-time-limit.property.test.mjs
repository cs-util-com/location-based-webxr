// Why this test matters: the setup module runs before every test file and
// must never take away a setting a test or another setup file put there
// (a seed, a run count, a verbosity). For any prior global settings, applying
// the limit keeps every other key and sets exactly the two it owns.
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPropertyTimeLimit } from './fast-check-time-limit.mjs';

/** @type {ReturnType<typeof fc.readConfigureGlobal>} */
let saved;
beforeEach(() => {
  saved = fc.readConfigureGlobal();
});
afterEach(() => {
  fc.configureGlobal(saved);
});

describe('applyPropertyTimeLimit properties', () => {
  it('keeps every other setting and owns only the two limit keys', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            numRuns: fc.integer({ min: 1, max: 1_000 }),
            seed: fc.integer(),
            verbose: fc.constantFrom(0, 1, 2),
            endOnFailure: fc.boolean(),
            interruptAfterTimeLimit: fc.integer({ min: 1, max: 10_000_000 }),
            markInterruptAsFailure: fc.boolean(),
          },
          { requiredKeys: [] }
        ),
        fc.integer({ min: 1, max: 10_000_000 }),
        (prior, limitMs) => {
          // Inside the property the global settings are this test's own, so
          // write and read them through a scratch save/restore per run.
          const outer = fc.readConfigureGlobal();
          try {
            fc.configureGlobal(prior);
            applyPropertyTimeLimit(fc, limitMs);
            const after = fc.readConfigureGlobal();
            expect(after.interruptAfterTimeLimit).toBe(limitMs);
            expect(after.markInterruptAsFailure).toBe(true);
            for (const key of /** @type {const} */ ([
              'numRuns',
              'seed',
              'verbose',
              'endOnFailure',
            ])) {
              expect(after[key]).toBe(prior[key]);
            }
          } finally {
            fc.configureGlobal(outer);
          }
        }
      )
    );
  });
});
