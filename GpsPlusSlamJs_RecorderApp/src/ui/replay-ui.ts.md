# replay-ui.ts

## Purpose

Pure DOM manipulation module for the replay mode UI. Bridges the HTML elements in `index.html` and the replay orchestration logic in `main.ts`. No business logic — all actions are delegated to callbacks.

## Public API

### Setup

| Function             | Signature                                | Description                                              |
| -------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `initReplayUI`       | `(callbacks: ReplayUICallbacks) => void` | Wire event listeners on all replay UI elements           |
| `switchToReplayMode` | `() => void`                             | Hide recording elements, show replay setup, update title |

### Scenario & Session

| Function                  | Signature                                  | Description                                                                                                           |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `populateReplayScenarios` | `(scenarios: string[]) => void`            | Fill scenario dropdown with folder names. Auto-selects and fires `onScenarioChange` when exactly one scenario exists. |
| `populateReplaySessions`  | `(sessions: ReplaySessionEntry[]) => void` | Fill session list with clickable entries                                                                              |
| `enableStartReplay`       | `() => void`                               | Enable the Start Replay button, hide hint                                                                             |
| `disableStartReplay`      | `() => void`                               | Disable the Start Replay button                                                                                       |

### Playback Controls

| Function                 | Signature                  | Description                                                          |
| ------------------------ | -------------------------- | -------------------------------------------------------------------- |
| `showReplayControls`     | `() => void`               | Show replay controls overlay + color legend, hide recording controls |
| `hideReplayControls`     | `() => void`               | Hide replay controls overlay + color legend                          |
| `updateReplayProgress`   | `(current, total) => void` | Update "Action N/M" display                                          |
| `updatePlayPauseButton`  | `(state) => void`          | Update button for playing/paused/completed                           |
| `updateCameraModeButton` | `(mode) => void`           | Update button for orbit/fps mode                                     |

### Callbacks (ReplayUICallbacks)

| Callback                 | Triggered by                          |
| ------------------------ | ------------------------------------- |
| `onScenarioChange(name)` | Scenario dropdown change              |
| `onSessionSelect(index)` | Session list entry click              |
| `onStartReplay(speed)`   | Start Replay button click (always 1×) |
| `onPlayPause()`          | Play/Pause button click               |
| `onSpeedChange(speed)`   | Live speed preset button click        |
| `onCameraToggle()`       | Camera toggle button click            |
| `onMapToggle()`          | Map toggle button click               |
| `onMapZoomIn()`          | Map zoom-in button click              |
| `onMapZoomOut()`         | Map zoom-out button click             |

## Required HTML Element IDs

- Setup: `setup-title`, `btn-open-folder`, `btn-choose-save`, `save-status`, `permission-section`, `btn-enter-ar`, `enter-ar-hint`, `webxr-warning`, `btn-settings`, `session-notes`, `new-scenario-section`, `scenario-select`, `replay-setup`, `replay-scenario-select`, `replay-session-list`, `btn-start-replay`, `replay-hint`
- Speed presets: `.replay-live-speed[data-replay-speed]` (values: 0.1, 0.2, 0.5, 1, 2, 5, 10)
- Playback: `replay-controls`, `controls`, `btn-replay-play-pause`, `replay-progress`, `btn-camera-toggle`, `btn-map-toggle-replay`, `btn-map-zoom-in-replay`, `btn-map-zoom-out-replay`
- Legend: `replay-legend` (shown/hidden alongside `replay-controls`)

## Invariants

- `initReplayUI` must be called before any click delegation works (session list, speed presets).
- `switchToReplayMode` is idempotent — safe to call multiple times.
- Replay always starts at 1× speed; speed is adjustable at runtime via live overlay presets.

## Tests

- Unit tests: [replay-ui.test.ts](replay-ui.test.ts) — covering mode switching, dropdown/list population, event wiring, progress updates, button states, speed handling, map toggle wiring, and color legend visibility/content (6 legend tests).
