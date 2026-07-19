# desktop-sim.ts

- **Purpose:** the desktop walk simulator — Prototype-1's design (grid floor, wireframe waypoint spheres, WASD walking + OrbitControls drag-look) re-implemented against the graduated framework HUD. Owns its own rAF loop and drives the REAL `createWayfindingHud` in **explicit-tick mode** (`autoRegisterFrameUpdate: false` + `hud.update(dt)`) because nothing ticks the framework frame loop outside a WebXR session.
- **Public API:**
  - `startDesktopSim(deps: DesktopSimDeps): DesktopSim` — `deps` = `{ container, getConfig, onStatus }` plus injectables (`createHudImpl`, `createRenderer`, `createControls`, `scheduler`, `windowLike`) defaulting to the real implementations.
  - `DesktopSim` — `{ refreshHud() (re-create from current slider config), dispose() (idempotent; cancels the loop, removes listeners, disposes HUD/controls/scene/renderer) }`.
- **Invariants & assumptions:**
  - Per frame: dt (capped at 0.1 s so a background-tab resume cannot teleport the walker) → key movement applied to camera **and** controls target → `controls.update()` → `hud.update(dt)` → status line (`hud-status.ts` reading the camera's children) → render.
  - Keydown events from focused `<input>` elements are ignored (sliders keep their arrow keys); window blur clears held keys.
  - `config.imageIndicators` maps to the framework's `arrowSprite`/`circleSprite` URL options ([indicator-assets.ts](indicator-assets.ts.md)); URL-loaded textures are HUD-owned, so refreshHud re-creation leaks nothing.
  - Framework imports use deep subpaths (`/visualization/wayfinding-hud`, `/visualization/three-dispose`) — the `/visualization` barrel pulls the leaflet overlay, which touches `window` at import time and would force jsdom onto the node-env unit tests.
- **Example:** `const sim = startDesktopSim({ container: app, getConfig: readConfig, onStatus }); slider.oninput = () => sim.refreshHud();`
- **Tests:** `desktop-sim.test.ts` (fake-injected wiring: explicit-tick creation, per-frame update + status, movement, config refresh, idempotent dispose, blur clears keys). The real rendering + real HUD math run in `playwright-tests/smoke.spec.js` / `walk-flow.spec.js`.
