# replay-physics.ts

## Purpose

Owns the desktop-replay physics lifecycle behind a single disposer: for a loaded
recording it builds the occupancy view (occlusion **and** collider), the shared
physics runtime, the rAF step loop and click-to-shoot, and returns a teardown
that stops the loop and frees every resource + listener. Extracted from
`main.ts` so the leak-prone lifecycle logic is unit-testable (the DOM glue stays
in `main.ts`).

## Public API

- **`startReplayPhysics(session, controls, scheduler?, factories?): () => void`**
  - `session: ReplaySessionController` — the live replay (reads `getScene()` +
    `getStore()`).
  - `controls: ReplayPhysicsControls` — `{ meshStyleSelect, meshShaderSelect,
statsEl, onFrame }`. The two dropdowns drive mesh-mode / shader; `onFrame`
    advances the perf panel each frame; `statsEl` shows `balls N · collider N tris`.
  - `scheduler: FrameScheduler` — injectable `{ request, cancel }` around rAF
    (defaults to `requestAnimationFrame`/`cancelAnimationFrame`).
  - `factories: ReplayPhysicsFactories` — injectable `{ createOccupancyView,
createPhysicsRuntime }` (defaults to the real ones); the seam that keeps the
    test headless (no WebGL/Rapier).
  - **Returns** an **idempotent disposer**: stops the rAF loop, removes the
    pointer + dropdown listeners, and disposes the runtime + occupancy view.

## Invariants & assumptions

- The disposer is safe to call with no active replay and safe to call twice — a
  `disposed` guard makes the second call a no-op, so `main.ts` can call it
  unconditionally before starting the next replay.
- The step loop reads an `active` flag **before** stepping, so a straggler frame
  already queued when the disposer runs is a no-op — the runtime's Rapier world is
  never stepped after `runtime.dispose()` freed it (the PR #197 "critical" crash).
- `pointerToNdc` is deep-imported from
  `gps-plus-slam-app-framework/visualization/pointer-picking` (not the `visualization`
  barrel) so the node-env unit test does not pull the leaflet-bound map exports.

## Examples

```ts
const dispose = startReplayPhysics(controller, {
  meshStyleSelect,
  meshShaderSelect,
  statsEl,
  onFrame: () => perfStats.update(),
});
// …on reload or teardown:
dispose();
```

## Tests

- `replay-physics.test.ts` — steps + re-arms each active frame; the disposer stops
  the loop (straggler frame is a no-op), frees runtime + occupancy view, and
  removes every listener, idempotently; click-to-shoot fires a ball; the dropdowns
  drive the occupancy view. Factories + scheduler injected → no WebGL/Rapier.
