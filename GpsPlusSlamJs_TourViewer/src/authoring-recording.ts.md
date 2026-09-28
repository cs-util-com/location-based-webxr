# authoring-recording.ts

## Purpose

The creator's troubleshooting recording: once the creator opts in, every
persisted action of the page's store is written to an OPFS folder of its own,
and "Save the recording" hands that folder over as
`tour-recording-<UTC timestamp>.zip` - a zip the Recorder's desktop replay
loads. Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a (decisions D4, D6; review findings 1, 2, 16).

## Public API

- `createAuthoringRecording({ openRoot }): AuthoringRecording` - `openRoot`
  resolves the OPFS root (`navigator.storage.getDirectory`) or rejects.
  - `storageBackend` - handed to `createTourViewerStore`.
  - `persistWhile()` - the store's persistence gate: true from `start()` until
    the folder could not be made.
  - `status(): RecordingStatus` - `off`, `on` (with the count of failed
    writes) or `failed` (with the reason).
  - `start(at: Date)` - makes the folder (async) and opens the gate at once;
    writes queued meanwhile wait for the folder. Idempotent: one recording per
    page life.
  - `save({ flush, nowMs, userAgent, pageUrl })` - flushes the store's write
    queue, writes `session.json`, zips the folder; resolves
    `{ blob, filename, actionCount }`. Rejects when nothing was started, when
    the folder could not be made, or when a write fails - the caller surfaces
    it.
- `recordingFileName(startedAt)` - `tour-recording-YYYY-MM-DD_HH-MM-SSutc.zip`.
- `RECORDING_CONTEXT_TAG` - `"tour-authoring"`, `session.json`'s tag.
- `RECORDING_DEPTH` - the depth sampler's config while recording.
- `type RecordingStatus`.

## Invariants & assumptions

- **Silent until started.** The store is built at page boot with this backend
  and gate; before `start()` the gate is false, so no action reaches the
  backend and nothing is created in OPFS - a creator who never opts in, and
  every visitor, pays nothing.
- **Its own folder:** `gps-plus-slam/tour-viewer/recording-<ts>/` (`actions/`,
  an empty `images/`, `session.json`), made by the framework's
  `createSessionInDirectory` and written by the framework's OPFS write
  functions (which then target it). Never the Recorder's `sessions/`: both apps
  share one origin, and the framework's `OpfsStorageBackend` writes there.
- **The Recorder's layout, era 5.** `session.json` comes from the framework's
  shared builder: `odomCoordVersion: 5`, `contextTag: "tour-authoring"`,
  `frameCount: 0`. Its `actionCount` and H3 coverage come from the GPS
  actions THIS recording wrote (`gpsData/recordGpsEvent`, matched by the
  action creator's type) - the store's own GPS data is wiped at every AR exit.
  `startedAt` is the moment the recording started. The page url is passed in
  query-free.
- **One numbering for the whole recording.** The store numbers across its AR
  sessions (`continuousActionIndex`), so a second visit never overwrites the
  first; the gate replaces `isRecording`, so each exit's
  `resetGpsSessionData` and everything done on the page (the Finish) are
  written too - which is what makes a replay give each visit its own
  alignment.
- **Never part of the tour zip.** The visitor's geo join replays any
  `actions/` + `session.json` in a tour zip; this zip is only handed over on
  its own, under a name that cannot collide with the tour's.
- **Save is a snapshot.** Recording continues after a save; a later save
  rewrites `session.json` and zips everything again.
- **Failures are counted, not swallowed.** A failed action write is counted
  (`status().failedWrites`) and rethrown to the middleware, which dispatches
  `recordWriteFailure`. A folder that cannot be made switches the gate off and
  says why (`status().kind === "failed"`).
- **Depth while recording (decision D4):** `RECORDING_DEPTH` = one sample per
  1000 ms ("about 1 Hz" in the plan), a 16 x 16 grid (the framework sampler's
  default; the Recorder records 24 x 24 at 5 Hz for reconstruction), no
  per-point colour (a camera read-back per sample). Size per hour and the
  frame-time cost on a phone are NOT measured (plan §5); they are guesses until
  a field session measures them.
- **Module-level OPFS handles.** The framework's write functions write to the
  session `createSessionInDirectory` set last. Nothing else on this page uses
  them (the draft store has its own handles).

## Examples

```ts
const recording = createAuthoringRecording({
  openRoot: () => navigator.storage.getDirectory(),
});
const store = createTourViewerStore(recording);
recording.start(new Date()); // at the AR entry, when opted in
const { blob, filename } = await recording.save({
  flush: () => store.flushPendingActionWrites(),
  nowMs: Date.now(),
  userAgent: navigator.userAgent,
  pageUrl: sanitizedPageUrl(location.href),
});
```

## Tests

`authoring-recording.test.ts` (the real page store, the framework's OPFS mock,
the real zip export, read back with `loadActionsFromZip` + `replayActions`):

- nothing is written anywhere before `start()`, and `save()` refuses;
- two AR visits with a page-side Finish between them: numbered 1..N without a
  restart, both resets and the Finish in the stream; replaying up to the first
  exit reproduces visit 1's live alignment, the whole stream visit 2's, and the
  same stream WITHOUT the resets does not (the reset is what separates them);
- the saved zip holds `session.json` (era 5, the tag, the start time, the
  coverage and count from the recorded fixes after the store's were wiped) and
  `actions/NNNNNN.json` only, in `gps-plus-slam/tour-viewer/`, with no
  `sessions/` folder created;
- a folder that cannot be made switches the gate off and reports the reason.

The Recorder's loader accepting this layout is pinned on its side
(`RecorderApp/src/storage/recording-loader.test.ts`, "a Tour Viewer authoring
recording"). End to end: `playwright-tests/ar-mode.spec.js`.
