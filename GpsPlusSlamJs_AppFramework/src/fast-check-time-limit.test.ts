// Why this test matters: every fast-check property in this package must run
// under the shared time limit (scripts/test-timing/fast-check-time-limit.mjs,
// listed in setupFiles by the config this package's test:unit stage uses).
// Without it a failing property whose shrink never ends wedges its worker
// where vitest's testTimeout cannot reach. This reads the EFFECT in this
// package's own run, under its own config and its own fast-check instance;
// tests/repo-config/fast-check-time-limit.test.js holds every package whose
// tests import fast-check to carrying this file. The value is pinned once,
// in scripts/test-timing/fast-check-time-limit.test.mjs.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('the fast-check time limit', () => {
  it('is set for this package, and an interruption counts as a failure', () => {
    const settings = fc.readConfigureGlobal();
    expect(settings.interruptAfterTimeLimit).toBeGreaterThan(0);
    expect(settings.markInterruptAsFailure).toBe(true);
  });
});
