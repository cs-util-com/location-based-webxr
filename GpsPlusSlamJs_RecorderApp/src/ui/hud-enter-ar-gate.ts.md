# hud-enter-ar-gate.ts

## Purpose

The Enter-AR readiness gate of the recorder's setup screen: the permission status rows, the save-location flag, and the Enter-AR button/hint validation that combines them. Third extraction from the monolithic `hud.ts` (simplify-loop Area 5 stage C2, 2026-07-24).

## Public API

- `validateEnterButton(): void` — enables the Enter AR button iff (1) a save location is chosen, (2) mandatory permissions are ready, (3) a scenario is selected or a new-scenario name is entered; otherwise shows the matching hint. Throws if called before `initUI()` (reads `hudState.cachedElements`).
- `updatePermissionStatus(result: PermissionCheckResult): void` — writes `hudState.permissionsReady`, renders the four permission rows (file storage, WebXR, GPS, camera), keeps the "Grant Permissions" button visible while any mandatory (AR/Location/Camera) or recommended (Compass) permission is ungranted, consolidates denied/mandatory errors into `#permission-error`, then re-runs `validateEnterButton()`. The Compass/orientation row was removed (D3, 2026-06-19); `result.orientation` still keeps the button visible.
- `setPermissionsReady(ready: boolean): void` — `@internal` direct flag setter (tests / simulations).
- `setSaveLocationSelected(selected: boolean): void` / `getSaveLocationSelected(): boolean` — `@internal` save-location flag pair (Issue 1a-fix).

All are re-exported by [`hud.ts`](hud.ts) so HUD consumers and the wiring tests' `vi.mock('./ui/hud')` factories keep one seam; `hud.ts` also calls `validateEnterButton` internally (initUI wiring, `resetUIForNewRecording`, `populateScenarios`).

## Invariants & assumptions

- Shared flags (`permissionsReady`, `saveLocationSelected`) and `cachedElements` live on [`hud-state.ts`](hud-state.ts.md)'s `hudState` — this module owns no state of its own.
- The folder-read step is deliberately NOT gated (2026-06-05 setup-UX decision D5 — it is an optional import/recovery step).
- Optional elements (`#enter-ar-hint`, `#permission-error`, `#btn-request-permissions`, per-permission rows) degrade gracefully when absent; only `cachedElements` is fail-fast.

## Example

```ts
import { updatePermissionStatus, validateEnterButton } from './ui/hud'; // via the hud seam
updatePermissionStatus(await checkAllPermissions());
validateEnterButton();
```

## Tests

Covered by the integration describes in `hud.test.ts` (`validateEnterButton`, `updatePermissionStatus — Grant Permissions button visibility`, permission-row rendering) — deliberately NOT moved with the extraction: they exercise the gate through `initUI()` + the real setup DOM, i.e. through the `hud.ts` seam the consumers use.
