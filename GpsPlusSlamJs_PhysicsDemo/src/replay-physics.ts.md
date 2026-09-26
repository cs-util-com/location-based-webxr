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
statsEl, onFrame, shadows?, shadowToggle?, shadowProbe? }`. The two
    dropdowns drive mesh-mode / shader; `onFrame` advances the perf panel each
    frame; `statsEl` shows `statsText` (`ball-status.ts`): "balls N (k
    resting, j fell through) · collider N tris · shadows on|off|unavailable".
  - `scheduler: FrameScheduler` — injectable `{ request, cancel }` around rAF
    (defaults to `requestAnimationFrame`/`cancelAnimationFrame`).
  - `factories: ReplayPhysicsFactories` — injectable `{ createOccupancyView,
createPhysicsRuntime }` (defaults to the real ones); the seam that keeps the
    test headless (no WebGL/Rapier).
  - **Returns** an **idempotent disposer**: stops the rAF loop, removes the
    pointer + dropdown listeners, releases the Shadows switch, removes the
    shadow probe, and disposes the shadows, the runtime and the occupancy
    view.
  - **The viewer** is the recorded phone pose (`scene.arpose`), or the
    probe's standing view once it has one: the shadow square follows it and
    the status line measures "fell through" from it. Never the orbit camera,
    which hangs 5-200 m above the room (the square would miss the floor and
    every resting ball read "fell through"; M1 review).
  - **AR shadows** (W4 plan 2026-09-26-0549 §11; round-2 plan 2026-09-26-2055
    M1): `factories.startDemoShadows` runs on the replay scene's renderer,
    fed the CURRENT occluder and the ball count, and updates after each
    physics step. It is started even with `?shadows=0` and then switched off
    (`bindShadowSwitch`), so the panel's switch never recompiles the lit
    materials mid-session. The replay renderer's own rAF draws a frame later,
    so on the desktop a flying ball's shadow can trail it by one frame; in AR
    it cannot.
  - **The shadow probe** (`controls.shadowProbe`, `?shadowProbe=1`, off in
    normal use): `shadow-probe.ts` on `window.__physicsShadowProbe`; its
    standing view becomes the camera the shadow square follows (the replay
    camera hangs about 200 m over the room).

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
- **Click vs. orbit drag (PR #198 review):** the canvas is shared with the
  replay scene's OrbitControls, so the shot fires on **pointerup**, and only
  when the pointer travelled ≤ `DRAG_THRESHOLD_PX` (5 px) since its
  pointerdown — a camera-orbit drag never spawns a ball. A stray pointerup
  without a preceding pointerdown is ignored.
- **Primary button only (PR #205 review):** OrbitControls pans with the right
  button and the browser owns the context menu, so both handlers ignore
  events with `button !== 0` — a stationary right-/middle-button click never
  shoots. Touch and pen contacts report `button === 0` and keep working.

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
  removes every listener, idempotently; click-to-shoot fires a ball on pointerup
  (never on bare pointerdown); an orbit drag (displaced pointerup) does not
  shoot; a stationary right-/middle-button click does not shoot (primary
  button only); the dropdowns drive the occupancy view. Factories + scheduler
  injected → no WebGL/Rapier.
