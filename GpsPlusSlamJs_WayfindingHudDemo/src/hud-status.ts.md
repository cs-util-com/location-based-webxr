# hud-status.ts

- **Purpose:** turn the REAL HUD scene output (the presenter's indicator meshes on the camera) plus the target list into the one-line DOM status. Deliberately reads presenter OUTPUT (children by name + visibility) instead of re-running placement math — the status line is then evidence of what the HUD actually shows, which is what the Playwright walk-flow spec asserts hysteresis against.
- **Public API:**
  - `summarizeHudScene(cameraChildren, cameraPosition, targets): HudSceneSummary` — counts visible `wayfinding-arrow` / `wayfinding-circle` children (labels/others ignored), `hidden = targets − arrows − rings` (floored at 0), `nearest` distance or null, and `indicatorStyle` (`"procedural" | "image" | "mixed" | null`) derived from the indicator children's object kind (`isSprite`), visibility-independent.
  - `formatHudStatus(summary)` — `` `targets 4 · arrows 3 · rings 1 · hidden 0 · nearest 19.2 m · procedural indicators` `` (dash when no targets; the style suffix drops out while `indicatorStyle` is null).
- **Invariants:** relies on the framework presenter's stable mesh names (`wayfinding-arrow`, `wayfinding-circle` — see the framework's `wayfinding-hud.ts.md`) and on sprite vs mesh being the only signal distinguishing the image-indicator path (the presenter names both identically); the label sprite never influences the style; pure, no three.js scene mutation.
- **Tests:** `hud-status.test.ts`.
