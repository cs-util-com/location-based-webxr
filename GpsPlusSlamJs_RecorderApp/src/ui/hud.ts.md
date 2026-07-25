# hud.ts

## Purpose

Manages the HTML overlay elements: status display, buttons, modals. Provides a callback-based interface for the main module.

Being split per-panel (simplify-loop Area 5): extracted panels ([`hud-tracking-quality-panel.ts`](hud-tracking-quality-panel.ts.md), [`hud-status-rows.ts`](hud-status-rows.ts.md), [`hud-enter-ar-gate.ts`](hud-enter-ar-gate.ts.md), [`hud-setup-panel.ts`](hud-setup-panel.ts.md)) are re-exported here so `./ui/hud` stays the single import seam; the shared mutable state (`UICallbacks`, permission/storage flags, cached elements) lives in [`hud-state.ts`](hud-state.ts.md).

## Public API

| Export                                                                                                                                                        | Type                                       | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UICallbacks`                                                                                                                                                 | interface                                  | Callback functions for UI events                                                                                                                                                                                                                                                                                                                                                                      |
| `initUI(callbacks)`                                                                                                                                           | `(UICallbacks) => void`                    | Wire up event listeners                                                                                                                                                                                                                                                                                                                                                                               |
| `updateStatus(text)`                                                                                                                                          | `(string) => void`                         | Update status text (green)                                                                                                                                                                                                                                                                                                                                                                            |
| `updateFolderStatus(text)`                                                                                                                                    | `(string) => void`                         | Update the `#folder-status` element text                                                                                                                                                                                                                                                                                                                                                              |
| `updateSaveStatus(text)`                                                                                                                                      | `(string) => void`                         | Update the `#save-status` element text                                                                                                                                                                                                                                                                                                                                                                |
| `showError(message)`                                                                                                                                          | `(string) => void`                         | Show error (red); also reveals `#webxr-warning` when the message mentions WebXR                                                                                                                                                                                                                                                                                                                       |
| `showUnsupportedPlatformNotice()`                                                                                                                             | `() => void`                               | Reveal the prominent `#unsupported-platform-notice` banner (D1): explains the device lacks `immersive-ar` WebXR (typically iOS) and to record use Chrome on Android, while replay still works. No-op if the element is absent. Called from `main()` when `webxr.supported === false`, alongside `switchToReplayMode`.                                                                                 |
| `updateGpsInfo(accuracy)`                                                                                                                                     | `(number) => void`                         | Update GPS accuracy display                                                                                                                                                                                                                                                                                                                                                                           |
| `updateArInfo(tracking)`                                                                                                                                      | `(string) => void`                         | Update AR tracking status                                                                                                                                                                                                                                                                                                                                                                             |
| `showArReadyControls()`                                                                                                                                       | `() => void`                               | Show Start button for AR_READY state                                                                                                                                                                                                                                                                                                                                                                  |
| `showRecordingControls()`                                                                                                                                     | `() => void`                               | Show Stop button for RECORDING state; resets the Stop button to its idle state (clears any leftover busy state from a prior stop)                                                                                                                                                                                                                                                                     |
| `hideRecordingControls()`                                                                                                                                     | `() => void`                               | Hide recording UI controls                                                                                                                                                                                                                                                                                                                                                                            |
| `setStopButtonBusy(busy)`                                                                                                                                     | `(boolean) => void`                        | Toggle the Stop button's in-progress state. `true` disables it, sets `aria-busy`, and relabels to "⏹ Stopping…" for the multi-second final sync (prevents the double-tap behind Sentry 7319627943); `false` restores "⏹ Stop" and re-enables. Throws if called before `initUI()`.                                                                                                                     |
| `validateEnterButton()` / `updatePermissionStatus(result)` / `setPermissionsReady(ready)` / `setSaveLocationSelected(sel)` / `getSaveLocationSelected()`      | re-exports                                 | Re-exported from [`hud-enter-ar-gate.ts`](hud-enter-ar-gate.ts.md) (extracted 2026-07-24, simplify-loop Area 5 stage C2) — see that sidecar.                                                                                                                                                                                                                                                          |
| `showSetupModal()` / `populateScenarios(names)` / `setFolderImportExpanded(expanded, hint?)` / `setFolderImportProgress(state)` / `FolderImportProgressState` | re-exports                                 | Re-exported from [`hud-setup-panel.ts`](hud-setup-panel.ts.md) (extracted 2026-07-24, simplify-loop Area 5 stage C3) — see that sidecar.                                                                                                                                                                                                                                                              |
| `resetUIForNewRecording(options)`                                                                                                                             | `(ResetUIOptions) => void`                 | Reset UI state for a new recording: shows setup modal, hides recording controls, clears save-location-selected, optionally clears folder-selected based on `options.keepFolder`, clears save status text, and re-validates the Enter AR button.                                                                                                                                                       |
| `updateFrameCount(count)`                                                                                                                                     | `(number) => void`                         | Update the frame counter display during recording. Shows the `frame-count-info` container. Color is yellow when 0, green when > 0.                                                                                                                                                                                                                                                                    |
| `hideFrameCount()`                                                                                                                                            | `() => void`                               | Hide the frame counter display (called when recording stops).                                                                                                                                                                                                                                                                                                                                         |
| `updateRefPointButtonLabel(name?)`                                                                                                                            | `(string?) => void`                        | Update ref point button text for proximity detection. Pass a name to show `"📍 Capture '<name>'"`, or undefined to reset to `"📍 Mark Point"`. No-op before `initUI()`.                                                                                                                                                                                                                               |
| `updateRefPointHint(nearby?)`                                                                                                                                 | `({displayName, isNeighborCell}?) => void` | D3: inline proximity hint (`#ref-point-hint`) that makes the name relabel read as a **location confirmation**. `undefined` → hidden. Same cell → "You're at '\<name>' — tap 📍 to re-observe it." Neighbour cell → adds the "or ➕ to mark a new point here" option. Display-only (no behaviour/name-management change). Lazily looked up; no-op if absent. Reset to hidden in `showArReadyControls`. |
| `updateTrackingQuality(report)`                                                                                                                               | `(TrackingQualityReport) => void`          | Re-exported from [`hud-tracking-quality-panel.ts`](hud-tracking-quality-panel.ts.md) (extracted 2026-07-24, simplify-loop Area 5) — see that sidecar for details.                                                                                                                                                                                                                                     |
| `hideTrackingQuality()`                                                                                                                                       | `() => void`                               | Re-exported from [`hud-tracking-quality-panel.ts`](hud-tracking-quality-panel.ts.md) — see that sidecar.                                                                                                                                                                                                                                                                                              |
| `updateSyncStatus(status)` / `setAbsCompassStatus(status)` / `hideAbsCompass()`                                                                               | re-exports                                 | Re-exported from [`hud-status-rows.ts`](hud-status-rows.ts.md) (extracted 2026-07-24, simplify-loop Area 5 stage B) — see that sidecar. The `AbsCompassStatusDisplay` type is exported by the panel itself (no consumer imports it by name).                                                                                                                                                          |

### Types (Issue 4)

```typescript
interface ResetUIOptions {
  /** When true, keep the folder-selected state (read permission still valid). */
  keepFolder: boolean;
}
```

## UICallbacks Interface

```typescript
interface UICallbacks {
  onOpenFolder: () => Promise<void>;
  onChooseSaveLocation: () => Promise<void>;
  onEnterAR: () => Promise<void>;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onMarkRefPoint: () => Promise<void>;
  onToggleMap: () => void;
  onMapZoomIn: () => void;
  onMapZoomOut: () => void;
  onScenarioChange: (scenarioName: string) => void;
  onRequestPermissions: () => Promise<void>;
}
```

**Callback Details:**

- `onOpenFolder` — User clicked "Open Folder", expects async folder picker
- `onChooseSaveLocation` — User clicked "Save Location", expects async picker
- `onEnterAR` — User clicked "Enter AR", expects async XR session start
- `onStartRecording` — User clicked "Start Recording"
- `onStopRecording` — User clicked "Stop Recording"
- `onMarkRefPoint` — User clicked "Mark Ref Point"
- `onToggleMap` — User clicked "Map" toggle
- `onMapZoomIn` — User clicked "+" zoom button next to map toggle
- `onMapZoomOut` — User clicked "−" zoom button next to map toggle
- `onScenarioChange` — User selected existing scenario from dropdown, or auto-selection by `populateScenarios` (NOT called for "**new**")
- `onRequestPermissions` — User clicked "Request Permissions"

## DOM Elements

Expects these IDs in `index.html`:

**Required (throws if missing):**

- `btn-select-folder` - Folder picker button
- `btn-enter-ar` - Enter AR session button
- `scenario-select` - Dropdown for scenarios
- `btn-start`, `btn-stop`, `btn-ref-point` - Recording controls

**Optional (graceful degradation):**

- `btn-map` - Map toggle button
- `setup-modal` - Initial configuration modal
- `new-scenario-section` - Section for new scenario name
- `new-scenario-name` - Input for new scenario name (auto-focused when "**new**" selected)
- `enter-ar-hint` - Hint text explaining why Enter AR button is disabled
- `status-text` - Status display
- `gps-info`, `ar-info` - Sensor status displays
- `frame-count-info` - Container for frame counter (hidden by default)
- `frame-count` - Span showing the current frame count number
- The `tracking-quality*` / `tq-*` elements are owned by [`hud-tracking-quality-panel.ts`](hud-tracking-quality-panel.ts.md) since the 2026-07-24 extraction — see that sidecar.

## Invariants & Assumptions

- `initUI()` must be called before any other exported functions
- DOM elements must exist before `initUI()` is called
- Critical elements throw an error if missing (fail-fast pattern)
- Required elements are cached after `initUI()` to avoid redundant DOM queries
- Functions called before `initUI()` throw an error indicating the initialization order violation
- Callbacks provided by main module
- Uses Tailwind CSS classes for styling
- `populateScenarios()` shows the new scenario section and auto-focuses the name input when called with an empty array (no existing scenarios)
- `populateScenarios()` calls `onScenarioChange` when auto-selecting the first existing scenario, ensuring `currentScenarioName` in main.ts is synchronized
- **Transition handling**: When hiding `new-scenario-section`, the code:
  - Checks `prefers-reduced-motion` and `transitionDuration` to detect if CSS transitions will run
  - If no transition expected (reduced motion or 0s duration): adds `hidden` class immediately
  - If transition expected: waits for `transitionend` event with a 350ms timeout fallback
  - This ensures the element is properly hidden from assistive tech even when `transitionend` doesn't fire

## Tests

- Unit tests in `hud.test.ts` using jsdom environment
- Tests cover:
  - Fail-fast behavior for missing required elements
  - Initialization order enforcement (throws if functions called before `initUI()`)
  - Validation logic for Enter AR button
  - Scenario dropdown population (including empty scenario list edge case)
  - Status/GPS/AR info display functions
  - `updateRefPointButtonLabel`: sets capture label, resets to default, no-op before initUI
  - `showArReadyControls` resets ref point button label to default
  - Graceful degradation for optional elements
  - Transition handling edge cases:
    - `prefers-reduced-motion` detection and immediate hiding
    - Zero-duration transition detection and immediate hiding
    - Timeout fallback when `transitionend` never fires
    - Timeout cleanup when `transitionend` fires normally
  - Tracking-quality panel tests moved to `hud-tracking-quality-panel.test.ts` with the 2026-07-24 extraction
- E2E tests in `playwright-tests/enter-ar-flow.spec.js` cover:
  - Enter AR button hint display when disabled
  - New scenario creation flow
  - Bug fix verification: new scenario section visible when no existing scenarios
- See also `playwright-tests/smoke.spec.js`, `playwright-tests/setup-modal.spec.js`
