# perf-stats-overlay.ts

## Purpose

Wraps mrdoob's Stats.js (bundled with three as `three/addons/libs/stats.module.js`, no extra dependency) into a side-by-side FPS / frame-ms / MB panel row any consumer can mount. Stock Stats.js shows one panel and cycles on tap — unusable at a glance mid-session — so one Stats instance is mounted per panel and laid out in a flex row. Shared framework home for what used to be two near-identical app copies (the recorder's optional debug toggle and the physics demo's always-on harness); whether to show the overlay at all is the caller's decision, not this module's.

## Public API

- `createPerfStatsOverlay(parent, options?) → PerfStatsOverlayHandle`
  - `parent: HTMLElement` — host element. In live AR this must be (inside) the WebXR dom-overlay root or the panels cannot composite over the camera view. Throws `TypeError` for a non-element (fail fast: a silent no-op overlay would hide the framerate it exists to show).
  - `options.statsFactory?: () => PerfStatsInstance` — injected Stats constructor; default `new Stats()` from `three/addons`. Tests inject fakes (the real one builds a `<canvas>` 2D context).
  - `options.memorySupported?: boolean` — override for the `performance.memory` probe (Chrome-only API). Default: probed live.
  - `options.createContainer?: () => HTMLElement` — injected container factory; default `document.createElement('div')`. Inject in node tests (or any host without a DOM) so no jsdom is required — this is what keeps the module's own test jsdom-free.
- `PerfStatsOverlayHandle`
  - `dom: HTMLElement` — the mounted container (flex row, top-right, class `perf-stats-overlay`, `pointer-events: none`).
  - `panelCount: number` — 3, or 2 when `performance.memory` is unavailable (MB panel omitted).
  - `update(): void` — advance all panels one frame; call once per rendered frame. No-op after dispose; a throwing panel is isolated (never breaks the render loop).
  - `dispose(): void` — remove the container. Idempotent.
- `PerfStatsInstance` — the `{ dom, showPanel, update }` subset of Stats.js the overlay drives (the test-fake contract).

## Invariants & assumptions

- Read-only instrument: `pointer-events: none` so it never swallows a pointer meant for the scene or the HUD sharing the AR dom-overlay layer; panels sit top-right.
- Each Stats instance's `position:fixed` inline style is overridden to `relative` so the flex row can lay them out.
- The `perf-stats-overlay` container class is a stable devtools hook only — no CSS keys off it (all styling is inline `cssText`).
- Callers own lifecycle and cadence: call `update()` once per rendered frame from a rAF loop or the XR frame callback, and `dispose()` on session teardown. A leaked handle would stack duplicate panels across Enter-AR cycles.
- MB numbers come from `performance.memory` — coarse, Chrome-only; a trend indicator, not a measurement.

## Examples

```ts
import { createPerfStatsOverlay } from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';

const overlay = createPerfStatsOverlay(document.getElementById('app')!);
renderer.setAnimationLoop(() => {
  overlay.update();
  renderer.render(scene, camera);
});
// … on teardown:
overlay.dispose();
```

## Tests

`perf-stats-overlay.test.ts` (node env, via the injected `createContainer` seam) — panel composition (3 vs 2 without memory), side-by-side layout override, container class + pointer-events none, update fan-out, dispose idempotence + post-dispose no-op, per-panel throw isolation, invalid-parent rejection. Consumer wiring is asserted app-side: the recorder's `main.visualization-toggles-wiring.test.ts` (gating, dom-overlay root, dispose-on-reenter) and `replay-mode.test.ts` (replay mount + dispose); the PhysicsDemo drives it from its `main.ts` render loop.
