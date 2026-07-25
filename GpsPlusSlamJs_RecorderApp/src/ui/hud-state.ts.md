# hud-state.ts

## Purpose

The recorder HUD's shared mutable state, made explicit as one module (simplify-loop Area 5 stage C, 2026-07-24). The per-panel `hud-*` files extracted from the monolithic `hud.ts` share this state without importing `hud.ts` itself — `hud.ts` re-exports the panels, so a value import back into it would be a cycle.

## Public API

- `UICallbacks` — the callback contract the host app wires into the HUD via `initUI()` (also re-exported by `hud.ts`, which stays the intended import surface for consumers).
- `HudCachedElements` — the required UI elements cached once during `initUI()` (fail-fast lookups).
- `hudState` — one mutable object holding:
  - `callbacks: UICallbacks | null` — set by `initUI()`; null before init.
  - `permissionsReady: boolean` — permission status for Enter-AR validation (written by the permission panel functions).
  - `saveLocationSelected: boolean` — storage status for Enter-AR validation (Issue 1a-fix; the parallel `folderSelected` flag was removed 2026-07-10, quality-review D-3).
  - `cachedElements: HudCachedElements | null` — set by `initUI()`.

## Invariants & assumptions

- Keep this surface MINIMAL: a field belongs here only when more than one panel genuinely needs it. Panel-local state (e.g. the tracking-quality expand flag, the sync refresh interval) stays in its panel.
- Writers: `initUI()` (callbacks, cachedElements) and the flag setters (`setPermissionsReady`, `updatePermissionStatus`, `setSaveLocationSelected`, `resetUIForNewRecording`). Readers: `validateEnterButton` and the control functions.
- Not reset between tests automatically — tests that need fresh state use `vi.resetModules()` (existing pattern in `hud.test.ts`).

## Example

```ts
import { hudState } from './hud-state';
if (hudState.cachedElements)
  hudState.cachedElements.btnStart.classList.remove('hidden');
```

## Tests

No dedicated test file — this is a data module with no behavior; every field is exercised by `hud.test.ts` (init, validation, controls) through the real HUD functions.
