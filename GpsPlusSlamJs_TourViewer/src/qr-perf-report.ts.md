# qr-perf-report.ts

## Purpose

The Tour Viewer's `?qrperf=1` instrument: what one QR capture costs on this
app's own path, to decide with numbers whether the capture should move off
the main thread. It measures, per capture:

- the blit and its GPU readback, and the CPU flip (the capture's
  `onCaptureTiming`), and their sum per capture;
- detect's wall time (call to result: BarcodeDetector runs asynchronously,
  so this is latency, not main-thread time) and the hits;
- the solve;
- the XR frame intervals, with the frames longer than 1.5x and 2x their own
  median (relative, so a 30 fps and a 60 fps phone are judged alike).

Its report is a section of the visitor's `?debug=1` Copy log
(`travelling-box-log.ts`, `wireTravelLogButtons`' appendices), so a field
test reads it as `?debug=1&qrperf=1`. A diagnostic buffer, not app state:
it lives beside the store, like the Copy log's other sections. Modelled on
the QR demo's instrument, kept small and in this app.

## Public API

- `qrPerfEnabled(search): boolean` - true only for `qrperf=1`.
- `createQrPerfReport({ now?, intervalMs? }): QrPerfReport`
  - `now` - the clock for detect and solve (default `performance.now`).
  - `intervalMs` - the capture interval, shown in the header.
- `QrPerfReport`
  - `onCaptureTiming(timing)` - pass as `startCameraFrameCapture`'s hook.
  - `onXrFrame(dtSec)` - each XR frame's `dt` (the frame loop's).
  - `wrapFrontEnd(frontEnd)` - the same front end with detect timed and
    hits counted; `dispose` is forwarded.
  - `wrapSolve(solve)` - the solve, timed; its result is returned as is.
  - `text()` - the report lines; `clear()` - empties it.
- `QR_PERF_WINDOW` (240 samples per stage, 30 s at 8 Hz),
  `QR_PERF_FRAME_WINDOW` (1800 XR frame intervals).

## Invariants and defensive measures

- A timing that is not finite and >= 0 is not kept; a frame interval of 0
  or less is not kept.
- A failed detect or solve is still timed, and its error is rethrown
  untouched.
- Every stage keeps a bounded window; the counts are since the last
  `clear()`.

## Example

```ts
const report = qrPerfEnabled(location.search)
  ? createQrPerfReport({ intervalMs: 125 })
  : null;
startCameraFrameCapture({
  intervalMs: 125,
  onCaptureTiming: (t) => report?.onCaptureTiming(t),
});
```

## Tests

- `qr-perf-report.test.ts`: the flag; readback, flip and their sum per
  capture; detect's wall time, hits and `dispose`; a failed detect; the
  solve; long frames against the median; bad timings ignored; `clear()`;
  the bounded window.
- `qr-perf-report.property.test.ts`: for any frame intervals the long-frame
  counts nest (over 2x <= over 1.5x <= kept frames) and the kept frames
  are the positive intervals within the window.
