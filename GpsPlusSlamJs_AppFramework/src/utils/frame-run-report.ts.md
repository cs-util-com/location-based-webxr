# frame-run-report.ts

## Purpose

The frame recorder's phone-readable summary and its paste-able export.
Pure text and data; the overlay, the Copy (`navigator.clipboard.writeText`)
and Download buttons and the selectable fallback box are the globe lab's
(PERF-1). Globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`
§4.1 "Usable on a phone" and "The export"; DEC-PERF-1 (the phone is the
measurement device), DEC-PERF-3 (the target).

## Public API

- `SUMMARY_MAX_LINE_CHARS` - 40, the phone-width line limit.
- `FRAME_EXPORT_SCHEMA` - `'frame-export/1'`.
- `formatFrameRunSummary(label, summary, { target?, handfuls?, verdicts? })`
  returns lines: the label, frame count and refresh rate; p50 / p95 / p99;
  max, mean, dropped frames and refused intervals; the counts over each
  threshold; `PASS` / `FAIL` against the target with its counts; the
  handfuls; up to three supported or provisional causes, or
  `causes: none supported`. `RangeError` when the run did not count the
  target's thresholds.
- `buildFrameExport({ device, runs, target?, handfuls?, verdicts?, worstCount?, causesPerRun? })`
  returns a `FrameExport` that `JSON.stringify` turns into valid JSON:
  - `schema`, `device` (opaque; strings cut at 500 characters, non-finite
    numbers and other values become `null`), `target` with its handfuls,
    `attribution` (the `ks` and `minHitchFrames` used);
  - `runs[]`: label, frames, rejected, refresh interval, dropped,
    overflow, `ms` (min / mean / p50 / p95 / p99 / max, 0.01 ms), `over`
    (threshold -> count, also the join's hitch frames), `pass`, `handfuls`,
    `lags`, and up to `causesPerRun` (3) supported or provisional causes;
  - `pooled`: the join over ALL runs with EVERY event kind, or `null`
    without runs;
  - `worst`: the `worstCount` (20) slowest frames across runs, with their
    run index, frame index and events.
  - A cause is `{ kind, status, cells: "n/27", maxRatio, counts }`, where
    `counts[threshold][lag] = [inHitch, inNormal]`, so any verdict can be
    recomputed; `maxRatio` is rounded, `"inf"` for an event never in a
    normal frame, `null` when undefined.
  - `RangeError` as above, or for a negative or non-integer `worstCount`
    or `causesPerRun`, or runs counted at different thresholds or lags.

## Invariants & assumptions

- **No NaN or Infinity reaches the JSON:** JSON cannot carry them, and
  `JSON.stringify` would write `null`, losing the difference between
  "never in a normal frame" and "undefined".
- **Why `pooled`:** a warm run that meets the target has at most 5 frames
  over 33 ms, so one run rarely reaches the 5-hitch-frame minimum; the
  sweep's runs pooled can. Per-run causes only show variation.
- **Size (plan §4.1: about 5-10 KB, to paste from a phone).** Measured on a
  synthetic quick sweep (12 runs, 8 event kinds, a full device block):
  6.4 KB when no run has a supported cause, 13.3 KB when every run has
  three supported causes and every worst frame three events. The test
  pins the light case at 10 KB; `causesPerRun` is the lever if the heavy
  case is too long to paste (the Download button is the fallback).
- Every summary line is at most 40 characters: long labels and event
  names are cut with a final `~`, and token lists wrap.

## Examples

```ts
const text = formatFrameRunSummary('alps 2/3', run.summary());
const json = JSON.stringify(buildFrameExport({ device, runs }));
```

## Tests

`frame-run-report.test.ts`: a clean PASS run and a FAIL run with its
strongest cause; no supported cause; refused intervals; an empty run; the
40-character limit over long labels and event names; valid JSON with the
schema, device, target and per-run verdicts; `"inf"` and no NaN; the raw
counts; the pool (a cause supported only pooled, every kind); the worst
frames across runs; device-string cut; the 10 KB quick-sweep budget.
