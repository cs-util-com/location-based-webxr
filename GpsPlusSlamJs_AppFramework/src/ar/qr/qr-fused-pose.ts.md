# qr-fused-pose.ts

## Purpose

The QR pose every app reads after M3b: over a window of recent detections of
one code, the rotation comes from the joint multi-view solve
(`qr-multi-view-pose.ts`), the position from today's median of the
single-frame poses, and a gate says when the pose may be used. When the
views contradict each other (old recordings with mixed corner orders, a
burst of bad frames), it falls back to today's averaged rotation.
The tracker also runs the motion detector (`qr-motion.ts`, §26), so a code
that is moved or turned never has its stale views fused.
(QR near-frontal pose plan 2026-09-23-2314, M3b b1, §15-§19, §26.)

## Public API

- The window and its entry type (`QrFusedEntry`, `selectFusedWindow`,
  the options `windowSize`, `gapMs`, `radiusM`, `sinceMs`) live in
  `qr-fused-window.ts`; `QrFusedPoseOptions` extends its options.
- `evaluateFusedQrPose(entries, options?, previous?) -> QrFusedPose`:
  - `status`: `unknown` (no entries), `measuring`, `stable`;
  - `pose`, `method` (`joint` | `averaged` | null);
  - `views`, `droppedViews` (from the joint solve; 0 when it returned
    null), `fitPx` (the MEDIAN of the used views' own corner errors),
    `windowEntries`, `averagedRotationDeltaDeg` (joint vs averaged, a
    diagnostic), and the window's `frameEpoch`, `oldestTimestamp`,
    `newestTimestamp`;
  - `motion`: the tracker's motion reading (`QrMotion`: state, speeds,
    `stillSinceMs`); always `null` here, set by the tracker.
  - `previous` is the last result for the same code: it makes the gate and
    the method sticky (hysteresis) - but only while this window CONTINUES
    it: same frame epoch, not older (a replay seek backwards starts
    afresh), and no gap above `gapMs` since the previous window's newest
    entry.
- `createFusedQrPoseTracker(options?)` -> `{ evaluate(entries), reset() }`:
  caches on the entries ARRAY identity, carries the previous result, and
  runs the motion detector (`options.motion`: its `QrMotionOptions`, or
  `false` to switch it off, when `motion` stays null). The detector CUTS
  the window:
  - while the code is moving or turning, to the newest entry alone - never
    stable, so the app shows the raw single-frame pose (owner, §26);
  - once it is still again, to the entries since `stillSinceMs`, so the
    window rebuilds from the views at the new place.
- Options (defaults; the fit thresholds sit above every good rendered
  window - 0.5-1.1 px, plan §20 - and are to be re-checked against the
  phone's corner noise in b7). A missing, NaN or out-of-range numeric option
  takes its default:
  `windowSize` 8, `gapMs` 4000, `radiusM` Infinity (off), `sinceMs`
  -Infinity (off), `minViews` 5,
  `maxFitPx` 1.5, `fallbackFitPx` 3, `hysteresis` 1.5, `sizeM` 0.16 (only
  for the position when no entry has a raw pose - the rotation does not
  depend on the size), `solveOptions`, `solve` (injectable, for tests;
  the motion detector keeps its own), `motion` (tracker only).

## Invariants & assumptions

- **Method:** joint when the solve returns a result and `fitPx <=
fallbackFitPx` (or `<= fallbackFitPx x hysteresis` if the previous result
  was joint); else averaged over the window's raw poses.
- **Gate:** `stable` when the method is joint, the solve used at least
  `minViews` views, and `fitPx <= maxFitPx` (or `<= maxFitPx x hysteresis`
  if the previous result was stable). The median makes one bad corner or
  one bad view unable to trip the gate (plan §16 #6; the gate needs
  `minViews` 5, while a 2-view fallback check is a plain mean). What the fit
  says is "the views AGREE", not "the tilt is resolved": near-frontal it
  opens at the joint solve's accuracy (p95 ~5 deg at 0-5 deg, plan §20);
  telling those apart is the calibrated tilt signal's job, after M3b. Today's raw-spread gate
  (`evaluateQrPoseStability`) is NOT used (plan §17-§18: it stayed shut on
  ~93 % of near-frontal windows).
- **Position:** the median of the window's raw positions (today's), else
  the joint solve's mean position (at the tracker's `sizeM`). With no raw
  pose and a fit above the fallback bound there is NO pose (nothing to fall
  back to).
- **Why the tracker needs the motion detector.** The joint solve shares
  only the rotation and keeps each view's own position, so a code slid
  sideways still fits well: without the detector the gate stays open and
  the median position trails the code (a test pins > 10 cm, long after the
  point where the detector would have cut). A turn inside the window
  barely raises the fit either (15° over 3 detections: 0.64 px).
- **The price of calm switching.** Motion is confirmed after 4 detections
  (owner, §26); until then the window still fuses, so a stable pose trails
  a code that starts moving for at most 3 detections (~0.4 s; 15 cm at
  0.4 m/s, 15° at 40°/s). After it stops, the pose is stable again 5
  detections after the confirming still run began (`minViews`).
- The tracker costs two extra small solves per detection (the detector's).
- **Cache key:** the entries array identity, never a timestamp (replay and
  store swaps reuse timestamps; plan §16 #5). A store that mutates an array
  in place would defeat it; the `qrDetected` slice hands out new arrays.
- A consistent wrong corner order (an old recording held at one roll) is a
  valid rotated pose and is NOT caught by the fallback; averaging is equally
  wrong there (plan §16 #6).

## Examples

```ts
import { createFusedQrPoseTracker } from 'gps-plus-slam-app-framework/ar';

const tracker = createFusedQrPoseTracker();
const fused = tracker.evaluate(entriesForThisCode);
if (fused.status === 'stable') place(fused.pose);
```

## Tests

- `qr-fused-pose.test.ts`:
  - window selection: size cap, the gap boundary (exactly `gapMs` joins),
    a backwards clock jump, the epoch, the radius filter;
  - the gate at and below `minViews`;
  - the position as the raw median;
  - one bad corner keeps the gate open;
  - the fallback on mixed corner orders;
  - a window where joint and averaged differ returns the joint rotation;
  - hysteresis of the gate and of the method, and none across a frame-epoch
    reset, a gap or a backwards seek;
  - the gate at exactly `minViews`; no pose without raw poses on a bad fit;
  - the radius anchor when the newest entry has no raw pose; small
    out-of-order stamps; a NaN stamp; invalid options fall back to defaults;
  - the tracker solves once per new array, feeds its previous result, and
    forgets it on `reset()`;
  - `sinceMs` cuts the window; with the motion detector a still code stays
    still and stable while the camera walks; a slid or spun code has a
    stable pose that trails for at most the 3 unconfirmed detections, and
    is stable again at the new pose; switched off, the slide's stable pose
    trails on; a bare evaluation carries no motion.
- Planted bugs (2026-09-24), each failing at least one test: mean instead
  of median, no hysteresis, no cache, no epoch check, `>=` at the gap
  boundary, always averaging; and after the milestone review: hysteresis
  carried across an epoch or a backwards seek, the radius anchored on the
  newest entry only, the position from the joint solve, the method's
  stickiness keyed on the status, and `>` at `minViews`; and (2026-09-25)
  no motion cut, and `sinceMs` ignored.
