# image-capture.ts

## Purpose

Captures periodic JPEG screenshots from the WebGL canvas during AR recording. Uses async `toBlob()` for non-blocking performance. Includes validation to detect suspiciously small (likely black/empty) images.

## Public API

| Export                   | Type                 | Description                                                                                                                                                                                                                           |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_VALID_IMAGE_BYTES`  | `number` (5000)      | Blob size threshold for suspicious image detection                                                                                                                                                                                    |
| `ARPose`                 | interface            | Camera position + orientation (duplicated from webxr-session to avoid cycles)                                                                                                                                                         |
| `ImageCaptureConfig`     | interface            | Configuration: `intervalMs`, `quality`, `captureTimeoutMs`, `resolutionDivisor`, `motionFilter` (the blurry-frame motion gate, see `capture-motion-gate.ts`), `qualityFilter` (the blur/blackness image gate, see `image-quality.ts`) |
| `DEFAULT_CAPTURE_CONFIG` | `ImageCaptureConfig` | Defaults: 2000ms interval, 0.7 quality, 5000ms timeout, 1× resolution, motion filter enabled (`DEFAULT_MOTION_FILTER`), quality filter disabled (`DEFAULT_QUALITY_FILTER`)                                                            |
| `CapturedImage`          | interface            | Blob + timestamp + frameIndex + position + rotation + screenRotation + optional `width`/`height` (encoded pixel size). Every persistable field is forwarded by RecorderApp `handleImageCaptured`; thread new fields through it        |
| `CapturedFrame`          | interface            | `{ blob, width, height }` returned by the `captureFrame` (blit) callback — the encoded JPEG plus its render-target pixel dimensions, so the aspect ratio is known without decoding the blob                                           |
| `FrameQualityVerdict`    | interface            | `{ accept, reason? }` returned by the injected `analyzeFrame` analyzer; structurally compatible with `image-quality.ts`'s `QualityVerdict`                                                                                            |
| `ImageCaptureCallbacks`  | interface            | Hooks for pose, rotation, onCaptured, onCaptureFailed, onSuspiciousImage, captureFrame, **analyzeFrame** (off-thread blur/blackness verdict)                                                                                          |
| `ImageCaptureManager`    | class                | Manages periodic capture lifecycle                                                                                                                                                                                                    |
| `startImageCapture(…)`   | function             | **Exported by `ar/webxr-session.ts`, not this module.** Convenience factory: creates + starts an `ImageCaptureManager`                                                                                                                |
| `stopImageCapture()`     | function             | **Exported by `ar/webxr-session.ts`, not this module.** Stops the active manager                                                                                                                                                      |

### ImageCaptureManager key methods

- `start()` — Begin periodic capture timer.
- `stop()` — Stop timer, clear any pending safety timeout, and reset `captureInProgress`.
- `onFrame(canvas, gl)` — Called each XR frame. Checks interval, captures if ready.
- `getFrameCount()` — Returns total frames captured so far.

## Invariants & Assumptions

1. **Single active manager**: `startImageCapture()` replaces any previous manager via `stopImageCapture()`.
2. **captureInProgress guard**: Only one `toBlob()`/`captureFrame()` call can be in-flight at a time. The flag is always reset by `handleCapturedBlob()` or the `.catch()` handler.
3. **Safety timeout**: If a capture promise doesn't resolve within `captureTimeoutMs` (default 5s), the `captureInProgress` flag is force-reset to prevent permanent pipeline deadlock. This is a belt-and-suspenders defense — normal operation always resolves/rejects the promise.
4. **Suspicious image detection**: If blob size < `MIN_VALID_IMAGE_BYTES` (5000), `onSuspiciousImage` is called. The image is still stored for debugging.
5. **Custom capture function**: When `captureFrame` callback is provided, it's used instead of `canvas.toBlob()`. This supports the "blit" technique for WebXR opaque textures.
6. **Epoch-ms timestamp from frame time**: `CapturedImage.timestamp` is `performance.timeOrigin + time`, where `time` is the XR frame `DOMHighResTimeStamp` passed to `onFrame()`. This keeps it in the exact same epoch-ms time domain as the same-frame AR pose and the other per-frame streams (notably depth samples, which use the identical conversion), avoiding the sub-frame drift that `Date.now()` would introduce.
7. **Encoded pixel dimensions**: `CapturedImage.width`/`height` are the dimensions the blob was actually encoded at — the blit render-target size (`captureFrame` path) or the canvas backing-store size (`canvas.toBlob` fallback). Both equal the decoded JPEG's own width/height, so no decode is needed to learn the aspect ratio. They are only attached when positive; a degenerate `0` is dropped so it can never poison the persisted aspect ratio. These flow into `ArImageCapture.width`/`height` for aspect-correct frame-tile rendering (D1 of `2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md`).
8. **Motion gate (blurry-frame skipping)**: when `config.motionFilter.enabled`, a due capture is **deferred** while the device is moving too fast, and fires on the first calm frame (or once `maxWaitMs` elapses — the never-calm fallback). Mechanics:
   - **Per-frame sampling runs above the in-progress / interval guards.** `onFrame` always reads the pose and pushes a `(angularVelocity, linearVelocity)` sample (`pose-motion.ts`) into a `MotionWindow`, so the gate judges INSTANTANEOUS motion at the decision frame, not a multi-second straight-line average (which would net to ≈0 for in-place shake and let blur through — plan §4.3). `getCurrentPose()` is a trivial field read, so the only added per-frame cost is one quaternion `acos`.
   - **First capture / no data → not gated.** With an empty window (very first capture, or an all-glitch run) the gate is bypassed so the first frame is never blocked. Only measurable motion defers a capture; the gate only ever DELAYS, never advances.
   - **Glitch rejection.** A sample beyond the internal velocity ceilings (relocalization teleport) is dropped from the window, and the manager refuses to capture ON that glitch frame (unless the `maxWaitMs` fallback fires).
   - **Tracking-loss reset.** A frame with no pose clears the `MotionWindow` and the prev-frame baseline (`prevPose`/`prevTime`). Otherwise the first sample after recovery is computed across the whole outage gap (not instantaneous) and stale pre-loss maxima keep deferring captures after the device has settled. After a loss the next valid frame is treated as the first post-recovery sample (window empty → not gated).
   - **`dueTime`** is tracked separately from `lastCaptureTime` so the fallback measures from when the capture became due. `lastCaptureTime` is set to the ACTUAL (deferred) capture time so intervals never bunch after a deferral (plan §4.5).
   - Decision logic + window live in `capture-motion-gate.ts`; the config shape (`motionFilter`) is shared with the persisted `ImageCaptureOptions`.
   - **Edge case:** the interval guard is `lastCaptureTime > 0`, so a capture landing at frame time exactly `0` is read as "never captured". Not reachable in production (`performance.now()` is never 0) but relevant when writing tests — use non-zero frame times.
9. **Image-quality gate (blur/blackness drop+retry)**: when `config.qualityFilter.enabled` AND an `analyzeFrame` callback is injected, a freshly-encoded blob is **not saved immediately**. It is sent to `analyzeFrame` (a Web Worker round-trip in the recorder, off the main thread); the manager itself never touches pixels. This is the increment ON TOP of the motion gate — it only runs on frames that already passed motion gating. Mechanics:
   - **`captureInProgress` is released after the synchronous encode, NOT held across the async analysis** — so normal cadence is never throttled to the worker round-trip. A separate `awaitingVerdict` flag blocks a _second_ capture for the same interval until the verdict resolves (plan §6).
   - **Accept → save.** An accepting verdict calls `saveCapture` (the single place a frame becomes durable).
   - **Reject → drop + retry.** A rejecting verdict discards the blob and sets `retryPending`, which **bypasses the interval guard** so the next motion-calm frame fills the slot immediately, rather than waiting a full `intervalMs`.
   - **Frame index allocated only on save.** `++frameCount` moved out of the dispatch path into `saveCapture`, so a dropped/retried frame never burns an index → no gap in the `frame-NNNNNN.jpg` sequence.
   - **Never-good fallback.** `qualityFilter.maxWaitMs` is measured from the FIRST quality attempt of an interval (`qualityDeadlineBase`), independent of the motion gate's `dueTime` clock. Once exceeded, the next frame is saved **without analysis** so an interval is never silently lost (worst case: one blurry frame, not a gap).
   - **Fail-open / no deadlock.** A rejecting _promise_ (worker error) or one that never settles within `captureTimeoutMs` (the `verdictTimeoutId` safety timeout) is treated as accept — a hung analyzer can never deadlock the pipeline. A guarded per-attempt `finish()` ensures the safety timeout and the real verdict can act at most once.
   - **No save after `stop()`.** `finish()` also bails on `!this.capturing`. `stop()` clears `awaitingVerdict`/`verdictTimeoutId` but cannot reach the in-flight `analyze()` promise's `.then` (the `settled` flag is closure-local), and `imageQualityClient.dispose()` on stop fail-opens that promise (resolves accept). Without the `capturing` guard the late verdict would `saveCapture` → `onCaptured` after `endSession`, writing a frame the recorded `frameCount` never saw.
   - **Default OFF** (`DEFAULT_QUALITY_FILTER.enabled === false`) pending field-tuning of the relative blur threshold — a mis-tuned gate silently dropping good frames is worse than the motion gate's low-risk default-on (plan §10). Verdict/history policy + metrics live in `image-quality.ts`; the config shape (`qualityFilter`) is shared with the persisted `ImageCaptureOptions`.

## Examples

```typescript
import {
  startImageCapture,
  stopImageCapture,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';

const manager = startImageCapture(canvas, gl, {
  getCurrentPose: () => currentPose,
  getScreenRotation: () => screen.orientation?.angle ?? 0,
  onCaptured: (image) => storage.writeFrame(image),
  onCaptureFailed: () => log.warn('Capture failed'),
});

// Later
stopImageCapture();
```

## Tests

- Unit tests: `image-capture.test.ts`
- Covers: interval timing, JPEG quality, frameIndex increment, pose data, encoded width/height on both the `captureFrame` (blit dims) and `canvas.toBlob` (canvas dims) paths, suspicious image detection, toBlob null handling, custom captureFrame, captureInProgress safety timeout, stop() cleanup of safety timeout and captureInProgress
- Motion-gate integration tests: `image-capture.motion-gate.test.ts` — fast→calm deferral fires on the first calm frame, real (deferred) capture timestamp, never-calm `maxWaitMs` fallback, filter-disabled legacy capture, glitch-frame not grabbed. Pure decision/window logic is covered in `capture-motion-gate.test.ts`.
- Quality-gate integration tests: `image-capture.quality-gate.test.ts` — accept→save, reject→drop+retry-next-frame (no full-interval wait, no index gap), never-good `maxWaitMs` fallback (saves without analyzing), fail-open on a never-settling analyzer (no deadlock), legacy/disabled paths save immediately, and composition with the motion gate. Pure metrics + verdict policy are covered in `image-quality.test.ts`.
