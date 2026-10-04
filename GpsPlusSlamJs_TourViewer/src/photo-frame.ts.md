# photo-frame

## Purpose

Decides which captured camera frame the creator's "Capture a photo" may use. The photo is encoded from the frame's pixels and placed with the frame's own capture pose (QR perf plan 2026-09-23, M4), so the frame must be recent.

## Public API

- **`usablePhotoFrame(frame, nowEpochMs): CapturedCameraFrame | null`** - the frame when it is at most `PHOTO_FRAME_MAX_AGE_MS` old, else `null` (also for no frame). `nowEpochMs` is `performance.timeOrigin + performance.now()`, the clock of `capturedAtMs`.
- **`PHOTO_FRAME_MAX_AGE_MS`** - 1000 ms (eight 125 ms capture intervals).

## Invariants & assumptions

- **Why an age limit exists:** frames stop arriving while tracking is lost (the camera texture needs a pose), but `ctx.latestFrame` keeps the last one until the session ends. Without the limit a tap during a loss would place a photo from a frame of unbounded age. Before M4 such a tap was refused because the tap-time pose was null; the limit keeps that behaviour explicit (M4 review finding 2).
- A refused tap shows the creator the existing "No camera frame yet - try again in a moment." note (`creator-setup.ts`).

## Tests

`photo-frame.test.ts`.
