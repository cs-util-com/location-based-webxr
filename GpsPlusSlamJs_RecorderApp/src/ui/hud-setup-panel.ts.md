# hud-setup-panel.ts

## Purpose

The recorder's setup-screen panel: setup-modal visibility, the scenario picker (dropdown population + the new-scenario section's fade transitions), and the optional folder-import section (expand/collapse with hint + determinate progress bar). Fourth extraction from the monolithic `hud.ts` (simplify-loop Area 5 stage C3, 2026-07-24).

## Public API

- `showSetupModal()` / `hideSetupModal()` — toggle `#setup-modal` visibility. `showSetupModal` is the soft-reset entry (Issue 4, 2026-02-06); `hideSetupModal` is consumed by `initUI`'s Enter-AR flow.
- `showNewScenarioSection()` / `hideNewScenarioSection(scenarioSelect)` — the shared new-scenario section toggles (quality-review D-5: the show/hide pair used to be copied and had drifted). Hiding honors the fade-out transition with a `transitionend` + 350 ms-fallback pattern and re-checks the select so rapid toggles back to `__new__` are not clobbered; reduced-motion/jsdom/0s hide immediately.
- `populateScenarios(scenarios)` — rebuilds the dropdown (`+ Create new scenario` + existing), auto-selects the first scenario and fires `onScenarioChange` (programmatic value changes don't fire `change`), shows the new-scenario section when empty, then `validateEnterButton()`. Throws before `initUI()`.
- `setFolderImportExpanded(expanded, hint?)` — D5 (2026-06-05): expands the collapsed-by-default folder section with an optional why-hint (hint gated on `expanded`, PR #63).
- `FolderImportProgressState` / `setFolderImportProgress(state)` — determinate per-ZIP progress; `done` is a durable ✓ end state that lingers 4 s before self-hiding; `null` resets and cancels the linger timer.

All public pieces are re-exported by [`hud.ts`](hud.ts) (single HUD seam); `global.d.ts` imports the `FolderImportProgressState` type from there.

## Invariants & assumptions

- Reads `hudState` ([`hud-state.ts`](hud-state.ts.md)) for `cachedElements.scenarioSelect` and `callbacks.onScenarioChange`; calls [`hud-enter-ar-gate.ts`](hud-enter-ar-gate.ts.md)'s `validateEnterButton`. Own module state: only the folder-progress linger timer.
- Optional elements degrade gracefully (minimal test DOMs); only `populateScenarios` is fail-fast on missing `cachedElements`.

## Example

```ts
import { populateScenarios, setFolderImportProgress } from './ui/hud'; // via the hud seam
populateScenarios(await listScenarios());
setFolderImportProgress({ kind: 'progress', done: 2, total: 5 });
```

## Tests

Covered by the integration describes in `hud.test.ts` (`populateScenarios`, `showSetupModal`, `setFolderImportExpanded`, `setFolderImportProgress`, transition-handling edge cases) — deliberately NOT moved: they exercise the panel through `initUI()` + the real setup DOM, i.e. the seam consumers use (same judgment as stage C2).
