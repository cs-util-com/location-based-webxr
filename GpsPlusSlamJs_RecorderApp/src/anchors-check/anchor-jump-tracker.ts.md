# `anchor-jump-tracker.ts`

## Purpose

The per-frame logic of the anchors check. It detects camera jumps (a step
the motion compensation does not explain), tracking losses and long frame
gaps. For each of these episodes it computes the jump transform `D`, reads
the anchor at fixed delays after it and gives a verdict per reading. No DOM,
no WebXR objects, no three.js.

## The principle: never wrong, not complete

The counted verdict is conservative by construction. An episode counts only
when its own data prove a correction and leave no doubt that `D` is that
correction, not the camera's motion or an extrapolation error. The
on-screen count may leave real episodes out; it must never count a wrong
one. Every episode, counted or not, is logged in full with the data the
rules read, so the log stays the authoritative source for re-judging
offline with other rules.

## Public API

- Constants:
  - `JUMP_TRANSLATION_M = 0.25` and `JUMP_ROTATION_DEG = 5`: the limits on
    the unexplained step.
  - `FRAME_GAP_MS = 500`: above it the frame is a gap, never a jump.
  - `STILL_SPEED_M_PER_S = 0.3` and `STILL_TURN_DEG_PER_S = 20`: the
    stillness limits for counting an uncompensated episode. Rates, not
    steps per frame, so the rule is the same at 30 and 60 Hz (a 1 m/s walk
    at 60 Hz is under 0.02 m per frame).
  - `STILL_WINDOW_MS = 100`: the shortest run of tracked frames the
    stillness is measured over.
  - `STILL_DISPLACEMENT_M`: half the main tolerance (0.05 m), the most the
    camera's motion before an uncompensated episode may move the anchor
    over it.
  - `STEADY_RATE_FRACTION = 0.5`: the rate frame of a counted compensated
    jump has its own unexplained step under this fraction of the jump
    limits (0.125 m and 2.5 deg).
  - `MAX_EXTRAPOLATION_RATIO = 1.5`: the longest frame, in frame intervals,
    over which a compensated jump is counted (exactly 1.5 counts).
  - `SETTLE_DELAYS_MS = [100, 300, 1000, 2000]`.
  - `BAND_LOWER_M = 0.3`.
  - `RELOCALIZATION_RULE_M = 1`: equal to the framework's
    `FRAME_JUMP_THRESHOLD_M`, pinned by a test.
  - `VERDICT_TOLERANCES`: `tight` 0.05 m / 1.5 deg, `main` 0.1 m / 3 deg,
    `loose` 0.25 m / 6 deg.
- `poseStep(a, b)`: translation (m) and geodesic rotation (deg).
- `classifyStep(step)`: `'at most 0.25 m'` (at most
  `JUMP_TRANSLATION_M`: a jump by its rotation), `'0.25-0.3 m'`,
  `'0.3-1 m'` or `'at least 1 m'`, by the translation. Applied to the
  unexplained step.
- `classifyAnchor(before, after, predicted, tol)`:
  - `'frame switch'` when the anchor is within `tol` of `D * anchorBefore`
    only;
  - `'drift correction'` when it is within `tol` of `anchorBefore` only;
  - `'unclear'` otherwise.
- `createAnchorJumpTracker()` returns:
  - `onFrame(sample)`;
  - `notePlaced(t, pose)`, `noteAnchorFailed(t, message)`,
    `noteError('frame-error' | 'anchor-read-error', t, message)`,
    `noteSession('start' | 'end', t)`;
  - `events()`, `snapshot()`, `stats()`;
  - `settlingReadings()`: the readings the still-settling episode holds (0
    when none), so the page can render on each new reading without
    copying the snapshot every frame.
- Exported types:
  - `FrameSample`: `t`, `camera`, `anchor`, `anchorTracked`, `marker`. A
    `null` camera means tracking is lost.
  - `TimedPose`, `Stillness`, `ErrorKind`.
  - `EpisodeEvent`, `EpisodeKind`, `NotCounted` (`'no correction'`,
    `'moving'`, `'unsteady rate'` or `'long frame'`).
  - `AnchorReading`.
  - `TrackerEvent`, `FrameStats`, `PoseStep`, `StepClass`, `Verdict`,
    `Tolerance`, `AnchorJumpTracker`.

## Invariants and defensive measures

- **Detection is on the unexplained step.** That is the step from the camera
  pose extrapolated by the motion compensation (`D^-1 * cameraAfter`) to the
  real one. Its angle is `D`'s angle; its translation is what `D` does at
  the camera. `D`'s own translation is not used, because it grows with the
  distance from the session origin. A steady fast turn or walk logs no
  compensated jump.
- **A frame with no known rate** (the first after a start, a loss or a
  gap) knows only its raw step. One over the limits is logged at once, as
  an uncompensated jump. Either way the frame becomes the next frame's
  rate: steady motion (a quick turn) is then extrapolated well, and the
  next frame of a real jump misses by the jump again. That echo is logged
  too, with an `unsteady rate` (its rate frame had no rate of its own), so
  it never counts; a second real jump on that frame is logged the same
  way, never swallowed.
- **After a jump on a steady rate, the rate frame is carried into the new
  frame by `D`.** The next frame then extrapolates at the camera's own
  speed and does not mistake the jump for velocity. After a jump on an
  unsteady rate the rate itself may hold a jump, so the raw frame is the
  next rate, as for any frame. A jump the property test generates over the
  limits is logged exactly once; one under the limits not at all.
- **`D` comes from the framework's `jumpTransform`**, converted from NUE
  back to the raw WebXR frame, so `D * anchorBefore` is in the anchor's
  frame. It is called with mode `'always'`: the rate frame is the frame
  just before, one frame interval back, and this module's own counting
  rules (steady rate, extrapolation ratio) judge it. The framework's
  default guard compensates only over a baseline of at least
  `COMPENSATION_BASELINE_MS`, so it would leave every per-frame rate raw
  and log a walk's own motion as jumps; `compensated` means exactly "a
  rate frame was given". For a loss, a gap or a jump on a frame with no rate, `D` is the
  raw step (`compensated: false`): it is the walker's motion plus the
  jump.
- **Which verdicts count** (`notCounted`, checked in this order):
  - an uncompensated episode needs a proven correction: a raw camera
    translation over `JUMP_TRANSLATION_M`, else `'no correction'` (a still
    loss with a 1 deg tilt and the anchor 10 m away would otherwise read as
    a drift correction). Then it needs the camera still, else `'moving'`:
    - the window is the run of tracked frames before the episode, at least
      `STILL_WINDOW_MS` long (unknown when shorter: a loss right after a
      start or another loss is `'moving'`); its speed and turn rate are its
      net step over its span, within the stillness limits;
    - that motion carried over the episode, `(speed + turn rate * anchor
distance) * dt` with the turn rate in rad/s, moves the anchor under
      `STILL_DISPLACEMENT_M`;
    - stillness DURING the loss is a precondition of the method, not
      something the tracker can check: motion while the camera is covered
      is not observed at all, and the window's net step over its span
      hides an out-and-back before it. The walker stands still through a
      covered-camera loss; a loss taken while moving is judged on a `D`
      that holds that motion;
  - a compensated jump needs a steady rate: the rate frame's own
    unexplained step known and under `STEADY_RATE_FRACTION` of the limits,
    else `'unsteady rate'` (a 0.2 m correction under the limits sits in the
    next frame's rate and, over a frame twice as long, makes a 0.4 m jump
    that never happened). Then a frame at most `MAX_EXTRAPOLATION_RATIO`
    times the one before, else `'long frame'` (a 200 ms stall at 30 Hz
    during a turn's onset, 300 deg/s^2, leaves about 7 deg unexplained);
  - episodes not counted are logged in full, with the rate frame's own
    unexplained step and the stillness figures.
- **Noise floor:** `stats().unexplainedM` and `unexplainedDeg` take only
  frames on a steady rate that are no jump themselves, so neither a jump
  nor its echo enters them.
- **Readings:**
  - Each episode reads the anchor in its own frame (delay 0), then at the
    first frame at or after each of `SETTLE_DELAYS_MS`.
  - The delays are in ms, so the window is the same at 30 and 60 Hz.
  - Each reading logs the raw `getPose` result, its `trackedAnchors` flag
    and the comparison.
  - A pose with `tracked === false` is logged but never judged: WebXR may
    return a frozen last pose for a lost anchor.
- **Closing an episode:**
  - It closes after its last delay.
  - A later episode, a loss, a placement or a session note closes it early,
    marked `truncated`.
  - `snapshot()` adds a still-open episode marked `pending: true` without
    closing it, so a mid-walk copy does not cut the window.
- **Placement** forgets the last anchor, so a jump right after a re-tap
  never compares the old anchor with the new one.
- **`noteSession`** closes a pending episode and resets the frame continuity
  (last frame, rate, stillness window, loss state). The recorded events
  stay. Two sessions' frames are never compared.
- **Bad input:**
  - A non-finite or zero-quaternion camera pose counts as a tracking loss.
  - A non-finite anchor pose counts as no anchor.
  - A frame whose time does not advance is skipped.
  - A stillness figure that is not a number fails the comparison, so it is
    not still.
- **State:** the tracker holds transient measurement state for one page
  lifetime in a closure. This is the per-frame hot path; the arrays grow by
  a few numbers per frame and the stillness window holds about 100 ms of
  frames. Nothing is persisted.

## Example

```ts
const tracker = createAnchorJumpTracker();
tracker.noteSession('start', t0);
renderer.setAnimationLoop((t, frame) => {
  const events = tracker.onFrame({ t, camera, anchor, anchorTracked, marker });
  if (events.length > 0 || tracker.settlingReadings() !== shown) {
    shown = tracker.settlingReadings();
    show(tracker.snapshot());
  }
});
```

## Tests

- `anchor-jump-tracker.test.ts` covers:
  - the constants, `poseStep` and the bands, and each verdict;
  - a smooth walk, a steady fast turn (only its unrated first pair logged,
    not counted) and a sudden turn;
  - the rate frame and its own unexplained step in the record, and one jump
    rather than two when the walk goes on;
  - a turn 20 m from the origin judged at the camera, not by `D`;
  - a long frame during an accelerating turn, not counted;
  - a jump on the first frame after a start and after a loss, logged
    uncompensated, its echo not counted;
  - readings at every delay, with frame switch, drift correction and a
    lagging anchor;
  - an anchor that is not tracked, and truncation by a second jump;
  - a still tracking loss with a verdict, a walking loss not counted, a
    walking and a still frame gap, and stillness as a speed at 30 and
    60 Hz with the speed and turn edges;
  - what is counted: a second real jump on the frame after an unrated jump,
    the echo of an unrated step under the limits, a correction under the
    limits followed by a frame twice as long, a still loss with no
    correction (a 1 deg tilt, the anchor 10 m away), the extrapolation
    ratio at exactly 1.5 and just over, the 100 ms window, the displacement
    at the anchor, and jumps kept out of the noise floor;
  - the pending flag, a placement mid-window, the session reset, the notes
    and bad input;
  - a still camera with seeded Gaussian pose noise (1 mm and 0.05 deg per
    axis, swept at 0.33x, 1x and 3x, at 30 and 60 Hz) logs no jump and
    keeps its noise floor under the steady-rate limit. The first jumps
    appear near 10x at 60 Hz and between 10x and 20x at 30 Hz, the
    rotation binding first.
- `anchor-jump-tracker.property.test.ts` covers:
  - for random SE(3) jumps, anchors and smooth camera motion: exactly one
    jump when the step at the camera is over the limits and none when under,
    counted, the verdict naming the generating model at every delay and
    every tolerance, and `D` recovered;
  - steady motion up to about 0.15 m and 20 deg per frame logs nothing but
    possibly its unrated first pair, never counted;
  - the same for steady motion up to 3 m/s and 300 deg/s with pose noise
    (3 mm, 0.15 deg) and frame times between 16 and 33 ms;
  - `poseStep` is symmetric and frame-invariant.
