# qr-tracking-controller.ts

**Purpose:** The reusable orchestration "brain" of the QR demonstrator —
Phase 6 of the [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
Wires front-end → level fetch → pose solve → GPS-vote bridge at a throttled,
coalesced cadence and exposes an async-status state machine for the UI.

## Public API

- `createQrTrackingController(config): QrTrackingController` — `offerFrame(frame: CapturedCameraFrame)`
  (call per captured frame; the frame carries its own capture pose and time, see
  [captured-camera-frame.ts.md](../captured-camera-frame.ts.md)), `isBusy()` (true while a detect - including a first-sighting level fetch - is in flight; the camera source's capture veto), read-only `status`, `reset()`.
- `QrTrackingStatus` = `idle | scanning | loading-level | tracking | error`.
- `QrTrackingControllerConfig` — injected `frontEnd`, `solvePose` (wraps
  `solveQrPose`), `fetchLevel`, `dispatchVotes`,
  `getIntrinsics`, `syntheticAccuracyM`, optional `isPlausible` gate,
  optional `onDetection` (qrDetected emission), `resolveSizeM` (size when
  the level omits it — e.g. a depth-measured median), `resolveStablePose`
  (sliding-window filtered pose for the vote — e.g. `selectStableQrPose`),
  `onStatus`/`onLocked`/`onError`, and scheduler tuning
  (`minIntervalMs`, `requiredLockCount`, `now`). There is no `getCameraPose`
  any more (removed in QR perf plan 2026-09-23, M4): the pose comes with the
  frame.
  - `onRawDetection` — fires on every DECODE, before and independently of the
    solve, carrying the raw corners/pose/image-size; its `cameraPose` is
    `frame.cameraPose` and its `timestamp` is `frame.capturedAtMs`. It exists so an app that
    must record raw observations whatever else happens (the recorder) gets
    them from ONE decode instead of running a second producer on the AR frame
    path.
  - `shouldCacheLevel(level)` — vetoes the per-URL level cache. See the status
    machine below; it is what makes a source's own retry policy reachable.
  - Both were undocumented here until 2026-08-30 (PR #378 review).
- `QrDetectionEvent` — `{ text, qrPoseWorld, qrPoseInCamera,
reprojectionErrorPx, timestamp, corners, cameraPose, imageWidth,
imageHeight, intrinsics, orderSource? }`, emitted via `onDetection` on every lock.
  `orderSource` is the front end's `QrDetection.orderSource` when it says
  (QR near-frontal pose plan §54-§55: the fused window ignores a `native`
  detection of a code whose order is known). Its `timestamp` is
  the lock time (`now()`), not the frame's capture time. `intrinsics` are
  those `getIntrinsics(image)` returned for the solve - REQUIRED since M3b
  b3 (QR near-frontal pose plan), because the fused QR window re-solves the
  corners of several detections jointly and a producer that left them out
  would silently fall back to averaging. The corners, pose and image size are
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
imageHeight, intrinsics }`, eight fields (seven until M3b b3; the line
  claimed three until 2026-08-30, PR #378 review) — set during `detect` is the correct context
  read by `onLocked`.
- **The solve and the raw record use the FRAME's pose - the camera pose of
  the XR frame the pixels were captured in** (`frame.cameraPose`). `detection.corners`
  come from `frame.image`, and `qrPoseWorld` is `cameraPose o qrPoseInCamera`,
  so the two must describe the same instant.
  - History: the solve once called `getCameraPose()` a SECOND time, after
    `await ensureLevel(...)` - on a code's first sighting a real network round
    trip, so the code was anchored wherever the phone had moved to, and the raw
    record and the solved pose disagreed about one detection (PR #379 review).
    The fix used one decode-time sample for both, which still trailed the frame
    by one decode latency because it was read after `await frontEnd.detect`
    (PR #380 review).
  - **Closed by QR perf plan 2026-09-23, M4:** the session pairs each frame
    with its pose at capture (`CapturedCameraFrame`), `getCameraPose` is gone
    from the config, and nothing is read after an `await`. The session does not
    deliver a frame without a pose, so there is no "pose unavailable" skip here
    any more. See
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
- **Fully injected** (front-end, solve, fetch, dispatch, intrinsics
  accessor, clock; the camera pose arrives with each frame) → no WASM, device, or store needed to test. Production wires
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
  filtered pose, and the vote is skipped (detection still emitted) until stable;
  the solve and the raw record use the frame's capture pose and `capturedAtMs`
  (M4); `isBusy()` spans the detect and its level fetch (M3).

## Related

- Composes [qr-frontend.ts.md](qr-frontend.ts.md), [qr-pose.ts.md](qr-pose.ts.md),
  [qr-level.ts.md](qr-level.ts.md), [qr-gps-vote.ts.md](qr-gps-vote.ts.md),
  [detection-scheduler.ts.md](detection-scheduler.ts.md), and optionally
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md). Consumed by the Recorder
  demonstrator (Phase 6c).
