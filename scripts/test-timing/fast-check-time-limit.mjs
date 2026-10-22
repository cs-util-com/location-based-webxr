// The fast-check time limit for every property test in the workspace. Each
// vitest config whose tests import fast-check lists this file in
// `setupFiles` (held there by tests/repo-config/fast-check-time-limit.test.js).
//
// Why: `fc.assert` runs, and shrinks, synchronously. A failing property whose
// shrink makes tiny steps (a float near a bound moves a few bits per step)
// can shrink for hours, and vitest's testTimeout is a timer on the worker's
// event loop, which never turns while it does. The stage then prints nothing
// until it is killed. With this limit the same run is a red test after
// PROPERTY_TIME_LIMIT_MS, with its seed, path and current counterexample.
//
// `markInterruptAsFailure` is half of the guard, not an option: without it
// fast-check reports a run interrupted while still EXPLORING as passed, with
// however many cases it managed. Every interruption is therefore red here.
// See fast-check-time-limit.mjs.md.
import fc from 'fast-check';

/**
 * Above every per-test timeout in the workspace (vitest's 5 s default, 30 s
 * where packages raised it, up to 60 s on single slow properties), so the
 * limit only ever stops a property that would otherwise not end.
 */
export const PROPERTY_TIME_LIMIT_MS = 120_000;

/**
 * @param {number} [limitMs]
 * @returns {{ interruptAfterTimeLimit: number, markInterruptAsFailure: true }}
 */
export function propertyTimeLimitSettings(limitMs = PROPERTY_TIME_LIMIT_MS) {
  if (!Number.isFinite(limitMs) || limitMs <= 0) {
    throw new RangeError(
      `fast-check time limit must be a positive number of ms, got ${String(limitMs)}`
    );
  }
  return { interruptAfterTimeLimit: limitMs, markInterruptAsFailure: true };
}

/**
 * Sets the limit on `api`'s global settings, MERGED over what is already
 * there, so a seed or run count configured elsewhere survives.
 *
 * @param {{
 *   readConfigureGlobal: () => object,
 *   configureGlobal: (settings: object) => void,
 * }} api - the fast-check module
 * @param {number} [limitMs]
 */
export function applyPropertyTimeLimit(api, limitMs = PROPERTY_TIME_LIMIT_MS) {
  api.configureGlobal({
    ...api.readConfigureGlobal(),
    ...propertyTimeLimitSettings(limitMs),
  });
}

applyPropertyTimeLimit(fc);
