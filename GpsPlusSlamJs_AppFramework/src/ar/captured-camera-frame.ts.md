# captured-camera-frame.ts

## Purpose

A camera frame paired with the camera pose and the time of its capture. The
session builds one per throttled capture, so every CV consumer solves the
pixels against the pose of the **same** XR frame instead of reading "the pose
now" after an asynchronous decode. (QR perf plan 2026-09-23, M4; closes
`2026-08-30-0620-qr-pose-frame-pairing-followup.md` in the `gps-plus-slam`
repo.)

## Public API

- `interface CapturedCameraFrame` (all fields `readonly`)
  - `image: RgbaImage` - top-left-origin RGBA pixels (an owned copy).
  - `cameraPose: Pose` - camera pose in raw WebXR/odom space at capture
    (`{ position: [x, y, z], rotation: [x, y, z, w] }`).
  - `capturedAtMs: number` - capture time in epoch ms,
    `performance.timeOrigin + xrTime` - the same clock as the depth sampler.
- `poseFromArPose(arPose: ARPose): Pose` - reshapes the ARPose objects
  (`{x,y,z}` / `{x,y,z,w}`) into Pose tuples via `extractOdomPosition` /
  `extractOdomRotation` from `types/ar-types.ts`. The one place this reshape
  lives (it was previously copied in the Recorder and the TourViewer).
- `capturedCameraFrame(image, arPose: ARPose | null, xrTimeMs, timeOriginMs): CapturedCameraFrame | null`
  - `xrTimeMs` - the XR animation-frame time (page-relative ms).
  - `timeOriginMs` - `performance.timeOrigin`; a parameter so tests are
    deterministic.
  - Returns `null` when `arPose` is `null`.
- Exported from the `/ar` barrel and as the deep import
  `gps-plus-slam-app-framework/ar/captured-camera-frame` (a tsdown entry).
  the `/ar` barrel exports the `CapturedCameraFrame` type (`webxr-session.ts` does not re-export it).

## Invariants & assumptions

- **No unpaired frame is ever built.** Without a pose the builder returns
  `null`, because every consumer would otherwise solve the frame against a
  different moment. The session checks the pose **before** the blit
  (`acquireCameraFrame` in `webxr-session.ts`), so an unpairable tick costs no
  readback.
- The pose and the image come from the same `onXRFrame` tick: the session sets
  `latestArPose` earlier in the tick than it ticks the `CameraFrameSource`.
- `capturedAtMs` is epoch ms on the depth sampler's clock
  (`performance.timeOrigin + xrTime`); it is what the QR raw records carry as
  `timestamp`.
- Pure: no validation of the image (the blit produces it) and no copy of the
  pose beyond the tuple reshape.

## Examples

```ts
import { capturedCameraFrame } from 'gps-plus-slam-app-framework/ar/captured-camera-frame';

const frame = capturedCameraFrame(
  image,
  arPose,
  xrTime,
  performance.timeOrigin
);
if (frame) controller.offerFrame(frame); // solve uses frame.cameraPose
```

Consumers usually receive frames from `initAR({ cameraFrame: { onFrame } })`
rather than building them.

## Tests

- `captured-camera-frame.test.ts` - the tuple reshape, the pairing of image +
  pose + epoch-ms time, and the `null` result without a pose.

## Related

- `webxr-session.ts` / `.md` - `acquireCameraFrame(xrTimeMs)` builds the frame;
  `ArSessionCallbacks.cameraFrame.onFrame` delivers it.
- `camera-frame-source.ts` / `.md` - the generic throttle that carries it
  (`CameraFrameSource<CapturedCameraFrame>`).
- `qr/qr-tracking-controller.ts.md`, `qr/qr-detection-controller.ts.md` - the
  consumers; both use `frame.cameraPose` and `frame.capturedAtMs`.
