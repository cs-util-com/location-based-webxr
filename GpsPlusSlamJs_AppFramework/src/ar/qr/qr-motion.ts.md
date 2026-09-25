# qr-motion.ts

## Purpose

The QR motion detector (QR near-frontal pose plan 2026-09-23-2314, §26):
per code and INDEPENDENTLY, whether it is being MOVED and whether it is
being TURNED - four states (still, moving, turning, moving + turning) - so
the fused QR window keeps today's stability for a still code and follows a
hand-held one. In world coordinates: a camera walking around a still code
reads "still".

## Public API

- `measureQrMotion(entries, options?) -> QrMotionSignals` - one detection's
  raw signals, the NEWEST of the last `motionWindow` detections (one frame
  epoch, no long gap; `selectFusedWindow`) against the rest:
  - `movingCandidate`, `offsetM`, `speedMps`: the newest view's own position
    against the rest's median; moving above `moveM`. The positions are the
    entries' raw poses when every entry in the window has one, else the joint
    solve's `viewPositions` at `sizeM`. The speed is that offset over the time since the rest's
    median detection.
  - `turningCandidate`, `newestFitPx`: the newest view's corner error
    (`viewErrorAtRotationPx`) at the rotation solved from the OTHER views
    alone; turning above `turnPx`.
  - `turnRateDegPerS`: ROUGH, for display only - the newest single-frame
    (raw) rotation against the others' joint rotation, per second since the
    rest's median detection (the same time base as the speed; null without
    a raw pose). A steady 40°/s reads ~49°/s (pinned). §26 asked for the
    rotation from the per-view fits; the raw one is used instead and is
    flip-prone near head-on, which is why it never decides anything.
  - All null / false with fewer than two detections in the window, or when
    any view in it is unusable (the newest must be judged, and a dropped
    view would shift the positions against their timestamps).
- `createQrMotionTracker(options?) -> { update(entries), reset() }` - the
  per-code detector with persistence: `moving` and `turning` are each
  confirmed only after `persistence` consecutive detections agree, in both
  directions (owner: ~0.5 s). Returns the signals plus `state`, `moving`,
  `turning`, and `stillSinceMs` (when the code became still after its last
  confirmed motion; null while it is moving or turning, and when it has not
  moved in this run). A new frame epoch, or time going backwards within one
  (a replay seek, a store swap), starts it afresh. A re-read of the same
  newest detection (the same entry, or a rebuilt copy with the same corners
  array and timestamp) returns the last result: persistence counts
  detections, not reads. A reading with no signal (too few views, a failed
  solve, an unusable view) neither confirms nor breaks a run.
- Options (defaults PROVISIONAL until the §26 sweep; out-of-range values
  fall back to the default): `motionWindow` 4 (≥ 2), `moveM` 0.03,
  `turnPx` 3, `gapMs` 4000 (the fused window's default; a longer step between
  detections breaks the motion window), `persistence` 4 (≥ 1), `sizeM` 0.16 (positions only, and only
  without raw poses), `solve` (injectable).

## Invariants & assumptions

- **The two signals are nearly orthogonal by construction.** Each view
  keeps its own position: a sideways move changes the positions but not
  the fit at the others' rotation; a turn in place changes the fit but
  barely the position.
- **Why the rotation of the OTHERS, not one shared by all.** Under a
  continuous turn every view disagrees with a rotation shared by the whole
  window, so the newest's share of that disagreement stays close to the
  others' and a relative test never fires. Against the rotation of the
  views before it, the newest is clearly past it (a first attempt with the
  shared rotation missed every continuous turn).
- **Positions come from the raw poses, because the size matters.** A view's
  position from its corners scales with the size the solve assumes, pulling
  it toward its camera; with a wrong size a camera walking past a still code
  (16 cm per detection) moves the code's positions enough to read "moving".
  The producer's raw poses are solved at the size it measured, so they are
  used whenever every entry has one. RAW producers (the recorder, and so
  replays) store no solved pose, so their entries carry none; then the
  detector solves at `sizeM`, which the fused tracker sets to its own
  `sizeM` - the caller must pass the printed size there.
- **The newest against the rest**, not a spread over the window: a single
  outlier frame (a corner-order flip) is a candidate for ONE detection and
  never reaches the persistence.
- **`turnPx` is an ABSOLUTE pixel threshold and so depends on corner noise
  and resolution.** Measured on synthetic walks (fx 820, 2026-09-25, 10
  seeds x 40 detections of a still code): the newest view's error sits at
  about 1.5x the per-corner noise; at 1 px of noise a few single detections
  cross 3 px and persistence 4 absorbs every one; at 1.5 px 2/400 leak; at
  2 px it breaks (20 % non-still). A 1°/detection in-plane turn reads
  2.2-3.5 px (borderline), 2°/detection and up ≥ 4.4 px. Where real corners
  sit is what the phone test decides (plan §26; the same
  resolution-dependence as the fused window's fit gate, b7).
- **A physical limit:** turning the code OUT of the image plane near
  head-on moves its corners only at second order (the reason its tilt is
  hard to measure), so a slow such turn is seen late or not at all; turns
  of an oblique code and in-plane turns are seen at first order.
- **What it cannot confirm:** a motion over in fewer than about 3-4
  detections (a quick reposition shows on at most 2 detections, because
  the newest is compared with the median of the previous three), a slide
  slower than about 12 cm/s (the offset is about two detections of travel,
  against 3 cm), and a slow out-of-plane turn near head-on. The same
  property ignores a SLAM relocalisation jump.
- **The raw poses' size must be steady.** Positions come from the raw
  poses, so a producer whose size estimate is still converging (the QR
  demo's running median from depth) moves a still code by about
  distance x (relative size change) per detection - 3 cm at 1.2 m for a
  2.5 % change. Not measured yet; the phone test's still runs show it.
- **Distance (sweep 2026-09-25):** at the demo's 1024-px capture a 16 cm
  code decodes to about 1.2-1.5 m only (none at 2 or 3 m); within that
  range the still move signal barely changes (p95 1.8 -> 2.1 cm at medium
  SLAM noise, 0.6 -> 1.2 m), while close up the turn signal grows (max
  4.2 px at 0.6 m, heavy noise; persistence still held it at 0 false).
- Two joint solves per detection: all `motionWindow` views (positions) and
  all but the newest (rotation).

## Examples

```ts
const motion = createQrMotionTracker();
// after each new detection of one code (entries oldest first, one epoch):
const m = motion.update(selectQrFusedEntries(state, text));
if (m.state === 'still') {
  // fuse the window since m.stillSinceMs
}
```

## Tests

- `qr-motion.test.ts`: a still code with a walking camera reads still; a
  sideways move reads moving (with its speed), an in-plane turn reads
  turning, both read both; fewer than two detections say nothing; an
  out-of-plane turn of an oblique code is seen; a still code past a fast
  camera reads still whatever size is assumed (0.08-0.32 m) when the entries
  carry raw poses, and without them the assumed size matters (pinned); the persistence in both
  directions; a rebuilt copy of a detection is not counted again; a
  confirmed motion survives readings without a signal; time going
  backwards starts afresh; no still time while moving again; a steady
  turn's rate; the window breaks at `gapMs`; one outlier frame never flips the state; a still code under
  1 px of corner noise stays still (10 seeds x 40 detections); one step per
  detection however often it is read; `stillSinceMs`.
- `qr-motion.property.test.ts`: for any sequence of raw moving candidates
  and any persistence 1-6, the confirmed flag equals the reference
  debounce (flip exactly after `persistence` consecutive opposing
  detections). An off-by-one in the persistence fails it.
