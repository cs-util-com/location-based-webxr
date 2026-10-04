# synthetic-qr-walk

## Purpose

Test-only camera walks around a static QR code, for measuring multi-view pose
estimation offline (QR near-frontal pose plan 2026-09-23-2314, M0). The camera
always looks at the code centre, upright, like a phone held by a walking user.

## Public API

- `walkCameraPoses({ kind, codeWorld, distanceM, extent, steps, offsetDeg? })`
  - world camera poses along one of the plan's fixed walk shapes: `sidestep`
    (lateral travel `extent` m), `rise` (vertical travel `extent` m through the
    code's height - the pitch axis the phone's wall check measures), `arc`
    (`extent` deg around the code),
    `approach` (starts `extent` m behind `distanceM`), `still`. `offsetDeg`
    centres the walk that far off the code's normal (about world y).
  - `RangeError` on a non-positive distance, a negative extent or a
    non-integer step count.
- `lookAtPose(eye, target)` - an upright WebXR camera (+x right, +y up, -z
  forward) at `eye` looking at `target`.
- `codeInCamera(cameraWorld, codeWorld)` - the renderer's `qrPoseInCamera`.
- `rayAngleDeg(cameraWorld, codeWorld)` - the angle between the code's normal
  and the ray from its centre to the camera: how obliquely this view sees it,
  independent of where the camera points (the done bar bins by it).

## Invariants & assumptions

- The world is WebXR's, y up; the code's +z is its printed face's normal.
- The camera never rolls (its x axis stays horizontal) and never mirrors.

## Tests

`synthetic-qr-walk.test.ts`: the code stays centred for every walk shape and
a yawed code, the camera is upright and unmirrored (mutation-checked), the
pose round-trips, arc / sidestep / still reach the expected ray angles, the
approach distances, and the input validation.
