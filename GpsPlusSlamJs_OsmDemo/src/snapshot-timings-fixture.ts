/**
 * A zeroed `DemoStageTimings`, for tests that build a `DemoSnapshot` by hand.
 *
 * WHY THIS EXISTS RATHER THAN A LITERAL IN EACH TEST. `DemoSnapshot.timings` is
 * REQUIRED (see `demo-pipeline.ts`), because `update` is its only producer and
 * always measures — an optional field could only ever mean "a future path
 * dropped it silently". The cost of that decision is that every hand-built
 * snapshot fixture needs all of the fields, and two test files build one. A
 * shared constant keeps the field list in one place, so adding a stage is one
 * edit rather than a hunt.
 *
 * **Zeros are honest HERE and nowhere else.** These fixtures belong to tests
 * about the store and the refresh cycle, which are not about timing at all; a
 * pass that genuinely measured nothing is exactly what they should carry. A
 * test that asserts anything about timings must build its own numbers — see
 * `pipeline-timings.test.ts`.
 *
 * @see snapshot-timings-fixture.ts.md
 */

import type { DemoStageTimings } from "./demo-pipeline.js";

export const ZERO_STAGE_TIMINGS: DemoStageTimings = {
  transportMs: 0,
  decodeMs: 0,
  parseMs: 0,
  storeMs: 0,
  probeMs: 0,
  slotWaitMs: 0,
  joinedMs: 0,
  fetchMs: 0,
  mergeMs: 0,
  scoreMs: 0,
  deriveMs: 0,
  pipelineMs: 0,
  tilesFetched: 0,
  tilesHeld: 0,
  tilesFromNetwork: 0,
  tilesFromCache: 0,
  tilesUnmeasured: 0,
};
