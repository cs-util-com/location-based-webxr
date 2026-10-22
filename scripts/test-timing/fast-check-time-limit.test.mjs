// Why this test matters: a failing fast-check property whose shrink never
// ends is synchronous work, so vitest's testTimeout (an event-loop timer)
// can never fire, and the gate stage sits silent until someone kills it.
// The shared setup module turns that into a red test with its seed. These
// tests pin the two halves of that promise with a small fixture limit:
//  - a property that shrinks forever goes red AT the limit, naming its seed;
//  - an interruption while still exploring is a failure too. Without
//    `markInterruptAsFailure` fast-check reports such a run as PASSED, so a
//    limit alone would quietly turn a slow failing property into a green one.
// The root vitest run is `isolate: false`, so every test that changes the
// global fast-check settings restores them before it returns.
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PROPERTY_TIME_LIMIT_MS,
  applyPropertyTimeLimit,
  propertyTimeLimitSettings,
} from './fast-check-time-limit.mjs';

/** Small enough to keep the suite fast, large enough to be above a poll. */
const FIXTURE_LIMIT_MS = 300;

/**
 * An arbitrary whose every shrink candidate is a new value that also fails:
 * fast-check follows the chain for as long as it is allowed to.
 */
class EndlessShrink extends fc.Arbitrary {
  /** @returns {fc.Value<number>} */
  generate() {
    return new fc.Value(0, undefined);
  }
  canShrinkWithoutContext() {
    return false;
  }
  /** @param {number} value @returns {fc.Stream<fc.Value<number>>} */
  shrink(value) {
    return fc.Stream.of(new fc.Value(value + 1, undefined));
  }
}

/**
 * Blocks the thread for `ms`, so that a passing property takes time per run.
 * Synchronous, like the property that wedged a gate; no clock arithmetic,
 * so no verdict here depends on how fast the machine runs it.
 */
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
function block(/** @type {number} */ ms) {
  Atomics.wait(SLEEPER, 0, 0, ms);
}

/** @type {ReturnType<typeof fc.readConfigureGlobal>} */
let saved;
beforeEach(() => {
  saved = fc.readConfigureGlobal();
});
afterEach(() => {
  fc.configureGlobal(saved);
});

describe('the shared limit', () => {
  it('is 120 s and marks an interruption as a failure', () => {
    // Above every per-test timeout in the workspace (30-60 s where raised),
    // so a healthy property is never the one the limit stops.
    expect(PROPERTY_TIME_LIMIT_MS).toBe(120_000);
    expect(propertyTimeLimitSettings()).toEqual({
      interruptAfterTimeLimit: 120_000,
      markInterruptAsFailure: true,
    });
  });

  it('rejects a limit that is not a positive finite number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => propertyTimeLimitSettings(bad)).toThrow(RangeError);
    }
  });
});

describe('a property that shrinks forever', () => {
  it('goes red at the limit, with its seed and counterexample', () => {
    // Unlimited, this call would never return; that it returns at all is
    // the limit's doing.
    const result = fc.check(
      fc.property(new EndlessShrink(), () => false),
      { ...propertyTimeLimitSettings(FIXTURE_LIMIT_MS), seed: 4242 }
    );

    expect(result.failed).toBe(true);
    // It did not end on its own: the limit ended it, mid-shrink.
    expect(result.interrupted).toBe(true);
    expect(result.numShrinks).toBeGreaterThan(10);
    const report = fc.defaultReportMessage(result) ?? '';
    expect(report).toContain('seed: 4242');
    expect(report).toContain('Counterexample');
  });
});

describe('an interruption while still exploring', () => {
  const slowPassing = () =>
    fc.property(fc.integer(), () => {
      block(5);
      return true;
    });

  it('passes silently with a time limit alone (why the flag is needed)', () => {
    const result = fc.check(slowPassing(), {
      numRuns: 10_000,
      interruptAfterTimeLimit: FIXTURE_LIMIT_MS,
      // Explicit: local settings merge over the global ones, which this
      // file's import of the module has already set.
      markInterruptAsFailure: false,
    });
    expect(result.interrupted).toBe(true);
    expect(result.failed).toBe(false);
  });

  it('is a failure under the shared settings', () => {
    const result = fc.check(slowPassing(), {
      numRuns: 10_000,
      ...propertyTimeLimitSettings(FIXTURE_LIMIT_MS),
    });
    expect(result.interrupted).toBe(true);
    expect(result.failed).toBe(true);
  });
});

describe('applyPropertyTimeLimit', () => {
  it('merges over the existing global settings instead of replacing them', () => {
    fc.configureGlobal({ ...fc.readConfigureGlobal(), numRuns: 7, seed: 99 });
    applyPropertyTimeLimit(fc, FIXTURE_LIMIT_MS);
    const settings = fc.readConfigureGlobal();
    expect(settings.numRuns).toBe(7);
    expect(settings.seed).toBe(99);
    expect(settings.interruptAfterTimeLimit).toBe(FIXTURE_LIMIT_MS);
    expect(settings.markInterruptAsFailure).toBe(true);
  });
});
