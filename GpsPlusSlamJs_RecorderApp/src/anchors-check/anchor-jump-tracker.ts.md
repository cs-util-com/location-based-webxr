# `anchor-jump-tracker.ts`

## Purpose

The per-frame logic of the anchors check: camera jump detection, the jump
transform `D`, the pose step across tracking losses and long frame gaps, and
the verdict per jump. No DOM, no WebXR objects, no three.js.

## Public API

- Constants: `JUMP_TRANSLATION_M = 0.25`, `JUMP_ROTATION_DEG = 5` (logging
  limits between two frames), `FRAME_GAP_MS = 500` (above it: a gap, never a
  jump), `SETTLE_FRAMES = 10`, `BAND_LOWER_M = 0.3`,
  `RELOCALIZATION_RULE_M = 1` (equal to the framework's
  `FRAME_JUMP_THRESHOLD_M`, pinned by a test), `VERDICT_TOLERANCES`
  (`tight` 0.05 m / 1.5 deg, `main` 0.1 m / 3 deg, `loose` 0.25 m / 6 deg).
- `poseStep(a, b)`: translation (m) and geodesic rotation (deg).
- `classifyStep(step)`: `'rotation only'` (translation at most 0.25 m, so the
  rotation tripped the limit), `'under 0.3 m'`, `'0.3-1 m'`, `'at least 1 m'`.
- `classifyAnchor(before, after, predicted, tol)`: `'frame switch'` when the
  anchor is within `tol` of `D * anchorBefore` only, `'drift correction'`
  when within `tol` of `anchorBefore` only, else `'unclear'`.
- `createAnchorJumpTracker()`: `onFrame(sample)`, `notePlaced(t, pose)`,
  `flush()`, `events()`, `snapshot()`, `stats()`.
- Types: `FrameSample` (`t`, `camera`, `anchor`, `marker`; `null` camera
  means tracking lost), `JumpEvent`, `TrackingLossEvent`, `FrameGapEvent`,
  `PlacedEvent`, `FrameStats`.

## Invariants and defensive measures

- `D` comes from the framework's `jumpTransform` (motion-compensated from the
  two frames before the jump; plain when only one exists), converted from
  NUE back to the raw WebXR frame, so `D * anchorBefore` is in the same
  frame as the anchor poses.
- A jump stays pending for `SETTLE_FRAMES` judged frames, then is judged
  again on the settled anchor pose (an anchor that catches up late shows up
  as a different settled verdict). A new jump, a gap, a loss, a placement or
  `flush` closes it early on the frame before.
- A non-finite or zero-quaternion camera pose counts as a tracking loss; a
  non-finite anchor pose as untracked. A frame whose time does not advance
  is skipped.
- Across a loss or a gap the rate history is forgotten, so the next jump is
  compensated only once two fresh frames exist.
- `snapshot()` shows a pending jump without closing it, so a mid-walk copy
  does not cut its settle window.
- The tracker holds transient measurement state for one page lifetime in a
  closure (per-frame hot path; arrays grow by one number per frame, about
  2.6 MB for half an hour at 60 Hz). Nothing is persisted.

## Example

```ts
const tracker = createAnchorJumpTracker();
renderer.setAnimationLoop((t, frame) => {
  const events = tracker.onFrame({ t, camera, anchor, marker });
  if (events.length > 0) show(tracker.snapshot());
});
```

## Tests

- `anchor-jump-tracker.test.ts`: the constants, `poseStep` and the bands,
  each verdict, frame switch, drift correction, a late anchor, rotation only,
  tracking loss, frame gap, early close, placement, snapshot, bad input.
- `anchor-jump-tracker.property.test.ts`: for random SE(3) jumps, anchors and
  smooth camera motion, the verdict names the generating model at all three
  tolerances and `D` is recovered; motion under the limits logs nothing;
  `poseStep` is symmetric and frame-invariant.
