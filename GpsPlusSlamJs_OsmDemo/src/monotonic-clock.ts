/**
 * The demo's monotonic millisecond clock.
 *
 * WHY IT IS SHARED RATHER THAN PRIVATE. It began as a local in
 * `demo-pipeline.ts` for the geo-event timings; the click-path breakdown then
 * needed the same clock in the worker handler and on the page, and three copies
 * of a `typeof performance === "undefined"` guard is three places for the
 * fallback to drift.
 *
 * **MONOTONIC, and that word is load-bearing.** `Date.now()` steps backwards on
 * an NTP correction, and a res-7 fetch measured in tens of seconds is exactly
 * the window where that lands. A negative duration in a stage breakdown is
 * worse than a wrong one: the reconciliation sums the stages against a wall
 * clock, so a negative makes the sum close by CANCELLING and the one gate that
 * would catch a clock problem goes quiet precisely when it should shout.
 *
 * The `Date.now` fallback is for a runtime with no `performance` global — some
 * test environments. Durations are reported in whole milliseconds, so the two
 * clocks agree well within the reporting resolution; what matters is that a
 * missing global cannot throw inside the path being measured.
 *
 * @see monotonic-clock.ts.md
 */

export function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
