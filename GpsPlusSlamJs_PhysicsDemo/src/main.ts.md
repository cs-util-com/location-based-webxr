# main.ts

## Purpose

The physics demo's entry point and DOM glue. Detects WebXR support, and on the
desktop wires the "load a recording → replay it" flow: the file input drives
`loadAndStartReplay` (which starts a framework `startReplaySession` scene inside
`#app`), then play/pause + speed controls drive the returned controller. Logic
lives in the tested `mode-detection` / `replay-launch` modules; this file is glue.

## Behaviour

- On load, `detectArSupport()` reveals the "Start AR" button only on a
  WebXR-capable device; clicking it inits Rapier then calls `startArMode`
  (`ar-mode.ts`) for a genuine live-AR physics session (the play/pause/speed row is
  hidden in AR — it is replay-only). The desktop-replay path is always available.
- Selecting a recording moves the UI through the async-feedback states:
  `#capability-message` → "Loading recording…" (input disabled) → on success the
  mode screen hides and `#replay-panel` appears with a status + play/pause + speed;
  on failure the message reverts to the error and the input re-enables.
- Play/pause toggles `controller.pause()`/`resume()` and its label; the speed
  slider calls `controller.setSpeed()` and updates the `N×` readout.
- Once Rapier's WASM is ready (loaded lazily on first replay) it calls
  `startReplayPhysics` (`replay-physics.ts`), which owns the occupancy view (occlusion
  AND collider), the shared physics runtime, the rAF step loop, the mesh/shader
  dropdown wiring and click-to-shoot — and returns a disposer. `main.ts` keeps that
  disposer plus the controller in `disposePreviousReplay`, called on every `onReady`
  so a **reload** tears the previous replay down first (no stacked rAF loops /
  physics worlds / WebGL contexts — PR #197). A reload that races the WASM load is
  guarded: physics only wires if the controller is still the active one.

## Invariants & assumptions

- `#overlay` is nested inside `#app` (the scene mount) per the DOM-Overlay stacking
  convention.
- `requireEl` throws on a missing element (fail fast on an HTML/JS drift).
- No unit test — this is DOM wiring; covered by `playwright-tests/smoke.spec.js`
  and the unit-tested modules it composes.

## Tests

- `playwright-tests/smoke.spec.js` — page loads without console errors, the mode
  screen + recording input render, and (no `navigator.xr` in Playwright) the
  desktop-replay path is offered with the AR button hidden.
