# replay-engine.ts

## Purpose

Controls timed playback of recorded AR+GPS sessions by dispatching Redux actions to a `RecorderStore` with delays derived from action timestamps. This is the core replay logic, independent of any DOM/Three.js/WebXR dependencies.

## Public API

### `extractActionTimestamp(action: ReplayAction): number | null`

Pure function that extracts an absolute epoch-ms timestamp from a Redux action.

| Action type                  | Timestamp source                                                                       | Returns  |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `gpsData/recordGpsEvent`     | `payload.rawGpsPoint.timestamp` (new) or `payload.gpsPoint.timestamp` (old recordings) | epoch ms |
| `recorder/startSession`      | `payload.startTime`                                                                    | epoch ms |
| `gpsData/markReferencePoint` | `payload.timestamp`, fallback to `rawGpsPoint.timestamp` or `gpsPoint.timestamp`       | epoch ms |
| `recorder/recordDepthSample` | _(ignored — uses performance.now)_                                                     | `null`   |
| `diagnostics/note`           | `payload.atMs` (epoch ms by contract, see `diagnostics-action.ts`)                     | epoch ms |
| `recorder/endSession`        | _(no timestamp)_                                                                       | `null`   |
| All other types              | _(no known timestamp location)_                                                        | `null`   |

**Critical invariant (Risk R4):** `depthSample` uses `performance.now()` (relative to page load), NOT epoch ms. Returning it would mix clock domains and produce garbage delays.

### `computeInterActionDelay(currentTs, nextTs, speedFactor, maxDelay?): number`

Pure function computing the delay in ms between two consecutive actions.

- If either timestamp is `null`: returns `0` (dispatch immediately)
- If delta is negative: returns `0` (clock went backwards)
- If delta / speedFactor > maxDelay: returns `maxDelay` (30s default)
- Otherwise: returns `(nextTs - currentTs) / speedFactor`

### `DEFAULT_MAX_DELAY_MS`

Exported constant: `30_000` (30 seconds). Prevents indefinite waits on stale recordings.

### `class ReplayEngine`

Async controller with state machine: `idle → playing → paused → playing → completed`.

| Method                              | Description                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `play(actions, store, speedFactor)` | Start dispatching actions with timed delays                                              |
| `pause()`                           | Abort the async loop (cancel via AbortController)                                        |
| `resume()`                          | Restart loop from current index                                                          |
| `setSpeed(factor)`                  | Update speed mid-playback; throws `RangeError` if factor is not a positive finite number |
| `onProgress(cb: (current, total))`  | Register progress callback                                                               |
| `onComplete(cb: () => void)`        | Register completion callback                                                             |
| `onError(cb: (index, error))`       | Register error callback (R7 — per-action errors)                                         |
| `getState(): ReplayState`           | Current state: idle/playing/paused/completed                                             |
| `getCurrentActionIndex(): number`   | 1-based index of last dispatched action                                                  |
| `dispose()`                         | Stop and free all resources                                                              |

## Invariants & Assumptions

- Actions are dispatched in array order (same order as recorded).
- Timestamps in `recordGpsEvent` and `startSession` are absolute epoch ms.
- `depthSample` timestamps are **NOT** epoch ms and must be ignored.
- At speed factors > 50x, inter-action delays approach 0 and dispatches become near-synchronous. `requestAnimationFrame` naturally coalesces visual updates.
- Max delay clamp (30s) prevents hangs on recordings with large clock gaps.
- The store must be a `RecorderStore` with `NullStorageBackend` for replay (no persistence side effects).
- **Error resilience (R7):** Dispatch errors are caught per-action — replay continues. After 10 consecutive errors, the engine auto-pauses to avoid churning through corrupt data.
- **Listener cleanup:** The internal `abortableDelay` removes its `abort` listener from the `AbortSignal` when the timeout fires normally. This prevents listener accumulation during long replays with thousands of timed delays.
- **play() cancellation:** Calling `play()` while already playing aborts the existing `AbortController` before overwriting it. This prevents dual concurrent `runLoop()` instances.
- **setSpeed() validation:** Rejects non-positive, non-finite, and NaN values with `RangeError` to prevent division-by-zero (Infinity delay), NaN propagation, or busy-loop dispatch.

## Examples

```typescript
import { ReplayEngine, extractActionTimestamp } from './replay-engine';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';

// Create a replay store (no persistence)
const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });

// Load actions from zip (via loadActionsFromZip)
const actions = await loadActionsFromZip(zipData);
const replayActions = actions.map((e) => e.action);

// Create engine and wire callbacks
const engine = new ReplayEngine();
engine.onProgress((current, total) => console.log(`${current}/${total}`));
engine.onComplete(() => console.log('Done'));
engine.onError((index, error) =>
  console.warn(`Action ${index} failed:`, error)
);

// Play at 5x speed
await engine.play(replayActions, store, 5);

// Pause/resume
engine.pause();
engine.setSpeed(10);
await engine.resume();

// Cleanup
engine.dispose();
```

## Tests

- Unit tests: `replay-engine.test.ts`
  - `extractActionTimestamp`: 8 cases covering all action types + edge cases
  - `computeInterActionDelay`: 9 cases covering speed factors, null timestamps, clamping
  - `ReplayEngine`: 18 cases covering play, pause, resume, speed change, progress, completion, error handling (R7), auto-pause on consecutive errors, edge cases, state machine, dispose
  - `abortableDelay listener cleanup`: 1 case verifying abort listeners are removed when timeouts complete normally
  - `play() cancellation`: 1 case verifying second `play()` cancels the first
  - `setSpeed() validation`: 5 cases covering zero, negative, NaN, Infinity, and valid inputs
- Property-based tests: `replay-engine.property.test.ts` (planned)
