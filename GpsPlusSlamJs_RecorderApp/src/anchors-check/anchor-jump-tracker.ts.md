# `anchor-jump-tracker.ts`

## Purpose

The per-frame logic of the anchors check. It detects camera jumps (a step
the motion compensation does not explain), tracking losses and long frame
gaps. For each of these episodes it computes the jump transform `D`, reads
the anchor at fixed delays after it and gives a verdict per reading. No DOM,
no WebXR objects, no three.js.

## Public API

- Constants:
  - `JUMP_TRANSLATION_M = 0.25` and `JUMP_ROTATION_DEG = 5`: the limits on
    the unexplained step.
  - `FRAME_GAP_MS = 500`: above it the frame is a gap, never a jump.
  - `STILL_TRANSLATION_M = 0.02` and `STILL_ROTATION_DEG = 1`: the
    stillness limits per frame for counting an uncompensated episode.
  - `MAX_EXTRAPOLATION_RATIO = 3`: the longest frame, in frame intervals,
    over which a compensated jump is counted.
  - `SETTLE_DELAYS_MS = [100, 300, 1000, 2000]`.
  - `BAND_LOWER_M = 0.3`.
  - `RELOCALIZATION_RULE_M = 1`: equal to the framework's
    `FRAME_JUMP_THRESHOLD_M`, pinned by a test.
  - `VERDICT_TOLERANCES`: `tight` 0.05 m / 1.5 deg, `main` 0.1 m / 3 deg,
    `loose` 0.25 m / 6 deg.
- `poseStep(a, b)`: translation (m) and geodesic rotation (deg).
- `isStill(step)`: a step per frame within the stillness limits.
- `classifyStep(step)`: `'rotation only'` (translation at most 0.25 m),
  `'under 0.3 m'`, `'0.3-1 m'` or `'at least 1 m'`. Applied to the
  unexplained step.
- `classifyAnchor(before, after, predicted, tol)`:
  - `'frame switch'` when the anchor is within `tol` of `D * anchorBefore`
    only;
  - `'drift correction'` when it is within `tol` of `anchorBefore` only;
  - `'unclear'` otherwise.
- `createAnchorJumpTracker()` returns:
  - `onFrame(sample)`;
  - `notePlaced(t, pose)`, `noteAnchorFailed(t, message)`,
    `noteFrameError(t, message)`, `noteSession('start' | 'end', t)`;
  - `events()`, `snapshot()`, `stats()`.
- Exported types:
  - `FrameSample`: `t`, `camera`, `anchor`, `anchorTracked`, `marker`. A
    `null` camera means tracking is lost.
  - `TimedPose`.
  - `EpisodeEvent`, `EpisodeKind`, `NotCounted` (`'moving'` or
    `'long frame'`).
  - `AnchorReading`.
  - `TrackerEvent`, `FrameStats`, `PoseStep`, `StepClass`, `Verdict`,
    `Tolerance`, `AnchorJumpTracker`.

## Invariants and defensive measures

- **Detection is on the unexplained step.** That is the step from the camera
  pose extrapolated by the motion compensation (`D^-1 * cameraAfter`) to the
  real one. Its angle is `D`'s angle; its translation is what `D` does at
  the camera. `D`'s own translation is not used, because it grows with the
  distance from the session origin. A steady fast turn or walk logs
  nothing.
- **A frame with no known rate** (the first after a start, a loss or a
  gap) knows only its raw step, and a quick turn passes the limits too. It
  sets the rate; when its raw step is over the limits it is kept as a
  candidate. If the next frame then misses its extrapolation by a jump, that
  miss is the candidate seen again through the rate: the jump is logged at
  the candidate's frame, uncompensated, and the next frame's own step
  stands. If the next frame extrapolates well, the candidate was motion and
  nothing is logged. A loss or a gap between the two drops the candidate.
- **After a jump, the rate frame is carried into the new frame by `D`.** The
  rate frame is the one before `cameraBefore`. Carried over this way, the
  next frame extrapolates at the camera's own speed and does not mistake the
  jump for velocity. A jump the property test generates over the limits is
  logged exactly once; one under the limits not at all.
- **`D` comes from the framework's `jumpTransform`**, converted from NUE
  back to the raw WebXR frame, so `D * anchorBefore` is in the anchor's
  frame. For a loss, a gap or a jump on a frame with no rate, `D` is the
  raw step (`compensated: false`): it is the walker's motion plus the
  jump.
- **Which verdicts count** (`notCounted`):
  - an uncompensated episode counts only when the camera step per frame
    just before it (`cameraPrev` to `cameraBefore`, kept at the loss start)
    is within the stillness limits; otherwise, or when no such step is
    known, it is `'moving'`. A jump on a frame with no rate therefore never
    counts;
  - a compensated jump whose frame is more than `MAX_EXTRAPOLATION_RATIO`
    times the one before is `'long frame'`: a 200 ms stall at 30 Hz during
    a turn's onset (300 deg/s^2) leaves about 7 deg unexplained;
  - not counted episodes are logged in full.
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
  (last frame, rate, loss state). The recorded events stay. Two sessions'
  frames are never compared.
- **Bad input:**
  - A non-finite or zero-quaternion camera pose counts as a tracking loss.
  - A non-finite anchor pose counts as no anchor.
  - A frame whose time does not advance is skipped.
- **State:** the tracker holds transient measurement state for one page
  lifetime in a closure. This is the per-frame hot path; the arrays grow by
  a few numbers per frame. Nothing is persisted.

## Example

```ts
const tracker = createAnchorJumpTracker();
tracker.noteSession('start', t0);
renderer.setAnimationLoop((t, frame) => {
  const events = tracker.onFrame({ t, camera, anchor, anchorTracked, marker });
  if (events.length > 0) show(tracker.snapshot());
});
```

## Tests

- `anchor-jump-tracker.test.ts` covers:
  - the constants, `poseStep` and the bands, and each verdict;
  - a smooth walk, a steady fast turn and a sudden turn;
  - the rate frame in the record, and one jump rather than two when the walk
    goes on;
  - a turn 20 m from the origin judged at the camera, not by `D`;
  - a long frame during an accelerating turn, not counted;
  - a jump on the first frame after a start and after a loss, logged once
    and uncompensated;
  - readings at every delay, with frame switch, drift correction and a
    lagging anchor;
  - an anchor that is not tracked, and truncation by a second jump;
  - a still tracking loss with a verdict, a walking loss not counted, a
    walking and a still frame gap, and the stillness limit's edge;
  - the pending flag, a placement mid-window, the session reset, the notes
    and bad input.
- `anchor-jump-tracker.property.test.ts` covers:
  - for random SE(3) jumps, anchors and smooth camera motion: exactly one
    jump when the step at the camera is over the limits and none when under,
    the verdict naming the generating model at every delay and every
    tolerance, and `D` recovered;
  - steady motion up to about 0.15 m and 20 deg per frame logs nothing;
  - steady motion up to 3 m/s and 300 deg/s with pose noise (3 mm, 0.15
    deg) and frame times between 16 and 33 ms logs nothing;
  - `poseStep` is symmetric and frame-invariant.
