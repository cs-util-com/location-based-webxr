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
  - `SETTLE_DELAYS_MS = [100, 300, 1000, 2000]`.
  - `BAND_LOWER_M = 0.3`.
  - `RELOCALIZATION_RULE_M = 1`: equal to the framework's
    `FRAME_JUMP_THRESHOLD_M`, pinned by a test.
  - `VERDICT_TOLERANCES`: `tight` 0.05 m / 1.5 deg, `main` 0.1 m / 3 deg,
    `loose` 0.25 m / 6 deg.
- `poseStep(a, b)`: translation (m) and geodesic rotation (deg).
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
  - `EpisodeEvent`, `EpisodeKind`.
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
- **A frame with no known rate is never judged for a jump.** This covers the
  first frame after a start, a loss or a gap: on such a frame a raw step
  would read every quick turn as a jump. The frame only sets the rate.
- **After a jump, the rate frame is carried into the new frame by `D`.** The
  rate frame is the one before `cameraBefore`. Carried over this way, the
  next frame extrapolates at the camera's own speed and does not mistake the
  jump for velocity, so one jump is logged once.
- **`D` comes from the framework's `jumpTransform`**, converted from NUE
  back to the raw WebXR frame, so `D * anchorBefore` is in the anchor's
  frame. For a loss or a gap no rate is used and `D` is uncompensated, so a
  loss is only meaningful while the camera holds still.
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
  - readings at every delay, with frame switch, drift correction and a
    lagging anchor;
  - an anchor that is not tracked, and truncation by a second jump;
  - a tracking loss and a frame gap, each with a verdict;
  - the pending flag, a placement mid-window, the session reset, the notes
    and bad input.
- `anchor-jump-tracker.property.test.ts` covers:
  - for random SE(3) jumps, anchors and smooth camera motion: one jump, the
    verdict naming the generating model at every delay and every tolerance,
    and `D` recovered;
  - steady motion up to about 0.15 m and 20 deg per frame logs nothing;
  - `poseStep` is symmetric and frame-invariant.
