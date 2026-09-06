# main.ts

- **Purpose:** entry-point DOM glue (PhysicsDemo pattern — logic lives in the tested modules; this file looks up elements and forwards events). Covered by the Playwright smoke test.
- **Wiring:**
  - `detectArSupport()` (fire-and-forget) → `applyModeEntry` (either-or mode screen).
  - **Desktop:** the walk simulator auto-starts behind the mode screen (`startDesktopSim`), sliders initialise to `SIM_HUD_CONFIG`, and the mode screen dismisses on the first keydown/pointerdown so the intro stays readable.
  - **AR:** "Start AR" → sliders initialise to `AR_HUD_CONFIG` → `startArMode`; `onStarted` reveals the HUD panel + the static numbered instructions (`#ar-instructions`), `onHint` flashes a transient warning line (`#ar-hint-flash`, 2.5 s with rapid-retap timer reset — the blocked-tap feedback), `onError` re-enables the button with the reason, `onEnded` (system back gesture) returns to the mode screen.
  - Sliders: every `input` event refreshes the value outputs and calls the active mode's `refreshHud()`; values are read through `sanitizeHudDemoConfig` with the active mode's fallback.
    - Each slider is first wrapped by the framework's [`guardSliderAgainstScroll`](../../GpsPlusSlamJs_AppFramework/src/utils/slider-scroll-guard.ts.md) — **installed before the `input` listener**, since at-target listeners fire in registration order and that is the only reason the guard can stop a scroll-gesture event before this file reacts. On touch, a value changes only on an explicit horizontal drag or a short tap; swiping past the control row scrolls the page (paired with `touch-action: pan-y` in `index.html`, pinned by `slider-touch-gesture.test.ts`).
  - Image-indicators checkbox (`#image-indicators`): its `change` event calls `refreshHud()` the same way; the checked state rides into the config as `imageIndicators` (procedural ↔ image sprite indicators, `indicator-assets.ts`).
  - Status line: per-frame text from the modes, written to the DOM only when it changed.
- **Invariants:** exactly one mode is active; `activeMode` is the single refresh target; element lookups fail loudly (`requireEl`).
- **Tests:** e2e (`smoke.spec.js`, `walk-flow.spec.js`) — the desktop path drives the REAL HUD; the AR path is device-verified.
- **Entrance toggle ([HUD diamond entrance plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md), M4):** the `entrance-animation` switch (default checked) is read into `HudDemoConfig.entrance` and re-creates the HUD on change, like the image-indicator switch; the e2e `entrance.spec.js` drives the desktop path under Playwright's fake clock.
