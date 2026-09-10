# hud-options.ts

- **Purpose:** derives the config-dependent part of the framework's `WayfindingHudOptions` (deadband, indicator scale, accent tint, sprite URLs) from a `HudDemoConfig`, once, for both hosts (`ar-mode.ts`, `desktop-sim.ts`).
- **Public API:**
  - `hudLookOptions(config: HudDemoConfig): HudLookOptions` — pure apart from one `readCssToken("--accent")` read.
  - `HudLookOptions` — the `Pick` of `WayfindingHudOptions` this module owns; the hosts add `camera`, `getTargets` and (the simulator) `autoRegisterFrameUpdate`.
- **Invariants & assumptions:**
  - `indicatorColor` is present only when the vendored design.css defines `--accent`; otherwise the key is absent (not `undefined`, not `""`), so the framework default applies under `exactOptionalPropertyTypes`.
  - `arrowSprite` / `circleSprite` are present only when `config.imageIndicators` is true; the framework then owns and disposes the URL-loaded textures, which is what makes HUD re-creation on every slider change leak-free.
  - Called on every HUD (re-)creation, never per frame.
- **Examples:** `createWayfindingHud({ camera, getTargets, ...hudLookOptions(deps.getConfig()) })`.
- **Tests:** `hud-options.test.ts` (each key's presence/absence per config and token); the hosts' tests (`ar-mode.test.ts`, `desktop-sim.test.ts`) assert the options reach the HUD factory.
- **Entrance ([HUD diamond entrance plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md), M4):** with `imageIndicators && entrance` and BOTH tokens readable (`--ink`, `--accent`), the derivation passes `circleEntrance: { ink, accent }` and OMITS `circleSprite` — the framework rejects the pair, and would otherwise load a texture it never binds. Any of those absent → the static `circleSprite` as before; the tokens are required rather than defaulted so a missing sheet cannot paint the marker in a colour the design system does not know. Tests: `hud-options.test.ts` ("the entrance").
