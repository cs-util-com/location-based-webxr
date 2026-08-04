# `frame-loop.ts`

## Purpose

Tiny per-frame callback registry that lets components (alignment-lerper,
camera-follower, future `GpsAnchor` steady-state, …) plug into the WebXR
session's single `renderer.setAnimationLoop(...)` hook without each one
needing its own access to the loop. Designed in
[2026-05-13-ecs-migration-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-ecs-migration-plan.md)
to satisfy P4 of the C# port survey
([2026-05-07-csharp-features-not-yet-ported.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md)).

## Public API

- `type FrameUpdate = (dt: number, elapsed: number) => void` — the
  callback shape. `dt` is seconds since the previous frame (0 on the
  first tick after a reset); `elapsed` is seconds since the session
  started. Both come from the XR `time` argument, not `THREE.Clock`.
- `registerFrameUpdate(fn) → unregister` — add `fn` to the registry.
  Idempotent (Set dedup). Returns an unregister function components store
  and call from their `dispose()`.
- `runFrameUpdates(dt, elapsed)` — invoked by `webxr-session.ts`'s
  `onXRFrame` once per frame. **Internal**: not part of the public AR
  API surface; components don't call this.
- `clearFrameUpdates()` — drop every registration. Called from
  `resetWebXRState()` so a new session starts with an empty registry.
  **Internal**.

## Invariants & assumptions

- Plain functions, no class. There is exactly one frame loop per
  session; a class would only add ceremony.
- **The registry mechanics live in `utils/isolated-registry.ts`**, not here.
  This module is the frame loop's NAME, lifetime and public signature; the
  snapshot-and-isolate behaviour is shared with `xr-frame-loop.ts` and
  `session-disposers.ts`, which were structurally identical modules until the
  shape was extracted. Behaviour is pinned once, in
  `isolated-registry.test.ts`.
- `runFrameUpdates` snapshots the registry before iterating. A handler
  may safely register or unregister callbacks during its own tick; the
  change takes effect on the next frame. This removes a subtle
  non-determinism trap where iterating the live `Set` would skip a
  not-yet-visited entry that an earlier handler unregistered. The
  snapshot array is **cached** between registry mutations (2026-07-04,
  PR #67 review) — same deferral semantics, without re-allocating an
  identical array at 60–90 Hz.
- Each callback runs in its own `try/catch`. A throwing `FrameUpdate` is
  isolated (error logged via the shared registry's logger, which also reports
  to Sentry) so it cannot abort the remaining callbacks nor propagate up
  through `onXRFrame` and kill the scene render for the frame.
- The registry has no notion of priority or ordering beyond insertion
  order (Set iteration order in modern engines). Components MUST NOT
  depend on running before/after each other; if they do, the dependency
  belongs in a reconciler or a slice, not in tick ordering.
- `FrameUpdate` bodies must NOT dispatch Redux actions (do that in
  event handlers, not in the per-frame tick), must NOT reach into other
  components' internals, and must NOT use `THREE.Clock` for timing.

## Examples

```ts
import { registerFrameUpdate } from 'gps-plus-slam-app-framework/ar/frame-loop';

export function createCameraFollower(target: THREE.Object3D /* … */) {
  const update: FrameUpdate = (dt) => {
    // copy camera pose into target etc.
  };
  const unregister = registerFrameUpdate(update);
  return {
    dispose() {
      unregister();
    },
  };
}
```

## Tests

- [frame-loop.test.ts](frame-loop.test.ts) — covers the register/invoke/
  unregister contract, Set dedup, both directions of the
  snapshot-during-tick rule (register-during-tick deferred to next
  frame, unregister-during-tick deferred), empty-tick no-op, and
  `clearFrameUpdates`.
