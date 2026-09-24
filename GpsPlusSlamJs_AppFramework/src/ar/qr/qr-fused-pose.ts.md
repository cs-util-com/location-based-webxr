# qr-fused-pose.ts

## Purpose

The QR pose every app reads after M3b: over a window of recent detections of
one code, the rotation comes from the joint multi-view solve
(`qr-multi-view-pose.ts`), the position from today's median of the
single-frame poses, and a gate says when the pose may be used. When the
views contradict each other (old recordings with mixed corner orders, a
burst of bad frames), it falls back to today's averaged rotation.
(QR near-frontal pose plan 2026-09-23-2314, M3b b1, §15-§19.)

## Public API

- `QrFusedEntry`: `{ timestamp, corners, cameraPose, intrinsics, epoch?,
rawPose? }`. `timestamp` is ms on the producer's own clock (only
  differences count); `epoch` is the tracking-frame epoch (bumped on an
  odometry restart; default 0); `rawPose` is the single-frame world pose
  when the producer solved one.
- `selectFusedWindow(entries, { windowSize?, gapMs?, radiusM? })` - the
  window, oldest to newest. Walking back from the newest entry it stops at
  another epoch or at a time step above `gapMs` between consecutive entries
  (in either direction, so a clock jump backwards also breaks it); it
  leaves out entries whose raw position is farther than `radiusM` from the
  newest raw position (entries without a raw pose are kept); at most
  `windowSize` entries.
- `evaluateFusedQrPose(entries, options?, previous?) -> QrFusedPose`:
  - `status`: `unknown` (no entries), `measuring`, `stable`;
  - `pose`, `method` (`joint` | `averaged` | null);
  - `views`, `droppedViews` (from the joint solve), `fitPx` (the MEDIAN of
    the used views' own corner errors), `windowEntries`,
    `averagedRotationDeltaDeg` (joint vs averaged, a diagnostic).
  - `previous` is the last result for the same code: it makes the gate and
    the method sticky (hysteresis).
- `createFusedQrPoseTracker(options?)` -> `{ evaluate(entries), reset() }`:
  caches on the entries ARRAY identity and carries the previous result.
- Options (defaults; the thresholds are PROVISIONAL until the b1 sweep):
  `windowSize` 8, `gapMs` 4000, `radiusM` Infinity (off), `minViews` 5,
  `maxFitPx` 1.5, `fallbackFitPx` 3, `hysteresis` 1.5, `sizeM` 0.16 (only
  for the position when no entry has a raw pose - the rotation does not
  depend on the size), `solveOptions`, `solve` (injectable, for tests).

## Invariants & assumptions

- **Method:** joint when the solve returns a result and `fitPx <=
fallbackFitPx` (or `<= fallbackFitPx x hysteresis` if the previous result
  was joint); else averaged over the window's raw poses.
- **Gate:** `stable` when the method is joint, the solve used at least
  `minViews` views, and `fitPx <= maxFitPx` (or `<= maxFitPx x hysteresis`
  if the previous result was stable). The median makes one bad corner or
  one bad view unable to trip it (plan §16 #6). Today's raw-spread gate
  (`evaluateQrPoseStability`) is NOT used (plan §17-§18: it stayed shut on
  ~93 % of near-frontal windows).
- **Position:** the median of the window's raw positions (today's), else
  the joint solve's mean position.
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
  - hysteresis;
  - the tracker solves once per new array and feeds its previous result.
- Planted bugs (2026-09-24): mean instead of median, no hysteresis, no
  cache, no epoch check, `>=` at the gap boundary, and always averaging each
  fail at least one test.
