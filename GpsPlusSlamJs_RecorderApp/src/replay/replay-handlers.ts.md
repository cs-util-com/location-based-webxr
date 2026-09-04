# replay-handlers.ts

## Purpose

Encapsulates all replay-mode state and event handlers extracted from `main.ts` (Finding #7 decomposition). Provides a factory function that creates a self-contained replay handler object with its own private state.

## Public API

### `createReplayHandlers(deps: ReplayHandlersDeps): ReplayHandlers`

Factory that creates replay handlers with injected dependencies.

**`ReplayHandlersDeps`:**

- `setStore(store: RecorderStore)` — callback invoked when replay starts, allowing the caller to replace its module-level store (R6 coupling).

**`ReplayHandlers`** returned object:

| Method                       | Signature                                              | Description                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleReplayScenarioChange` | `(scenarioName: string) => Promise<void>`              | Lists session ZIPs in selected scenario (directory + cache).                                                                                                                                    |
| `handleReplaySessionSelect`  | `(index: number) => Promise<void>`                     | Stores selected index; loads GPS path and shows preview map.                                                                                                                                    |
| `handleStartReplay`          | `(speedFactor: number) => Promise<void>`               | Reads ZIP, starts replay orchestrator, replaces store.                                                                                                                                          |
| `startReplayForEntry`        | `(entry: SessionEntry, speedFactor?) => Promise<void>` | Replay a specific recording directly (map-browser single-tour playback, Step 4C). Bypasses the dropdown/list selection; shares the same start core as `handleStartReplay`. Speed defaults to 1. |
| `handleReplayPlayPause`      | `() => void`                                           | Toggles play/pause on the replay controller.                                                                                                                                                    |
| `handleReplaySpeedChange`    | `(speed: number) => void`                              | Changes playback speed.                                                                                                                                                                         |
| `handleReplayCameraToggle`   | `() => void`                                           | Toggles orbit/FPS camera mode.                                                                                                                                                                  |
| `getSessionEntries`          | `() => SessionEntry[]`                                 | Returns current session list.                                                                                                                                                                   |
| `getSelectedSessionIndex`    | `() => number`                                         | Returns selected session index.                                                                                                                                                                 |
| `getIsReplayMode`            | `() => boolean`                                        | Returns replay mode flag.                                                                                                                                                                       |
| `setIsReplayMode`            | `(value: boolean) => void`                             | Sets replay mode flag.                                                                                                                                                                          |
| `setReplayZipScenariosCache` | `(cache: ScenarioSessionMap) => void`                  | Sets the zip→scenario cache (populated by `handleOpenFolder`).                                                                                                                                  |
| `handleReplayMapToggle`      | `() => void`                                           | Lazily creates & toggles 2D map overlay (Issue 4).                                                                                                                                              |
| `reset`                      | `() => void`                                           | Clears all replay state.                                                                                                                                                                        |

## Invariants & Assumptions

- The `setStore` callback is the **only** coupling to `main.ts` state. All other dependencies are direct imports.
- `handleReplayScenarioChange` merges directory-listed sessions with cached metadata-discovered sessions, deduplicating by filename.
- `handleStartReplay` calls `deps.setStore()` after creating the `ReplayModeController`, ensuring the caller's store reference is updated before playback begins.
- `reset()` does **not** call `setStore` — the caller is responsible for store lifecycle. It **does** destroy any active preview map.
- `handleReplaySessionSelect` loads GPS coordinates from the selected session's zip file via `loadGpsPathFromBlob()`, destroys any previous preview map, and renders a new one using `createPreviewMap()`. If GPS extraction yields no points, the preview container is hidden.
- `handleReplayMapToggle` lazily creates a `LeafletMapOverlay` on first call, using `getReplayState()` for scene/camera and `getCameraFollower()` for `mapParent`. It also calls `controller.setMapOverlay()` so the store-subscriber proxy forwards GPS updates to the overlay.

## Examples

```typescript
import { createReplayHandlers } from './replay/replay-handlers';

let store = createNewStore();

const replay = createReplayHandlers({
  setStore: (newStore) => {
    store = newStore;
  },
});

// In main() when WebXR not supported:
replay.setIsReplayMode(true);
initReplayUI({
  onScenarioChange: (name) => void replay.handleReplayScenarioChange(name),
  onSessionSelect: (i) => void replay.handleReplaySessionSelect(i),
  onStartReplay: (speed) => void replay.handleStartReplay(speed),
  onPlayPause: replay.handleReplayPlayPause,
  onSpeedChange: replay.handleReplaySpeedChange,
  onCameraToggle: replay.handleReplayCameraToggle,
});
```

## Tests

- Unit tests: `replay-handlers.test.ts` — covering all handlers, state management, error paths, the `setStore` callback contract, `handleReplayMapToggle` (lazy creation, toggle, guard paths, setMapOverlay wiring), and `handleReplaySessionSelect` (GPS path loading, preview map creation/destruction, empty/out-of-range guards).
