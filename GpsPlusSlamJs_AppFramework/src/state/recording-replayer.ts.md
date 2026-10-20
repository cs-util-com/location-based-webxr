# recording-replayer.ts

## Purpose

Convenience module for replaying a recorded session from a zip file into a fresh store, producing the fully-computed `CombinedRootState` without any persistence side effects.

## Public API

### `replayRecording(zipData: ZipSource, options?: ReplayRecordingOptions): Promise<CombinedRootState>`

Loads all actions from a recording zip, creates a store with `NullStorageBackend` (no OPFS writes), optionally transforms actions via a caller-provided migration callback, dispatches every action in chronological order, and returns the final combined state.

**Parameters:**

- `zipData` — `ZipSource` = `Uint8Array` OR any zip.js `Reader` (widened 2026-08-26 for the TourViewer geo join, the function's first production caller: a range-streaming consumer replays through `new ByteSourceReader(archive.source)` without holding the archive in memory).
- `options.onChunk?(dispatched, total)` — progress hook, called AFTER each chunk's event-loop yield. The dispatch loop is CHUNKED (25 actions per yield): replaying a long recording costs whole seconds of alignment re-solves and callers replay inside live XR sessions.
- `options.onAction?(action, state)` - called after EACH dispatched action
  with the state it produced, for a caller that needs the state at a moment
  of the recording, not only at its end (the Tour Viewer places a recorded
  photo through the first settled alignment after it was taken, scan-pass
  plan S-D11). It runs once per action, so it must stay cheap.
- `options.shouldContinue?()` — asked BEFORE each chunk; returning `false`
  stops the replay and returns the state built so far, so an aborting caller
  pays at most the chunk already in flight. The returned state is PARTIAL by
  construction and the caller is expected to discard it - which is why this
  is a separate hook rather than an error.
  - It exists because `onChunk` gave a caller a place to NOTICE it no longer
    wanted the result but no way to act on it. Its production caller is the
    TourViewer's placement of a walk's debug camera captures
    (`debug-captures.ts` `debugCapturesOf`), which the desktop editor's
    debug layer (`editor/debug-capture-layer.ts`) runs until the tour
    closes: a replay whose tour was closed or replaced stops at the next
    chunk instead of replaying the rest of a walk nobody will read.
    `debug-captures.test.ts` ("a replay the caller stopped") pins the
    pass-through.
  - **The option was once added a round BEFORE its first caller was
    wired**, and nothing caught the gap: the option is optional so types
    were satisfied, and the framework tests use it so knip saw no dead
    export. A caller's own test of the pass-through is what closes it.
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

- `recording-replayer.test.ts` — unit tests covering, among others:
  - State population (gpsData, recorder metadata)
  - GPS event count correctness
  - Alignment matrix computation
  - OdometryPath.points from add2dImage
  - No persistence side effects (failedWriteCount === 0)
  - Invalid zip error handling
  - `migrateActions` callback invocation
  - Migrated actions dispatch (filtering, transformation)
  - Default behavior without options (backward compatibility)
  - `onAction` receives every action with the state it produced (scan-pass S1)
