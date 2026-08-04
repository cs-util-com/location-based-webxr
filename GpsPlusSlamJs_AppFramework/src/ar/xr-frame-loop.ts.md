# `xr-frame-loop.ts`

## Purpose

The public, frame-scoped **XR-access** seam (§6.3, option H-A2). Lets app code
run standard per-frame WebXR work — hit-test, light estimation, depth, the WebXR
Anchors API — as ordinary three.js, while the framework keeps ownership of the
single `renderer.setAnimationLoop(onXRFrame)` hook. Parallels `frame-loop.ts`
(`registerFrameUpdate`, which passes only `dt`/`elapsed`) but additionally hands
the callback the live `frame`, `referenceSpace`, and `session`.

## Public API

- `registerXrFrameUpdate(fn: XrFrameUpdate): () => void` — register a per-frame
  XR-access callback; returns an unregister function. Idempotent (Set dedup).
- `runXrFrameUpdates(ctx: XrFrameContext): void` — invoke all registered
  callbacks with the live context. Called by `webxr-session`'s `onXRFrame` once
  per frame, **only** when `frame` + `referenceSpace` + `session` are all
  available. Snapshots the registry so register/unregister during a tick is
  deferred to the next frame.
- `clearXrFrameUpdates(): void` — drop all registrations (called from
  `resetWebXRState()`).
- `XrFrameContext` — `{ frame, referenceSpace, session, dt, elapsed }`.
- `XrFrameUpdate` — `(ctx: XrFrameContext) => void`.

## Invariants & assumptions

- **Frame-scoped validity (the one non-negotiable):** `frame` /
  `referenceSpace` / `session` are valid **only synchronously inside the
  callback**. The `XRFrame` is use-after-frame-unsafe; never stash `ctx` or its
  fields for a later tick. The API deliberately exposes no `getXrFrame()` getter
  so the stashing hazard is awkward to reach.
- **The registry mechanics live in `utils/isolated-registry.ts`.** This module
  contributes the `XrFrameContext` type and the safety contract around it;
  the snapshot-and-isolate behaviour is shared with `frame-loop.ts` and
  `session-disposers.ts` and pinned in `isolated-registry.test.ts`.
- Snapshot-during-tick semantics match `frame-loop.ts`: handlers that
  register/unregister mid-tick take effect next frame.
- Each callback runs in its own `try/catch`. As the public app seam, a buggy
  app-registered callback that throws every frame must not abort the remaining
  callbacks nor propagate up through `onXRFrame` and stop the scene render;
  failures are logged (and reported to Sentry) and the loop continues.
- Pose-free periodic work should keep using `registerFrameUpdate` (`dt`/`elapsed`
  only); this registry is for handlers that genuinely need the live frame.
- **Coordinate frames:** hit-test results are AR-local — place produced content
  under `arWorldGroup` (or a `createGpsAnchor`), never `scene`.

## Examples

```ts
import { registerXrFrameUpdate } from 'gps-plus-slam-app-framework/ar';

let hitTestSource: XRHitTestSource | null = null;
registerXrFrameUpdate(({ frame, referenceSpace, session }) => {
  if (!hitTestSource) {
    void session
      .requestReferenceSpace('viewer')
      .then((viewer) => session.requestHitTestSource?.({ space: viewer }))
      .then((src) => (hitTestSource = src ?? null));
    return;
  }
  const hits = frame.getHitTestResults(hitTestSource);
  const pose = hits[0]?.getPose(referenceSpace); // valid only this frame
  // …position the reticle from pose…
});
```

## Tests

- `xr-frame-loop.test.ts` — idempotent register, real unregister, context
  identity forwarding (frame/referenceSpace/session), snapshot-during-tick,
  empty-registry no-op, and `clearXrFrameUpdates`.
- Integration with the live loop is covered indirectly by `webxr-session` tests
  that drive `onXRFrame`.
