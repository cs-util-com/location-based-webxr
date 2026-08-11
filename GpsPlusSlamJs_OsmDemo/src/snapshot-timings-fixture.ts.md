# `snapshot-timings-fixture.ts`

## Purpose

One zeroed `DemoStageTimings`, for the tests that build a `DemoSnapshot` by hand.

## Public API

- `ZERO_STAGE_TIMINGS: DemoStageTimings` — every field 0.

## Invariants & assumptions

- **It exists because `DemoSnapshot.timings` is required, not optional.**
  `DemoPipeline.update` is the only producer and always measures, so optional
  could only ever mean "a future path dropped it silently" — the silence-reads-
  as-measured failure the click-path plan opens with. The price is that
  hand-built fixtures need the whole field list, and keeping it in one place
  makes adding a stage one edit instead of a hunt.
- **Zeros are honest only for tests that are not about timing.** `osm-store` and
  `refresh-cycle` tests are about store transitions and publish ordering; a pass
  that measured nothing is the right fixture for them. Anything asserting on a
  timing must build its own numbers.
- Not production code in any meaningful sense, but it is imported by production
  types, so it carries a sidecar like everything else that is not a test file.

## Tests

Used by `osm-store.test.ts` and `refresh-cycle.test.ts`. `pipeline-timings.test.ts`
deliberately does NOT use it — it measures real values through the pipeline.
