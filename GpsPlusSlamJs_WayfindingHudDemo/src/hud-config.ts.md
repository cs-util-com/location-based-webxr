# hud-config.ts

- **Purpose:** the slider-driven subset of the framework's `WayfindingHudOptions` with per-mode defaults and a defensive sanitiser — the framework THROWS on malformed ranges, so every slider read is clamped before it reaches `createWayfindingHud`.
- **Public API:**
  - `HudDemoConfig` — `{ distanceMin, distanceMax, indicatorScale, imageIndicators }`.
  - `AR_HUD_CONFIG` (1.5 / 3.0 / 1.0, real-world walking) and `SIM_HUD_CONFIG` (8 / 12 / 1.0, simulator scale — waypoints sit 10–25 m out); both default `imageIndicators: false` (procedural cone/ring).
  - `sanitizeHudDemoConfig(raw, fallback)` — non-finite fields → fallback; `distanceMin` clamped ≥ 0; `distanceMax` clamped ≥ `distanceMin`; scale clamped to [0.1, 5]; non-boolean `imageIndicators` → fallback.
- **Invariants:** output always satisfies the framework's `validateWayfindingHudOptions`; mode defaults are fixed points of the sanitiser.
- **Example:** `sanitizeHudDemoConfig({ distanceMin: NaN, distanceMax: 2, indicatorScale: 1 }, SIM_HUD_CONFIG)`.
- **Tests:** `hud-config.test.ts` (pass-through, inverted deadband, negatives, non-finite, scale clamps, defaults-are-valid).
- **Entrance toggle ([HUD diamond entrance plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md), M4):** `entrance: boolean` — with image indicators, the diamond builds itself up on arrival (the framework's `circleEntrance`); off, the static SVG sprite (the owner's on-device A/B and the entrance spec's baseline). Same boolean rule as `imageIndicators` in the sanitiser; both mode defaults ship ON. Inert without image indicators. Tests: `hud-config.test.ts` ("the entrance toggle").
