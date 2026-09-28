# terrain-camera.js: poses, presets and the fly-in

- Purpose: the terrain lab's camera as altitude, tilt and heading around the
  region's centre (terrain plan 2026-09-27-0605 §4 "Camera presets", §9
  finding 10). Altitude, because the auto exaggeration reads it.
- Public API:
  - `CAMERA_PRESETS`: `top` (580 km up, straight down: W = 250 km),
    `oblique` (170 km, 60°: the diorama framing), `low` (20 km, 70°).
  - `FLY_IN` `{ from: 600 km at 45°, to: the low preset, durationMs: 12 s }`.
  - `orbitPosition({ altitudeM, tiltDeg, headingDeg })` -> [x, y, z]: the
    camera's offset from its target in three's frame (x east, y up, z
    south); heading is where the camera LOOKS, clockwise from north.
  - `poseFromPosition([x, y, z])`: its exact inverse (heading 0 when
    looking straight down).
  - `flyInPose(t)`: the pose at t in 0-1 (clamped), eased at both ends;
    altitude geometric, tilt linear, heading the short way round.
- Invariants: altitude is kept at every tilt; the hash's `alt`, `tilt` and
  `head` round-trip through these two functions.
- Tests: `terrain-camera.test.mjs`: top-down above the target, south of it
  heading north, east of it heading west; the round trip for every preset
  and an arbitrary pose; the presets' framing; the fly-in's ends, monotonic
  descent, clamping and geometric midpoint.
