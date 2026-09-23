# pipeline-timings

## Purpose

Rolling collector behind the `?qrperf` report: per-stage duration summaries and per-event rates. Pure - it has no clock; callers pass timestamps.

## Public API

- **`createPipelineTimings({ windowSize = 120, rateWindowMs = 10_000 })`** returns:
  - `record(stage, ms)` - keeps the last `windowSize` durations per stage (`stageWindows` overrides per stage, e.g. a long `xr-frame` series); non-finite or negative values are ignored.
  - `count(event, atMs, weight = 1)` - timestamps an event; a weight turns the rate into "units per second" (e.g. ms of capture work per second).
  - `snapshot(nowMs)` - `{ stages: { [stage]: { n, median, p95, max } }, ratesPerSec: { [event]: sum(weights in window) / window s }, totals: { [event]: all-time sum }, longFrames: { over1_5x, over2x } }`. `totals` exist because a screenshot taken after a phase change would otherwise only show the last 10 s (review finding 3).
  - `reset()`.
- **`nearestRankPercentile(values, p)`** - nearest-rank percentile of a copy; `NaN` for an empty sample.

## Invariants & assumptions

- Median is the framework's shared `interpolatingMedian` (`gps-plus-slam-app-framework/utils/median`, DEC-H3).
- `min <= median <= p95 <= max` and `n <= windowSize` for any input (seeded property test).
- `longFrames` counts `xr-frame` intervals longer than 1.5x and 2x their own median - relative on purpose, because a 30 fps and a 60 fps session differ by 2x (cold review finding 10).
- Rates count only events after `nowMs - rateWindowMs`; older timestamps are dropped at snapshot time, so memory stays bounded.

## Tests

`pipeline-timings.test.ts` (arithmetic), `pipeline-timings.property.test.ts` (200 seeded random runs).
