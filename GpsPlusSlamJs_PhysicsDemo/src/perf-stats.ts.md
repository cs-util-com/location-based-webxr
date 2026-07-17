# perf-stats.ts

## Purpose

The demo's always-on performance overlay: a Stats.js FPS / frame-ms / MB panel
row, auto-shown so a developer always sees the framerate and JS heap while the
physics runs (user feedback #4, 2026-07-15). The RecorderApp shows the same
panels behind an optional debug toggle (`ui/stats-overlay.ts`); the demo is a
developer harness, so it is unconditional.

## Public API

- **`createPerfStats(parent, options?): PerfStatsHandle`**
  - `parent` — host element the panel row mounts into (in AR, inside the WebXR
    dom-overlay root). Throws `TypeError` if it is not a DOM element.
  - `options` = `{ statsFactory?, memorySupported?, createContainer? }` — all
    injectable for tests (see Invariants).
  - Returns `PerfStatsHandle` = `{ dom, panelCount, update(), dispose() }`.
- **`PerfStatsInstance`** — the Stats.js subset driven (`dom`, `showPanel`, `update`).

## Invariants & assumptions

- **Stats.js, no extra dependency** — `three/addons/libs/stats.module.js` ships
  with three. Panel ids: 0 = FPS, 1 = frame ms, 2 = MB. Stats.js cycles panels on
  tap, so one instance is mounted PER metric and laid out in a flex row (all
  visible at once); each panel's `position:fixed` is neutralized to `relative`.
- **MB panel is Chrome-only** — omitted unless `performance.memory` exists
  (`memorySupported` default probes it), so `panelCount` is 3 or 2.
- **Read-only instrument** — `pointer-events:none`; never swallows a pointer meant
  for the scene (desktop) or HUD (AR).
- **Caller owns the cadence** — `update()` must be called once per rendered frame
  (desktop: the rAF loop in `main.ts`; AR: the XR frame callback via `ar-mode.ts`).
  `update()` isolates per-panel throws so a Stats hiccup never kills the loop.
- **`dispose()` is idempotent** — removes the container and makes `update()` a
  no-op (prevents duplicate panels stacking across Enter-AR cycles).
- **No jsdom** — the Stats constructor builds a `<canvas>` 2D context and the
  default container uses `document.createElement`; both are injected in the node
  unit tests because this project ships without jsdom (the workspace knip flags it
  as unused). The real DOM path is proven by the Playwright smoke e2e.

## Tests

- `perf-stats.test.ts` (node, injected fakes) — 3-vs-2 panels by memory support,
  panel-id assignment + `relative` re-anchor, container class + `pointer-events`,
  mount into parent, `update()` forwarding, per-panel throw isolation, idempotent
  `dispose()` (removes node + no-ops update), invalid-parent guard.
- `playwright-tests/smoke.spec.js` — asserts the real `.perf-stats` panel mounts
  with canvas panels on the desktop mode screen.
