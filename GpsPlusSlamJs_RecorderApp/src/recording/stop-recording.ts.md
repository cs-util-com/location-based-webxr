# `recording/stop-recording.ts`

## Purpose

Stopping a recording: tearing down everything that feeds it, then the ordered
flow that persists, packages and summarises what it produced.

## Public API

- `performStop(runtime, deps): Promise<void>` — the ordered stop flow, nine
  steps (below).
- `stopLiveFeeds(runtime, deps): void` — the ONE teardown for the
  feeds-a-recording cluster: captures, sensor watches, the off-thread quality
  analyzer, and their HUD readouts. Every call is idempotent, so running it on
  an already-stopped session is a no-op. Imported back by the factory, which
  also calls it from `cleanupForNewRecording`.
- `stopAbsCompassHudUpdates(runtime): void` — clears the live magnetic-heading
  poll. Also imported back, because `startAbsCompassHudUpdates` calls it first
  so re-arming can never leak the previous interval.
- `StopRecordingDeps` — the narrow slice of `RecordingSessionDeps` this needs;
  extends `ZipContributorDeps` with `setImageQualityAnalyzer`, `getMapOverlay`
  and `collectTrackerErrors`.

## The order, and why it is an order

1. Disable the beforeunload warning.
2. Read the frame and depth-sample counts — **before** stopping anything.
3. `stopLiveFeeds`.
4. Take `endTime` **immediately**, before any async work: the metadata write,
   sync and ZIP export that follow can take several seconds, and both the
   metadata and the summary must report when recording stopped, not when the
   packaging finished.
5. **Drain the persistence write queue** before anything reads this session's
   `actions/`. An action dispatched moments before Stop could otherwise land
   after the export enumerated the directory and silently miss the zip.
6. Write the session metadata (the framework's
   `storage/session-metadata-record.ts`, shared with the Tour Viewer's
   recording since 2026-09-28; this flow injects the build info and the
   query-free page url).
7. Final external sync, then stop the sync manager.
8. Unsubscribe the store, collect tracker errors, hide the map overlay, and
   export a ZIP from OPFS **only when there is no external save location**.
9. Dispatch `endSession`, build the summary, clear the per-session results, and
   render the summary screen.

## Invariants & assumptions

- **`handleStopRecording` DELIBERATELY STAYED IN THE FACTORY.** It is the
  re-entrancy guard, and `stopInProgress` must not travel — a guard that moved
  with the flow would be re-created per call and guard nothing. It is also what
  restores the Stop button on a throw: `performStop`'s tail (end-session
  dispatch, summary build and render) is unguarded and runs _before_
  `hideRecordingControls`, so without that catch a failure leaves the recording
  controls on screen with Stop stuck on "Stopping…" — a bricked UI after a
  successful recording.
- **The sync manager is claimed before the await.** `performStop` copies it to a
  local and nulls `runtime.syncManager` _before_ awaiting, so any concurrent
  teardown (a second stop, or `cleanupForNewRecording`) sees `null` and no-ops
  instead of stopping it from under us. Defence in depth alongside the
  re-entrancy guard (Sentry issue 7319627943).
- **Slow I/O is guarded individually, not collectively.** The metadata write,
  the final sync and the ZIP export each catch and log, so one failing does not
  cost the user the others — or the summary.
- **`latestQrAnchorOutcomes` is cleared after the summary is built.** A session
  with QR off writes no outcomes, so a stale list would be shown as if it
  described the recording just finished.
- **A missing `sessionMetadata.startTime` is logged and survived**, not thrown
  on. The recorded `startedAt` is then wrong (≈ `endedAt`) — a known lie,
  preferred to losing the recording's only self-description over a field that is
  missing precisely when something else has already gone wrong. See
  the framework's `storage/session-metadata-record.ts.md`.
- **Narrow deps interface** — six of `RecordingSessionDeps`'s sixteen members,
  for the reasons in `zip-contributors.ts.md`: it documents the real dependency,
  and it avoids importing the module that imports this one.

## Examples

```ts
// In the factory — the guard stays here, the flow does not.
async function handleStopRecording(): Promise<void> {
  if (stopInProgress) return;
  stopInProgress = true;
  setStopButtonBusy(true);
  try {
    await performStop(runtime, deps);
  } catch (err) {
    setStopButtonBusy(false); // never leave the UI bricked
    throw err;
  } finally {
    stopInProgress = false;
  }
}
```

## Tests

`recording-session-handlers.test.ts` — the 85 characterisation tests, which all
drive this through `createRecordingSessionHandlers`. **None of them was edited
when this module was extracted**, which is what makes them evidence that the
extraction preserved behaviour rather than a description of it.

They are organised by handler, so the stop-flow ones live under
`describe('handleStopRecording')`. A test added for this module directly can
call `performStop(runtime, deps)` with a fake `StopRecordingDeps` — that seam
exists precisely so it can be, and it is narrow enough to fake in a few lines.
