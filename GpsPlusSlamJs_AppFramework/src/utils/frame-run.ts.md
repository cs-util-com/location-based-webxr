# frame-run.ts

## Purpose

One frame-recorder run: the whole-run histogram (`frame-histogram.ts`), the
attribution join (`frame-attribution.ts`) and the worst frames with their
events, fed by one `endFrame` per frame; plus the idle refresh-rate
calibration. Globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`
§4.1, PERF-0. The globe lab's recorder (PERF-1) is the first caller.

## Public API

- `createFrameRun(options?)`:
  - options: the histogram's (`binMs`, `rangeMs`, `thresholdsMs`,
    `refreshIntervalMs`), the join's `lags`, and `worstCount` (20).
  - `endFrame(intervalMs, events = [])` - the interval from this frame's
    start to the next's, and the events that fell in it.
  - `summary(): FrameRunSummary` - `{ stats, attribution, worst }`, where
    `worst` is `{ frame, ms, events }[]`, slowest first (ties: earlier
    frame first).
  - `RangeError` for a `worstCount` that is not a non-negative integer, or
    any option the parts refuse.
- `REFRESH_CALIBRATION_MIN_SAMPLES` - 30.
- `calibrateRefreshInterval(intervalsMs, minSamples = 30): number | null` -
  the median (interpolating, `median.ts`) of the finite positive
  intervals, or `null` when fewer than `minSamples` remain. `RangeError`
  for a `minSamples` that is not a positive integer.

## Invariants & assumptions

- **One frame index for every part:** the index counts every `endFrame`
  call, refused ones too, so the lab's frame numbering and the export
  agree.
- **The histogram and the join see the same frames with the same
  thresholds**, so `stats.over[i].count === attribution.hitchFrames[i]`
  (property test); the export relies on that and carries the number once.
- **Worst frames** are exactly the `worstCount` slowest accepted frames
  (property test); their event arrays are copies.
- **Calibrate while IDLE** (plan §4.1, review Minor 10): the camera held,
  the tiles settled, about 2 s - never inside the band, where the frame
  rate is the thing being measured. The median ignores the few slow frames
  an idle page still has. 30 samples is half a second at 60 Hz; the plan's
  2 s window gives 120 or more.
- The interval of a frame is only known at the NEXT frame's start, so the
  caller ends frame i at frame i+1's callback with the events recorded
  since frame i's start (the binding is PERF-1's).

## Examples

```ts
const refresh = calibrateRefreshInterval(idleIntervals); // before the path
const run = createFrameRun({ refreshIntervalMs: refresh });
run.endFrame(dtMs, eventsSinceLastFrame); // each frame
const { stats, attribution, worst } = run.summary();
```

## Tests

`frame-run.test.ts`: one call feeds every part; the histogram's counts are
the join's hitch frames (property); worst frames (golden, refused frames
still numbered, exactly the slowest as a property, copied events, option
refusal); calibration (minimum samples, the median at 60 / 90 / 120 / 144
Hz with idle slow frames, bad intervals dropped, another minimum).
