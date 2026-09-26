# qr-detection-controller.ts

## Purpose

The **thin, geo-less RAW producer** for live QR detection (decision **D-X** of the recorder
live-QR plan, realized as "thin producer + shared derive-on-read consumer"). Per accepted
decode it emits ONE `RawQrObservation` — raw corners + capture-time camera pose + projection + frame size

- timestamp — and nothing derived. No size measure, no PnP: those moved to
  [`qr-derived-pose.ts`](./qr-derived-pose.ts.md) so the recording stays algorithm-agnostic /
  re-testable (D-A).

## Public API

- `createQrDetectionController(deps) → QrDetectionController` with
  `offerFrame(frame: CapturedCameraFrame)` (pixels + capture pose + epoch-ms capture time, see
  [captured-camera-frame.ts.md](../captured-camera-frame.ts.md)),
  `isBusy()` (true while a detect is in flight - the camera source's capture veto), `status`, `reset()`, `dispose()` (plan §61: stop for good - a decode in flight records nothing and reports no status; the recorder's teardown calls it).
- `QrDetectionControllerDeps` — injected: `detect(image)`,
  `getProjectionMatrix()`, `recordDetection(observation)` (the sink), `now?` (the scheduler's
  clock only), `minIntervalMs?` (default 0), `requiredLockCount?` (default 2), `onStatus?`.
  `getCameraPose` was removed in QR perf plan 2026-09-23, M4 - the pose comes with the frame.
- `QrScanStatus = 'idle' | 'scanning' | 'tracking'`; `RawObservationSink`.

## Invariants & assumptions

- **Cadence** is owned by `createDetectionScheduler` (throttle + N-consecutive-lock); this
  controller adds no second throttle (D-B refinement — the per-marker record throttle is
  deferred to this cadence).
- **Rejects** mirrored / degenerate quads (`validateQuad`) — the same reads `solveQrPose`
  rejects — and **skips** when `getProjectionMatrix()` is `null`, so a recording never
  captures an underivable detection.
- The record's `cameraPose` is `frame.cameraPose` and its `timestamp` is
  `frame.capturedAtMs`, both from the XR frame the pixels were captured in, never read after
  the `await detect` (M4). The projection is still read at **detection-resolve** time: it is per-session and does
  not move with the phone. The corners + that projection must describe the same buffer.
- **No `ar → state` import**: the record sink is injected; the controller never touches the
  `qrDetected` slice. Geo-less: casts no GPS vote. Separate from the level-based
  `qr-tracking-controller.ts` (the geo/vote brain), which is untouched.

## Examples

```ts
const controller = createQrDetectionController({
  detect: frontEnd.detect,
  getProjectionMatrix: () => latestProjection,
  recordDetection: (o) => store.dispatch(recordQrDetection(o)),
});
// `frame` is a CapturedCameraFrame, e.g. from initAR's cameraFrame.onFrame
controller.offerFrame(frame); // throttled/coalesced internally
```

## Tests

`qr-detection-controller.test.ts` — one raw observation per accepted decode after the lock
count (asserting the exact raw shape + no derived fields), degenerate-quad rejection,
null-projection skip, the record carrying the FRAME's pose and capture time rather than
the decode-resolve moment (M4), `isBusy()` exactly while a detect is in flight (M3), and
no-decode → stays scanning, and nothing recorded or reported for a decode that settles after `dispose()`.
