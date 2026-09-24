# qrperf-instrument

## Purpose

The `?qrperf` instrument: times the demo's capture, detect and solve stages, optionally runs a zxing decode of the same frame for comparison, and renders a report meant to be read off a phone screenshot (plan 2026-09-23 M2, field test §5).

## Public API

- **`createQrPerfInstrument({ mode, baseline, now?, zxing?, intervalMs? }): QrPerfInstrument`** - `intervalMs` (the capture interval the demo runs at) is shown in the report header and the JSON.
  - `onCaptureTiming(CaptureTiming)` - records `blit+readback` and `flip-copy`, counts `capture` and the weighted `capture-ms` (reported as "capture cost ms/s", measured, not derived), remembers the frame size. Passed to the framework through `startCameraFrameCapture({ onCaptureTiming })`.
  - `onPixelCopy(ms)` - `baseline=1` only: the per-decode pixel copy M3 removed, timed inside the copying front end (`seams.ts` `createDetect({ copyPixels, onCopyMs })`), so its cost is measured directly.
  - `onXrFrame(dtSec)` - records `xr-frame` intervals (for the long-frame counts).
  - `wrapDetect(detect)` - counts `detect`, records its duration, counts `hit`; in `zxing` mode then decodes the SAME image with the probe, alternating the `default` / `fast` option sets, records `zxing-default` / `zxing-fast`, keeps a same-frame tally per option set (`frames / native / zxing / both` since start, so the plan's "within 5 pp of native" rule compares identical frames), and - only when both decoders found the code - tallies the corner permutation per roll bin and records `corner-dist`. A frame the probe `skipped` (malformed input) is not an attempt and does not advance the option-set alternation.
  - `wrapSolve(solve)` - records `solve`, counts attempted and accepted solves (a null result was rejected, e.g. by the 4 px reprojection gate; the report shows "solves accepted X / Y", the JSON `solves`), and feeds the pose-quality numbers (`pose-quality.ts`): it reads the corners and camera pose from the solve input and the world rotation and reprojection error from its output, DEFENSIVELY (any other shape, or a failed `null` solve, is ignored), tagged with the text of the detection `wrapDetect` just saw - the same frame, because the scheduler detects and then solves one frame at a time.
  - `onFused(result: QrFusedPose)` - once per lock (M3b b5): tallied by
    `fused-tally.ts` into a `fused:` report line and a `fused` JSON field
    (locks, stable, joint / averaged, fit and joint-vs-averaged percentiles).
  - `snapshot()`, `cornerOrder()`, `report(): string[]`, `json(): string`.
- **`ZxingProbe`** - `{ decode(image, set), loadMs() }`, injected (see `zxing-probe.ts`).

## Invariants & assumptions

- **Never changes what it wraps**: detect and solve results pass through untouched; a throwing zxing probe is swallowed (diagnostic only).
- `dropped (busy)` per second = captures - detect starts: frames the detection scheduler discarded because a detect was still in flight. After M3 this should be ~0 in the post-fix run.
- Windows: stage summaries keep 120 samples (`xr-frame` 1800, ~30-60 s); rates cover the last 10 s; the `since start` line and the JSON carry all-time totals. Take a screenshot at the END of each field-test phase.
- **What the demo A/B can and cannot show:** the veto only acts while a detect is in flight at a due capture. If native decode is well under the 125 ms interval the post-fix and baseline capture rates will be nearly equal - that is a result, not a failure. The veto's main saving (the Recorder's level-fetch window) is not measured by the demo (review finding 10).
- zxing runs on the main thread after the native decode, inside the scheduler's in-flight window, so rates in `zxing` mode are not representative - the report says so; rates come from `?qrperf=1` runs.
- `baseline` only labels the report here; M3 wires the pre-fix behaviour it selects.
- **Pose section** (QR near-frontal pose plan 2026-09-23-2314, M1): orientation jumps between consecutive same-code solves (p50/p95/max, share over 3/5/10 deg, count over 60 deg), still-phone corner jitter at two camera-motion gates, reprojection error, and the code normal's elevation against gravity (meaningful for a code on a vertical wall). "pose: no solves yet" until the demo has a depth-measured size - devices without depth never solve. The JSON carries the same numbers under `pose`.

## Tests

`qrperf-instrument.test.ts` (fakes for the probe and clock). End to end: `playwright-tests/qrperf.spec.js`.
