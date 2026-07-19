# `enable-gps-ar.ts` — headless "Enable GPS AR" seam

## Purpose

The reusable permission/enter-AR **orchestration** an app's "Enable GPS AR"
button drives (Decision B3). It composes the framework's existing building
blocks — WebXR support check, the individual permission requesters, the
GPS/orientation watches and `initAR` — into one in-gesture sequence with an
observable status. The app renders its **own** `<button>` over the state; the
framework does not own button DOM (unlike three.js' `ARButton`).

## Public API

- `createEnableGpsArController(deps?: Partial<EnableGpsArDeps>) => EnableGpsArController`
  - `getState(): EnableGpsArState` — `{ status, error? }`.
  - `subscribe(listener) => unsubscribe` — state-change notifications.
  - `refreshSupport(): Promise<void>` — `checking → ready | unsupported`.
  - `enable(config: EnableGpsArConfig): Promise<EnableGpsArResult>` — the
    in-gesture orchestration; returns `{ ok, error? }`.
  - `disable(): Promise<void>` — teardown: stop watches, end session,
    `running → stopping → ready`. No-op when not `running`.
- Types: `EnableGpsArStatus`, `EnableGpsArState`, `EnableGpsArConfig`,
  `EnableGpsArResult`, `EnableGpsArDeps`, `EnableGpsArController`.
- `EnableGpsArConfig.callbacks?: ArSessionCallbacks` — the per-session AR
  callbacks (tracking store, depth, image capture, `onFrame`, `onSessionEnd`)
  forwarded as `initAR`'s 4th argument. Since the framework folded its
  pre-init setter exports into `initAR` (surface-reduction step 1), this option
  is the ONLY way controller-driven apps wire those callbacks. Every field
  reaches `initAR` unchanged **except `onSessionEnd`, which the controller
  wraps** (see "Session-end awareness" below); the app's own callback is
  always chained.

### `EnableGpsArStatus`

`checking → ready → starting → running` on success; `running → stopping → ready`
on teardown; any failure routes to `error`; an unsupported probe routes to
`unsupported`. A session that ends **externally** (system back gesture, or a
direct framework `endARSession()` call) while `running` also returns the
controller to `ready` — see "Session-end awareness".

## Invariants & assumptions

- **Session-end awareness (2026-07-18, simplify-loop Area 4b):** `enable()`
  wraps `config.callbacks.onSessionEnd` before forwarding to `initAR`, so the
  controller observes the session ending on every path. While `running`, the
  wrapper stops the started watches and transitions to `ready` — without this
  a system back gesture left the status stuck at `running` (the app's button
  dead-ended at "AR running") and the GPS/orientation watches kept running.
  In any other status the wrapper is inert: the `enable()` rollback (during
  `starting`) and `disable()` (during `stopping`) already own their teardown.
  The app's own `onSessionEnd` is always chained, whatever the status. The
  controller never calls `endARSession` from the wrapper — the session is
  already gone.
- **Minimal default permission set:** the default path requests only WebXR
  support + geolocation + orientation. `requestWebXRWithDepthPermission` is
  called **only** when `config.requestDepth === true`. The seam never calls
  `requestAllPermissions()` (which would also probe depth _and_ camera).
- **Required vs. best-effort:** geolocation (and depth, when opted in) are
  blocking — a non-`granted` status routes to `error` and `initAR` is never
  reached. Orientation is best-effort: a denial is ignored (the compass simply
  degrades; we still request it so iOS prompts inside the gesture).
- **Async UX rule:** `enable()` always passes through the transitional
  `starting` state before the durable `running`/`error` final state, on both the
  success and the denied path. `disable()` likewise passes through `stopping`
  before reaching `ready`. Tests assert this ordering for both directions.
- **Idempotency:** `enable()` is a no-op (returns `{ ok: false }`) while the
  status is `starting`, `running`, or `stopping`, so a double-tap cannot start
  two sessions and an enable during teardown is blocked.
- **Active-session guard:** `refreshSupport()` returns immediately (no probe, no
  `setState`) when the status is `starting`, `running`, or `stopping`. A
  resume/visibility `refreshSupport()` over an active or tearing-down session
  would otherwise enter `checking` and clobber the live state.
- **Stale-probe guard:** once past the active-session guard, `refreshSupport()`
  awaits the support probe, then applies `ready`/`unsupported` **only if** the
  status is still `checking`. This covers a concurrent `enable()` (not blocked
  from `checking`) that advances the status _during_ the probe, so the late probe
  result cannot clobber the new active state.
- **Watches tracked per cycle:** the controller tracks which sensor watches
  (`gpsWatchActive`, `orientationWatchActive`) were started in each `enable()`
  cycle and stops only those in `disable()`. Watches that were not started are
  never stopped, and the tracking is reset each cycle.
- **Watches start after `initAR`:** the sensor watches are started **only after**
  `initAR` resolves. Starting them before `initAR` would leak active watches on
  an `initAR` rejection and let a retry from `error` start duplicates. Gating
  the start calls behind the resolved `initAR` bounds watcher count to one set
  per running session.
- **Error-path rollback:** if a sensor-watch start throws **after** `initAR` has
  already started the XR session, `enable()`'s `catch` tears down what was
  started — stops any started watch and calls `endARSession()` — before routing
  to `error`. Without this the session + watch would strand, because `disable()`
  only runs from `running` and a retry from `error` re-enters `enable()` without
  cleaning up first (so the leak would accumulate). A failure **before** `initAR`
  (e.g. a permission denial) starts no session, so nothing is torn down. Each
  rollback step (`stopGpsWatch`, `stopOrientationWatch`, `endARSession`) is
  wrapped in its **own** try/catch, so a throw in one cannot bypass the others —
  most importantly `endARSession`, whose skip would strand the WebXR session.
- **Teardown resilience:** `disable()` catches and logs `endARSession` rejections
  (e.g. session already ended externally) and still transitions to `ready`, so a
  failing teardown cannot strand the controller in `stopping`.
- **In-gesture requirement:** `enable()` must be called synchronously from a
  user gesture so the permission prompts are allowed by the browser.
- **DI:** every collaborator is injectable; defaults bind to the real framework
  functions (`isWebXRSupported`, `requestGeolocationPermission`,
  `requestOrientationPermission`, `requestWebXRWithDepthPermission`,
  `startGpsWatch`, `startOrientationWatch`, `initAR`, `stopGpsWatch`,
  `stopOrientationWatch`, `endARSession`). This keeps the orchestration
  unit-testable without WebXR/GPS hardware or a DOM.
- **Listener isolation:** `setState` dispatches over a snapshot and wraps each
  subscriber in try/catch (logging via `createLogger('EnableGpsAr')`), so one
  throwing subscriber cannot abort the dispatch or interrupt the
  `refreshSupport()`/`enable()`/`disable()` transition that drives it.
- Uses the `PermissionStatus`-returning `requestOrientationPermission` from
  `sensors/permission-checker.ts`, **not** the legacy `boolean`-returning one in
  `sensors/gps.ts` (plan §6.1 disambiguation).

## Examples

```ts
import { createEnableGpsArController } from 'gps-plus-slam-app-framework/ar';

const controller = createEnableGpsArController();
await controller.refreshSupport();

button.disabled = controller.getState().status !== 'ready';
button.addEventListener('click', () => {
  void controller.enable({
    container: document.getElementById('app')!,
    requestHitTest: true,
    onGpsPosition: (p) => store.dispatch(/* … */),
  });
});
controller.subscribe((s) => {
  button.textContent = s.status === 'starting' ? 'Starting…' : 'Enable GPS AR';
});

// A session end (system back gesture, external endARSession) is observed by
// the controller itself: it stops the watches and returns to `ready`, so the
// subscribe() listener above re-renders the button as a fresh CTA. Apps that
// need their own end-of-session work pass callbacks.onSessionEnd — it is
// chained, not replaced.
```

## Tests

`enable-gps-ar.test.ts` covers: support probe (`ready`/`unsupported`/throwing),
minimal default set (depth NOT probed), `requestHitTest` forwarding, depth opt-in,
geolocation-denied error (no `initAR`), orientation-denied proceed, depth-denied
error, `initAR` rejection, the `starting → running` and `starting → error`
transitional ordering, idempotency (running + still-starting), unsubscribe
hygiene, listener isolation (a throwing subscriber does not abort dispatch or
the controller's own flow), and the full `disable()` teardown: `stopping → ready`
transition, selective watch stop (only watches that were started), `endARSession`
call, no-op when not running, re-entry after disable, resilience to
`endARSession` rejection, `enable()`/`refreshSupport()` blocked during
`stopping`, concurrent `disable()` idempotency, and per-cycle watch tracking.
The "session end (system or external)" describe block covers the session-end
awareness: external end → `ready` + watches stopped + re-entry works, app
callback chaining, no double-stop during `disable()`, and the rollback path's
`error` state surviving the end event.

## Related

- Plan: `GpsPlusSlamJs_Docs/docs/2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md`
  §5 Step 1, §6.1, §6.5.
- [webxr-session.ts](./webxr-session.ts) — `initAR`, `endARSession`,
  `isWebXRSupported`, `SessionFeatureOptions`.
- [gps.ts](../sensors/gps.ts) — `startGpsWatch`, `startOrientationWatch`,
  `stopGpsWatch`, `stopOrientationWatch`.
- [permission-checker.ts](../sensors/permission-checker.ts) — the permission requesters.
