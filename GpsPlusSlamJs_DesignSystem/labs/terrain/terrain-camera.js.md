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
  - `flyInPoseAtAltitude(altitudeM)`: the same path's pose where it passes
    an altitude (progress log-even), beyond its ends the end's tilt and
    heading at that altitude: the comparison page's captures (globe
    round-5 §3.3). RangeError for a non-positive altitude.
  - `poseHashValues(pose)` -> `{ alt, tilt, head }`: the pose at the
    hash's resolution (whole metres, 0.01°; heading in [0, 360)).
  - `SETTLE` `{ angleDeg: 0.005, altitudeShare: 1e-4 }` and
    `poseSettled(a, b)`: true when one frame moved every angle by less than
    0.005° (heading compared the short way round) and the altitude by less
    than a 1e-4 share (what 0.005° of tilt moves it by in an oblique view).
    The page then finishes the damping at once (the remaining tail is about
    20 such steps, 0.1°) and writes the pose it lands on: not at the
    gesture's `end`, when the damping still turns the camera.
  - `createSettleTracker()`: that settle as the page runs it. `end()` (the
    finger lifts) arms it and zeroes `frames`, `start()` (a new gesture)
    disarms it, and `frame(pose)`, called once per frame after the
    controls' update, returns true once, on the first frame that moved the
    pose by less than SETTLE (never before the second frame: the first has
    nothing to compare against). `frames` is the frames from the release to
    that one; `active` is whether it is armed.
  - `ORBIT_DAMPING` (0.05, three's default, set explicitly by the lab) and
    `MAX_TILT_DEG` (89, the controls' `maxPolarAngle`).
  - `dragTurnDeg(dx, dy, heightPx)` -> `{ headingTurnDeg, tiltTurnDeg }`:
    the turn a mouse drag asks the controls for, 360° per canvas HEIGHT on
    both axes (three's rotate handler). RangeError for a non-positive height.
  - `settleFrameBound({ headingTurnDeg, tiltTurnDeg, tiltDeg, dampingFactor?, settle? })`:
    the most frames the tracker can count for a turn of at most that much
    still to go at the release.
    - Derivation: update i after the release moves an axis by
      f (1 - f)^(i-1) of its turn X. With the axis' threshold T the step
      falls below it at i = floor(ln(f X / T) / -ln(1 - f)) + 2 (1 when
      f X < T already). The heading's T is `SETTLE.angleDeg`; the tilt's is
      also capped by the altitude share, 1e-4 / tan(tilt) rad at the
      steepest tilt the turn can reach. The bound is the later axis, at
      least 2. Updates during the drag (three runs one per pointer move)
      and clamps only shorten it.
    - Why frames: three damps per UPDATE, so the settle is a number of
      frames, and its wall time is that number times the machine's frame
      cost. The drag smoke asserts this bound instead of a wall-clock wait,
      which failed on CI once the lab's frames grew (findings
      2026-10-03-2254 #3).
    - Worked example: the smoke's 60 x 12 px drag at the oblique preset's
      60° turns 30° of heading and 6° of tilt on a 720 px canvas; the bound
      is 113 frames (heading-dominated; 116 at 600 px, 105 at 1080 px).
    - RangeError for a damping outside (0, 1), a non-finite turn or a tilt
      outside 0-90°.
- Invariants: altitude is kept at every tilt; the hash's `alt`, `tilt` and
  `head` round-trip through these two functions.
- Tests: `terrain-camera.test.mjs`: top-down above the target, south of it
  heading north, east of it heading west; the round trip for every preset
  and an arbitrary pose; the presets' framing; the fly-in's ends, monotonic
  descent, clamping and geometric midpoint; the hash rounding; settled below
  the resolution, moving just above it on each axis, and across north; the
  bound's hand-worked values, its two thresholds, its monotonic sweep over
  turns, tilts and dampings, and its refusals; the drag turn; the tracker's
  arming, earliest settle, count and cancel.
  `terrain-camera-damping.test.mjs`: the bound against three's REAL
  OrbitControls (the served copy), driven through its pointer handler and
  swept over dampings 0.02-0.2, seven drags, tilts 20-80° and canvas
  heights 600-1080 px, in 1, 4 and 12 pointer moves: never exceeded; tight
  (within 3 frames) with the whole turn still to go; and the settled pose
  turned by the drag's whole turn once the damping is finished.
