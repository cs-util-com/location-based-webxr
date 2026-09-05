# detection-scheduler.ts

**Purpose:** A **generic** throttle + coalesce + N-consecutive-lock state machine
over any async detector — Phase 2 / §9 + research2 runtime stability of the
[QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md),
generalized per **Note 1** of the
[follow-up plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md)
so a future object detector (YOLO) reuses it unchanged. It gates nothing on QR.

## Public API

- `createDetectionScheduler<TResult, TImage = RgbaImage>(config): DetectionScheduler<TImage>`
  — `offerFrame(image)` (call per render frame), plus read-only `inFlight`,
  `consecutiveLocks`, `locked`.
- `DetectionSchedulerConfig<TResult, TImage>` — `detect(image) => Promise<TResult|null>`
  (the injected detect→solve step), `minIntervalMs`, `requiredLockCount` (3),
  `now` (injectable clock), `onLocked(result)`, `onMiss`, `onError`.
- **The QR path instantiates the generic directly** with `TResult = QrPoseSolution`
  (`qr-detection-controller.ts`, `qr-tracking-controller.ts`). The former
  `createQrDetectionScheduler` / `QrDetectionScheduler` / `QrDetectionSchedulerConfig`
  aliases were removed 2026-09-04 (simplify loop): nothing but their own tests used
  them. A MAJOR by semver (they were on the `/ar/qr` barrel), shipped in 1.24.0 - a MINOR by owner decision, in lock-step with `gps-plus-slam-js` 1.24.0; the changelog's Breaking section carries it.

## Invariants & assumptions

- **Throttle:** at most one detection START per `minIntervalMs` (100 ms ≈ 10 Hz);
  the first frame always passes (`lastStart = −∞`).
- **Coalesce:** `offerFrame` is a no-op while `inFlight` — stale frames are
  dropped, not queued, so the heavy WASM solve never backs up.
- **Lock gate:** `consecutiveLocks` increments on success (capped at
  `requiredLockCount`), resets to 0 on a miss or a rejected `detect`. `onLocked`
  fires on every success once `locked` (so a locked detection keeps voting —
  fresh, time-decayed votes per §12), `onMiss`/`onError` on the respective settle.
- **Callback isolation:** `onLocked`/`onMiss`/`onError` are user code; each is
  invoked inside its own `try/catch` (errors logged, not rethrown). A throwing
  `onLocked`/`onMiss` therefore cannot fall through to the `.catch` (which would
  wrongly reset `consecutiveLocks` and fire `onError`, making the lock flap and
  misreporting a callback bug as a detection failure); a throwing `onError`
  cannot become an unhandled rejection. The scheduler's own state stays correct
  regardless of what the callbacks do.
- **`detect` failures never wedge the scheduler:** `inFlight` is set true before
  `detect` is called, so a **synchronous** throw (one that escapes before the
  promise is returned — e.g. a dead-worker transport or a sync precondition
  check) is wrapped into a rejection and handled exactly like an async rejection:
  `onError` fires, the counter resets, and `inFlight` is cleared. Without this,
  the lone synchronous-throw path would leave `inFlight` stuck true and silently
  block all future detections. `offerFrame` therefore never throws to the XR
  frame loop, and `detect` is still invoked synchronously within the offering tick.
- **Transport-agnostic, device-free, detection-agnostic:** `detect` and the clock
  are injected; the result and frame types are generic. The same scheduler drives
  a worker-hosted or main-thread pipeline and is fully deterministic in tests.

## Tests

- `detection-scheduler.test.ts` — throttle, coalesce, lock-after-N + cap +
  miss-reset, error-resets + clears in-flight, **synchronous-throw recovery**
  (offerFrame does not throw, inFlight clears, scheduler stays usable),
  **callback isolation** (a throwing `onLocked`/`onMiss` does not reset the
  counter or fire `onError`) (via the QR specialization); plus a generality test
  proving a non-QR result type + custom frame type work.

## Related

- Drives [qr-frontend.ts.md](qr-frontend.ts.md) + [qr-pose.ts.md](qr-pose.ts.md)
  (`solveQrPose`) + [planar-pnp.ts.md](planar-pnp.ts.md); locked solutions feed
  the occupancy self-check ([qr-occupancy-check.ts.md](qr-occupancy-check.ts.md))
  and the GPS-vote bridge ([qr-gps-vote.ts.md](qr-gps-vote.ts.md)). Consumed by
  [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
