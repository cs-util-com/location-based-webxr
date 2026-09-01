# recording-replayer.ts

## Purpose

Convenience module for replaying a recorded session from a zip file into a fresh store, producing the fully-computed `CombinedRootState` without any persistence side effects.

## Public API

### `replayRecording(zipData: ZipSource, options?: ReplayRecordingOptions): Promise<CombinedRootState>`

Loads all actions from a recording zip, creates a store with `NullStorageBackend` (no OPFS writes), optionally transforms actions via a caller-provided migration callback, dispatches every action in chronological order, and returns the final combined state.

**Parameters:**

- `zipData` — `ZipSource` = `Uint8Array` OR any zip.js `Reader` (widened 2026-08-26 for the TourViewer geo join, the function's first production caller: a range-streaming consumer replays through `new ByteSourceReader(archive.source)` without holding the archive in memory).
- `options.onChunk?(dispatched, total)` — progress hook, called AFTER each chunk's event-loop yield. The dispatch loop is CHUNKED (25 actions per yield): replaying a long recording costs whole seconds of alignment re-solves and callers replay inside live XR sessions.
- `options.shouldContinue?()` — asked BEFORE each chunk; returning `false`
  stops the replay and returns the state built so far, so an aborting caller
  pays at most the chunk already in flight. The returned state is PARTIAL by
  construction and the caller is expected to discard it - which is why this
  is a separate hook rather than an error.
  - It exists because `onChunk` gave a caller a place to NOTICE it no longer
    wanted the result but no way to act on it. Its production caller is the
    TourViewer's geo join (`main.ts`), which passes
    `() => generation === planesRunGeneration`; without it a replay whose AR
    session had ended kept dispatching into a store nobody would read, on
    device, competing with the frame loop.
  - **The option was added one round BEFORE that caller was wired** (PR #379
    review). Nothing caught the gap: the option is optional so types were
    satisfied, the framework tests use it so knip saw no dead export, and
    `main.ts` has no unit tests. `replay-abort-wiring.test.ts` in the
    TourViewer now pins the call site.
- `options` — Optional `ReplayRecordingOptions`:
  - `migrateActions?: (actions: RecordedAction[]) => RecordedAction[]` — Transform actions before dispatch (e.g., era migration).

**Returns:** `CombinedRootState` — the fully-replayed state containing both library state (`gpsData`, `gpsElements`, `arElements`) and recorder state (`recorder.sessionMetadata`, `recorder.isRecording`, etc.).

**Throws:** If the zip cannot be parsed (invalid zip data) or contains malformed JSON.

## Invariants & Assumptions

- Actions are replayed in filename-sorted order (chronological, matching recording order).
- No persistence occurs during replay — `NullStorageBackend` ensures all `writeAction`/`writeFrame`/`writeSessionMetadata` calls are no-ops.
- `add2dImage` actions dispatched before `setZeroPos` are silently dropped (library reducer guard: `if (!state) return state`).
- `imageFile` paths in the replayed state may reference files not present in the zip (e.g., frames deleted to reduce zip size). The metadata (position, rotation, timestamp) is still valid.
- The function creates a fresh store per call — no state leaks between replays.

## Examples

```typescript
import { replayRecording } from './recording-replayer';

// In Node.js (tests)
const zipData = new Uint8Array(fs.readFileSync('recording.zip'));
const state = await replayRecording(zipData);
console.log(state.gpsData!.gpsEvents.gpsPositions.length);

// In browser
const response = await fetch('/recordings/session.zip');
const zipData = new Uint8Array(await response.arrayBuffer());
const state = await replayRecording(zipData);
```

## Tests

- `recording-replayer.test.ts` — 11 unit tests covering:
  - State population (gpsData, recorder metadata)
  - GPS event count correctness
  - Alignment matrix computation
  - OdometryPath.points from add2dImage
  - No persistence side effects (failedWriteCount === 0)
  - Invalid zip error handling
  - `migrateActions` callback invocation
  - Migrated actions dispatch (filtering, transformation)
  - Default behavior without options (backward compatibility)
