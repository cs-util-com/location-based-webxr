# hit-test-reticle-driver.ts

- **Purpose:** the per-frame WebXR plumbing that drives the screen-centre
  hit-test reticle — request the hit-test source, read
  `frame.getHitTestResults(...)` each frame, feed the pose to the pure
  view-model (`visualization/hit-test-reticle.ts`), and report taps. Promoted
  2026-07-18 from three drifting app-local copies (MinimalExample,
  WayfindingHudDemo, AnchorStarter — the latter was the reference
  implementation).

## Public API

- `startHitTestReticle({ arWorldGroup, onSelect? }): HitTestReticleHandle` —
  parents a new reticle mesh under `arWorldGroup` and registers with
  `registerXrFrameUpdate` (`ar/xr-frame-loop`).
  - `arWorldGroup` — pass `getArWorldGroup()` so the reticle rides the GPS
    alignment; its world pose is then GPS-world (NUE).
  - `onSelect?(worldPosition: Vector3 | null)` — fired on EVERY WebXR
    `select` (tap): the reticle's world position when a surface is present,
    `null` when not. Surface-less taps are reported so GPS gating /
    "point at the floor" hints stay app-side decisions. When omitted, no
    `select` listener is registered.
- `HitTestReticleHandle` — `isVisible()`, `getWorldPosition(out)` (only
  meaningful while visible), `dispose()` (idempotent: cancels the live
  source, removes the session listeners and the mesh, unregisters the frame
  callback).

## Invariants & assumptions

- **Listeners once per session:** the `'end'` (and optional `'select'`)
  listeners are registered outside the request-retry path, so a transient
  `requestHitTestSource` failure can never stack duplicates.
- **In-flight-request hygiene (session generation guard):** a source that
  resolves after `dispose()` — or after the session that issued the request
  ended — is cancelled, never adopted (it would shadow the next session's own
  source). A late _failure_ from an ended session's request does not reset
  the retry flag under the next session (no duplicate concurrent request).
  Both were latent bugs in the app-local copies, fixed at promotion.
- **Tolerant teardown:** `cancel()` on a dead session may throw
  (`dispose()` can run from an app teardown path before this driver's own
  `'end'` listener fires); `cancelSource` swallows that — the dead session
  already stopped the hit-test.
- **Session-end reset:** `'end'` clears the source, the request flag and the
  stored listener-removal closure, so a fresh session re-requests with its
  own listeners. In the framework's standard flow `resetWebXRState()` clears
  the XR frame registry at session end, so a handle is typically created once
  per AR session entry and disposed from the app's teardown path; the reset
  logic additionally keeps the handle correct when frames are delivered
  outside that flow (tests, custom loops).
- **Older runtimes:** when `session.requestHitTestSource` is absent the
  reticle simply stays hidden; nothing throws.
- The reticle mesh/pose math (WebXR→NUE basis change, `matrixAutoUpdate`
  handling) lives entirely in `visualization/hit-test-reticle.ts`.

## Examples

```ts
// Tap-to-place app:
const handle = startHitTestReticle({
  arWorldGroup: getArWorldGroup()!,
  onSelect: (worldPosition) => {
    if (!worldPosition) return showHint('Point the camera at the floor.');
    place(worldPosition);
  },
});
// Button-driven app (no onSelect): read the handle at press time.
if (handle.isVisible()) place(handle.getWorldPosition(new Vector3()));
// From the app's session-teardown path:
handle.dispose();
```

## Tests

- [hit-test-reticle-driver.test.ts](hit-test-reticle-driver.test.ts) —
  lifecycle (listeners once per session, cross-session re-registration,
  dispose semantics), the three in-flight-request races, reticle driving
  through the real view-model (NUE pose check), and `onSelect` nullable-tap
  semantics. The XR frame loop is mocked to hand the tests the raw callback;
  three.js objects are real.
- [hit-test-reticle-driver.property.test.ts](hit-test-reticle-driver.property.test.ts)
  — fast-check property driving arbitrary interleavings of ticks, request
  settlements, session ends, taps and dispose; asserts listener/request
  discipline and source-cancellation hygiene under every ordering.
- The actual on-device hit-test behavior remains manually verified via
  `pnpm dev` in the consumer apps (device-only WebXR).
