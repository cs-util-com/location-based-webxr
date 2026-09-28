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
  - `poseHashValues(pose)` -> `{ alt, tilt, head }`: the pose at the
    hash's resolution (whole metres, 0.01°; heading in [0, 360)).
  - `SETTLE` `{ angleDeg: 0.005, altitudeShare: 1e-4 }` and
    `poseSettled(a, b)`: true when one frame moved every angle by less than
    0.005° (heading compared the short way round) and the altitude by less
    than a 1e-4 share (what 0.005° of tilt moves it by in an oblique view).
    The page then finishes the damping at once (the remaining tail is about
    20 such steps, 0.1°) and writes the pose it lands on: not at the
    gesture's `end`, when the damping still turns the camera.
- Invariants: altitude is kept at every tilt; the hash's `alt`, `tilt` and
  `head` round-trip through these two functions.
- Tests: `terrain-camera.test.mjs`: top-down above the target, south of it
  heading north, east of it heading west; the round trip for every preset
  and an arbitrary pose; the presets' framing; the fly-in's ends, monotonic
  descent, clamping and geometric midpoint; the hash rounding; settled below
  the resolution, moving just above it on each axis, and across north.
