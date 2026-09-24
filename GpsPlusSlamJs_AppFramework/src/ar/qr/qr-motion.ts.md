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
    (the joint solve's `viewPositions`) against the rest's median; moving
    above `moveM`. The speed is that offset over the time since the rest's
    median detection.
  - `turningCandidate`, `newestFitPx`: the newest view's corner error
    (`viewErrorAtRotationPx`) at the rotation solved from the OTHER views
    alone; turning above `turnPx`.
  - `turnRateDegPerS`: ROUGH - the newest single-frame rotation against the
    others' rotation, per second since the previous detection (null without
    a raw pose).
  - All null / false with fewer than two detections in the window, or when
    any view in it is unusable (the newest must be judged, and a dropped
    view would shift the positions against their timestamps).
- `createQrMotionTracker(options?) -> { update(entries), reset() }` - the
  per-code detector with persistence: `moving` and `turning` are each
  confirmed only after `persistence` consecutive detections agree, in both
  directions (owner: ~0.5 s). Returns the signals plus `state`, `moving`,
  `turning`, and `stillSinceMs` (when the code became still after its last
  confirmed motion; null if it has not moved in this frame epoch). A new
  frame epoch starts it afresh; a re-read with the same newest entry returns
  the last result (persistence counts detections, not reads).
- Options (defaults PROVISIONAL until the §26 sweep; out-of-range values
  fall back to the default): `motionWindow` 4 (≥ 2), `moveM` 0.03,
  `turnPx` 3, `persistence` 4 (≥ 1), `sizeM` 0.16 (positions only), `solve`
  (injectable).

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
  out-of-plane turn of an oblique code is seen; the persistence in both
  directions; one outlier frame never flips the state; a still code under
  1 px of corner noise stays still (10 seeds x 40 detections); one step per
  detection however often it is read; `stillSinceMs`.
- `qr-motion.property.test.ts`: for any sequence of raw moving candidates
  and any persistence 1-6, the confirmed flag equals the reference
  debounce (flip exactly after `persistence` consecutive opposing
  detections). An off-by-one in the persistence fails it.
