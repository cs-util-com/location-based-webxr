# frame-histogram.ts

## Purpose

Whole-run frame-interval statistics for the globe lab's frame recorder:
a fixed-bin histogram for p50 / p95 / p99, exact cumulative counters for
the hitch thresholds, min / max / mean, and a dropped-frame estimate.
Globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`
§4.1 ("Whole-run statistics"), PERF-0, review Minor 9.

A run is 10,000-26,000 frames; the live ring (`frame-times.ts`) holds 300.
This holds any run in constant memory (about 64 KB at the defaults).

## Public API

- `FRAME_HITCH_THRESHOLDS_MS` - `[33, 50, 100]`, the plan's thresholds
  (§4.3); the default of `thresholdsMs`.
- `createFrameHistogram(options?)`:
  - options: `binMs` (0.25), `rangeMs` (1000; longer intervals share one
    overflow bin), `thresholdsMs` (default above; deduplicated, sorted),
    `refreshIntervalMs` (`null`; enables `droppedFrames`).
  - `push(ms): boolean` - `false` for a non-finite or negative interval,
    which is counted in `rejected` and nowhere else.
  - `percentile(p)` - nearest rank (`percentile.ts`'s `nearestRank`) read
    from the bins; `NaN` when empty.
  - `countOver(thresholdMs)` - the exact count strictly over a DECLARED
    threshold; `RangeError` for any other (a silent zero would be a silent
    PASS).
  - `snapshot(): FrameHistogramSnapshot` - `count`, `rejected`, `minMs`,
    `maxMs`, `meanMs`, `p50Ms`, `p95Ms`, `p99Ms` (each `null` when empty),
    `over: { thresholdMs, count }[]` ascending, `overflowCount`,
    `droppedFrames` (`null` without a refresh interval),
    `refreshIntervalMs`.
- `RangeError` from `createFrameHistogram` for a non-finite or
  non-positive bin width, range or refresh interval, a range not wider than
  one bin, more than 1,000,000 bins, or a non-finite or negative threshold.

## Invariants & assumptions

- **"Over" is strictly greater.** A 50.0 ms interval is not over 50.
  - ⚠️ On a 60 Hz and on a 120 Hz display, 33.3 ms and 50.0 ms are exact
    multiples of the refresh period, so one missed vsync measures about
    33.3 ms (counted over 33) and two missed measure about 50.0 ms (over 50
    about half the time, by rAF jitter). Both readings are possible; this
    module counts what it is told. Raised as an open question in the
    PERF-0 record; any extra threshold (e.g. 34 or 51) is one option entry.
- **The threshold counts are exact** (counted from the raw interval at
  `push`, never from the bins), for any threshold list (swept by a
  property test).
- **Each bin keeps its own largest interval**, so a percentile is an
  interval that happened: never below the exact nearest-rank value and
  less than one bin above it (property test, swept over bin widths 0.1,
  0.25, 1 and 5 ms). In the overflow bin it is the run's max. p100 is the
  max exactly.
- **Dropped frames**: per interval `max(0, round(ms / refresh) - 1)`, the
  refresh periods it hid; rounding absorbs rAF jitter of under half a
  period (a steady run at 60 / 90 / 120 Hz with 20 % jitter drops 0).
- Per-frame cost: one division, one bin update, one comparison per
  threshold. No allocation after creation.

## Examples

```ts
const h = createFrameHistogram({ refreshIntervalMs: 1000 / 60 });
h.push(16.6); // each frame
h.countOver(33); // exact
h.snapshot(); // { count, p50Ms, p95Ms, p99Ms, maxMs, over, droppedFrames, ... }
```

## Tests

`frame-histogram.test.ts`: default thresholds; empty snapshot; strict
"over"; exact counts at any threshold list (property); refusal of an
undeclared threshold; rejected values; min / max / mean; the bin-error
bound and observed-value property (swept bin widths); percentile order and
p100; a 26,000-frame run; dropped frames (null without refresh, golden
values, steady runs at 60 / 90 / 120 Hz); option refusals.
