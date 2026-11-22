# camera-control.ts

## Purpose

The rear camera of the feature matching page on one video element, shared by both views (`cockpit-view.ts`, `guided-view.ts`).

## Public API

- `createCameraControl(video, { getUserMedia, log, fail, changed })` returns `{ start, stop, on }`.
  - `start()`: resolves "on" (running), "failed" (refused or no camera API: `fail("camera", e)` was called) or "stopped" (a stop came while it waited). Never rejects.
  - `stop()`: stops the tracks, clears `video.srcObject`, logs "camera off" and calls `changed(false)`; a no-op without a stream except that it raises the generation.
  - `on()`: whether a stream is running.

## Invariants and assumptions

- Rear camera (`facingMode: environment`), ideal width 1920, no audio.
- One start in flight at a time; it is forgotten once it settles, also when it failed before awaiting anything, so the next tap tries again.
- Every stop raises a generation counter; a start still waiting for its stream then stops that stream and resolves "stopped", so a run never measures beside a live camera.

## Example

```ts
const cam = createCameraControl(video, {
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  log,
  fail,
  changed: (on) => store.dispatch(A.cameraChanged(on)),
});
if ((await cam.start()) === "on") {
  /* aim and capture */
}
```

## Tests

`camera-control.test.ts` (jsdom, faked streams): two taps open one stream and a stop ends it, a stream that arrives after a stop is stopped, a refused camera is reported and retried. The page flows are in `playwright-tests/feature-match-check.spec.js`.
