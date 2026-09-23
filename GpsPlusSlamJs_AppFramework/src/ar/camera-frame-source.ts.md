# camera-frame-source.ts

## Purpose

A **generic** throttled RGBA camera-frame feed for computer-vision consumers (QR
detection today; object detection / OpenCV tomorrow). A per-XR-frame tick that
performs the camera-texture blit + readback **only at the detection cadence**
(~8 Hz), not every render frame — the efficiency win behind plan option **B2**.

## Public API

- `class CameraFrameSource<TFrame = RgbaImage>` - generic over whatever
  `capture` builds; the session uses `CameraFrameSource<CapturedCameraFrame>`
  (pixels + capture pose + epoch-ms time, see `captured-camera-frame.ts.md`).
  (QR perf plan 2026-09-23, M4.)
  - `constructor(callbacks: CameraFrameSourceCallbacks<TFrame>, config?: Partial<CameraFrameSourceConfig>)`
  - `start()` / `stop()` / `isRunning(): boolean`
  - `onFrame(timestamp: number): void` — call once per XR frame; captures at most
    once per `intervalMs`.
  - `getFrameCount(): number` — successful captures since `start()`.
  - `setWantsFrame(fn | null)` — the consumer's veto (e.g. `() => !controller.isBusy()`). A due tick whose predicate returns `false` skips the capture **without consuming the interval**, so the first frame after the veto lifts is captured at once; a throwing predicate counts as "wanted" (never throws into the XR loop); `null` restores always-wanted. The interval cap still holds whatever the predicate says. (QR perf plan 2026-09-23, M3.)
  - `getConfig()` / `updateConfig(partial)` — `intervalMs` only; invalid values
    ignored. The **constructor routes its optional `config` through
    `updateConfig`**, so the same validation applies at construction — an invalid
    `intervalMs` (≤ 0, `NaN`, `Infinity`) falls back to the default cadence rather
    than bypassing the throttle (which would capture on every frame).
- `CameraFrameSourceCallbacks<TFrame = RgbaImage>`
  - `capture: (timestamp: number) => TFrame | null` - receives the XR frame
    `timestamp` of the due tick and does the GPU blit → top-left RGBA
    (production: the session's `acquireCameraFrame(xrTimeMs)`, which wraps
    `CameraBlitCapture.captureToRgba` and pairs the image with that XR frame's
    pose and time). `null` = no frame this tick.
  - `onCapture: (frame: TFrame) => void` — receives throttled frames.
- `CameraFrameSourceConfig` — `{ intervalMs }` (default 125 ms ≈ 8 Hz).

## Invariants & assumptions

- The throttle is driven by the **`timestamp` argument** (the XR `time`), not a
  wall clock, so tests are deterministic.
- A `null`/throwing `capture()` does **not** consume the interval slot — the next
  frame retries immediately (a missing camera texture is transient). `capture`
  throwing is swallowed (never escapes the frame loop).
- `start()` resets the cadence (`lastCaptureTime`) and the counter; the first
  tick after `start()` always captures.
- `capture` is injected (no hard dependency on `CameraBlitCapture` /
  `WebGLRenderer`) so the throttle is unit-testable without a GPU.
- **Single cadence owner (Option A):** when this source drives a
  `createDetectionScheduler` (QR controller, object detector, …), make the source
  the ONE throttle — give it the detection `intervalMs` and set the scheduler's
  own `minIntervalMs` to `0`. The scheduler's coalescing still prevents
  overlapping in-flight detects, so every delivered frame is detected without a
  second throttle dropping boundary frames.

## Scope / future

Wired for **one** live CV consumer at a time (QR _or_ object detection): the
session keeps a single source + callback + blit. For **two simultaneous** CV
consumers at independent cadences/resolutions, generalize the
`webxr-session.ts` wiring to a small multi-consumer registry
(`registerCameraFrameConsumer({ intervalMs, captureSize, onFrame }) =>
unregister`), one `CameraFrameSource` per consumer — the class is already
per-instance, so only the session wiring changes. See the SCOPE note in
`camera-frame-source.ts` and the matching comment in `webxr-session.ts`.

## Examples

```ts
const src = new CameraFrameSource<CapturedCameraFrame>(
  {
    // `time` is the XR frame time passed to onFrame below
    capture: (time) => {
      const image = blit.captureToRgba(renderer, texture);
      return image
        ? capturedCameraFrame(image, arPose, time, performance.timeOrigin)
        : null;
    },
    onCapture: (frame) => controller.offerFrame(frame), // controller minIntervalMs: 0
  },
  { intervalMs: 125 }
);
src.start();
// in the XR frame loop:
src.onFrame(time);
```

## Tests

- `camera-frame-source.test.ts` — throttle math, the **performance regression**
  test (≈ 8 captures over ~1 s of 60 fps frames, not ~60), null-retry,
  throw-safety, stop/restart, and `updateConfig` validation — plus the
  **constructor-validation** block proving an invalid `intervalMs` passed at
  construction is rejected the same way (and does not bypass the throttle);
  the `wantsFrame` veto block; and the **frame timestamp** block (M4) proving
  `capture` receives the XR frame `timestamp` and `onCapture` gets whatever
  `capture` built.
- `camera-frame-source.property.test.ts` - the `wantsFrame` veto under random
  frame rates and decode latencies.
