# `monotonic-clock.ts`

## Purpose

One monotonic millisecond clock, used by every stage timer in the demo.

## Public API

- `nowMs(): number` — `performance.now()`, or `Date.now()` where there is no
  `performance` global.

## Invariants & assumptions

- **Monotonic on purpose.** `Date.now()` can step backwards on an NTP
  correction, and a res-7 fetch takes tens of seconds — the exact window where
  that happens. A negative duration would make the click-path reconciliation
  close by _cancelling_, silencing the only check that would notice.
- **Shared rather than duplicated.** It was a local in `demo-pipeline.ts` until
  the worker handler and the page needed the same clock; three copies of the
  fallback guard is three places for it to drift.
- Not for wall-clock provenance. Anything a user reads as a date — `fetchedAt`,
  "OSM data from March 2026" — uses epoch time from its own source.

## Tests

Exercised indirectly by `pipeline-timings.test.ts` and `click-timings.test.ts`.
Deliberately has no test of its own: asserting `performance.now()` is
monotonic tests the platform, not this file.
