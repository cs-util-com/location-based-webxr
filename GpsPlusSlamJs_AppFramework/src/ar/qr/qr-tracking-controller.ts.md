# qr-tracking-controller.ts

**Purpose:** The reusable orchestration "brain" of the QR demonstrator —
Phase 6 of the [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
Wires front-end → level fetch → pose solve → GPS-vote bridge at a throttled,
coalesced cadence and exposes an async-status state machine for the UI.

## Public API

- `createQrTrackingController(config): QrTrackingController` — `offerFrame(image)`
  (call per render frame), read-only `status`, `reset()`.
- `QrTrackingStatus` = `idle | scanning | loading-level | tracking | error`.
- `QrTrackingControllerConfig` — injected `frontEnd`, `solvePose` (wraps
  `solveQrPose`), `fetchLevel`, `dispatchVotes`, `getCameraPose`,
  `getIntrinsics`, `syntheticAccuracyM`, optional `isPlausible` gate,
  optional `onDetection` (qrDetected emission), `resolveSizeM` (size when
  the level omits it — e.g. a depth-measured median), `resolveStablePose`
  (sliding-window filtered pose for the vote — e.g. `selectStableQrPose`),
  `onStatus`/`onLocked`/`onError`, and scheduler tuning
  (`minIntervalMs`, `requiredLockCount`, `now`).
  - `onRawDetection` — fires on every DECODE, before and independently of the
    solve, carrying the raw corners/pose/image-size. It exists so an app that
    must record raw observations whatever else happens (the recorder) gets
    them from ONE decode instead of running a second producer on the AR frame
    path.
  - `shouldCacheLevel(level)` — vetoes the per-URL level cache. See the status
    machine below; it is what makes a source's own retry policy reachable.
  - Both were undocumented here until 2026-08-30 (PR #378 review).
- `QrDetectionEvent` — `{ text, qrPoseWorld, qrPoseInCamera,
reprojectionErrorPx, timestamp, corners, cameraPose, imageWidth,
imageHeight }`, emitted via `onDetection` on every lock. The last four are
  the RAW facts behind the solve, carried so a consumer needing both a solved
  pose and a raw record does not decode twice; the projection matrix is
  deliberately absent, because this controller is given `getIntrinsics(image)`
  and never sees one. Structural (no import of the `qrDetected` state slice)
  so `ar` never depends on `state`; the app maps it onto
  `recordQrDetection`.

## Invariants & assumptions

- **Status machine:** `idle → scanning` on first frame; `loading-level` while a
  new URL's level is fetched — cached per URL, but **CONDITIONALLY**: the
  optional `shouldCacheLevel(level)` config decides, and a source that owns
  its own retry policy returns `false` for its placeholder so a transient
  failure is not cached for the session. Load-bearing, not a detail — the
  recorder's `qr-level-source` backoff is unreachable unless this cache can
  be declined (the sidecar said "once per URL — cached" unconditionally until
  2026-08-30, PR #378 review); `tracking` once the
  scheduler locks (≥ `requiredLockCount` consecutive solves) and votes are
  dispatched; `error` on a level fetch / detect rejection; a miss while
  `tracking` drops back to `scanning`. `onStatus` fires only on change.
- **One detection in flight** (the scheduler coalesces), so the closure
  `active` — `{ level, text, sizeM, corners, cameraPose, imageWidth,
imageHeight }`, seven fields, not the three this line claimed until
  2026-08-30 (PR #378 review) — set during `detect` is the correct context
  read by `onLocked`.
- **The solve uses the DECODE-TIME pose sample, not a fresh one taken after the level fetch**
  (PR #379 review). `detection.corners` come from `image`, and
  `qrPoseWorld` is `cameraPose o qrPoseInCamera`, so the two must describe
  the same instant. The solve used to call `getCameraPose()` a SECOND time,
  after `await ensureLevel(...)` - and on a code's first sighting that await
  is a real network round trip, so the code was anchored wherever the phone
  had moved to. It also let the raw record and the solved pose describe one
  detection with two different poses. Both now use the single decode-time
  sample; a detection whose frame had no pose is dropped rather than solved
  against a later one.
  - **It is not "the pose at the frame", and the wording matters** (PR #380
    review, correcting this bullet). `rawCameraPose` is read AFTER
    `await frontEnd.detect(image)`, so it still trails the frame the corners
    came from by one decode latency - the same class of error as the one
    removed, roughly three orders of magnitude smaller. `RgbaImage` carries
    no timestamp or pose and `offerFrame` passes only the image, so closing
    it is a seam change: see
    [2026-08-30-0620-qr-pose-frame-pairing-followup.md](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-30-0620-qr-pose-frame-pairing-followup.md).
- **Size lifecycle gate (Note 3):** the solve needs a size. Order: the level's
  authored `physicalSizeM`, else `resolveSizeM(text, level)` (e.g. a measured
  median). A `null`/absent size — OR a degenerate measured one (≤ 0, `NaN`,
  `Infinity`, which `resolveSizeM` can yield before it converges) — BLOCKS the
  solve (stays `scanning`) — no pose, no detection, no vote — until a valid size
  is authored or measured-and-locked. Degenerate sizes are gated here rather than
  left to crash `buildObjectPoints` (RangeError) and wedge the controller in
  `error`.
- **qrDetected emission is unconditional; the vote is conditional on `geo`**
  (Note 3). Every lock fires `onDetection`; `buildQrGpsVotes` (4-corner
  multi-correspondence) runs **only** when `level.qr.geo` is present, so geo-less
  levels (debug/observe, trigger, AR-root-anchored spawn) emit the detection but
  cast no vote.
- **Pose-stability gate (sliding-window stabilization):** when `resolveStablePose`
  is wired, the vote is built from the FILTERED pose and is SKIPPED until it
  converges (`null`) — the detection is still emitted, only the vote waits. The
  `onDetection` emission runs **before** the vote and feeds this frame's raw pose
  into the slice synchronously, so `resolveStablePose` reads a window that already
  includes the current frame. Without a resolver, the raw solve pose drives the
  vote (back-compat). See
  [2026-06-16-0858-qr-pose-stabilization-sliding-window-followup.md](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-0858-qr-pose-stabilization-sliding-window-followup.md).
- **Fully injected** (front-end, solve, fetch, dispatch, camera/intrinsics
  accessors, clock) → no WASM, device, or store needed to test. Production wires
  `solvePose` to `solveQrPose({...input, solver: new PlanarPnpSquare()})`,
  `fetchLevel` to `fetchQrLevel`, `dispatchVotes` to `recordGpsEvent`, and
  optionally `isPlausible` to `checkQrPlausibility`.

## Tests

- `qr-tracking-controller.test.ts` — happy-path status progression + 4 votes
  dispatched, level cached once per URL, error path on fetch failure, stays
  scanning on no-detection, plausibility gate blocks the lock, `reset()` clears
  cache + returns to idle; qrDetected emitted on every lock, geo-less level
  emits detection but no vote, size gate blocks the solve when unknown, a
  `resolveSizeM`-supplied size unblocks it, the vote uses the `resolveStablePose`
  filtered pose, and the vote is skipped (detection still emitted) until stable.

## Related

- Composes [qr-frontend.ts.md](qr-frontend.ts.md), [qr-pose.ts.md](qr-pose.ts.md),
  [qr-level.ts.md](qr-level.ts.md), [qr-gps-vote.ts.md](qr-gps-vote.ts.md),
  [detection-scheduler.ts.md](detection-scheduler.ts.md), and optionally
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md). Consumed by the Recorder
  demonstrator (Phase 6c).
