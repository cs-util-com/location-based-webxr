# recording-panel.ts

## Purpose

The troubleshooting recording's page controls: the "Record this session for
troubleshooting" switch in step 4, the "Recording" marker inside `#ar-root`
(so it is composited over the camera AND shown on the page), the notice
beside the switch, and "Save the recording". Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a (and §7a, the M1a review's findings 1, 3 and 5).

## Public API

- `wireRecordingPanel({ recording, dom, save, handOff, sessionLive, arHasRun,
estimateStorage, now }): RecordingPanel`
  - `dom`: `optIn` (the switch's checkbox), `marker`, `saveButton`, `status`,
    `notice` (the line beside the switch).
  - `save`: the recording's `save`, bound to the store's flush; resolves
    `{ blob, filename, metadataError? }`.
  - `handOff`: the share-or-download seam the tour zip also uses.
  - `arHasRun`: whether an AR session has run or runs on this page (`main.ts`:
    `ctx.arSessionGeneration > 0` or a live controller status).
  - `estimateStorage`: `navigator.storage.estimate`, or undefined where the
    browser has none.
  - `RecordingPanel.beginOnArEntry(): boolean` - called by the AR entry before
    the session is requested; starts the recording when the switch is on, none
    runs yet, and no unrecorded session has run; says whether this entry
    records (and so needs depth).
  - `RecordingPanel.render()`.
- `recordingMarkerText(status)` (module-private) - the marker's words, or null (hidden).
- `handOverRecording(saved, handOff, now, retryLabel)` ->
  `{ delivered, text }` - hands a packed recording over, marks its folder
  saved (`saved.markSaved(now())`) only when the hand-off DELIVERED, and says
  what happened. The one path "Save the recording" and the orphan offer's
  "Save it" (`recording-offer.ts`) both take (M1b). A mark that does not
  persist is not reported: the zip was handed over; the folder is merely
  offered again on the next open.
- `saveOutcomeText(outcome, filename, metadataError, retryLabel)`
  (module-private) - "Saved as ...", "Shared as ...", the same with ", but
  without its session.json (reason) - the Recorder may replay it
  misaligned.", or "Nothing was saved - tap <retryLabel> again.".
- `SAVE_RECORDING_LABEL`, `SAVE_RECORDING_BUSY_LABEL`.

## Invariants & assumptions

- **Nothing is written behind the creator's back.** The switch only arms the
  recording; it starts at the next AR entry, and from then on the marker is up
  for as long as it runs. The switch then locks on: a recording runs for the
  page's life, and unticking would promise a stop that does not exist.
- **Only the page's first AR entry can be recorded.** The store's zero
  reference (`setZeroPos`) is set by the first GPS fix of the page's first AR
  session and kept across sessions, so a recording started on a later entry
  would hold none and replay empty (M1a review finding 1). Once `arHasRun()`
  is true with no recording running, the switch is disabled and the notice
  says "Reload the page to record."; `beginOnArEntry` refuses to start even
  if the box is ticked.
- **Free space is checked at opt-in, and only warned about.** Ticking the box
  asks `estimateStorage()` and shows `lowStorageWarning` (from
  `authoring-recording.ts`, which also holds the threshold and its reasoning)
  in the notice; unticking clears it, and an estimate that arrives after an
  untick is dropped. No estimate, or one that fails, shows nothing: it is
  advice, never a gate.
- **Save is a page action.** Disabled while an AR session runs (the session
  still writes into the folder, and a download needs its own tap); outside
  `#ar-root`, so never over the camera.
- **Async-UI rule.** Busy label and disabled while the zip is built and handed
  over; then the durable outcome (the file's name, or that nothing was saved);
  a failure surfaces its reason and the button comes back. A tap while busy
  starts nothing. A zip saved without its `session.json` says so, because the
  Recorder then takes it for an old recording and migrates its coordinates.
- **Privacy.** The static line beside the switch (`index.html`) says the
  recording holds the tour link and the GPS track.
- **Creator-only.** `main.ts` wires it only in creator mode; the block wears
  `.creator-only`.
- Reaches no globals: every element, the clock, the storage estimate and the
  hand-off are injected. `render` runs after every store dispatch, so it
  writes text only when it changed.

## Examples

```ts
const panel = wireRecordingPanel({
  recording,
  dom: { optIn, marker, saveButton, status, notice },
  save: () =>
    recording.save({
      flush,
      nowMs: Date.now(),
      userAgent,
      pageUrl,
      getBuildInfo,
    }),
  handOff: (blob, name) => seams.shareOrDownloadZip(blob, name),
  sessionLive, // is an AR session live now?
  arHasRun, // has one run on this page (ended, or live now)?
  estimateStorage: () => navigator.storage.estimate(),
  now: () => new Date(),
});
```

## Tests

`recording-panel.test.ts`: an unticked switch starts nothing; a ticked one
starts the recording at the entry, shows the marker, locks the switch and
shows Save; a later entry does not start a second recording; the marker counts
failed writes and says when the recording could not start; before any AR
session the switch is free, after an unrecorded one it locks with the reload
line (and a ticked box starts nothing), and a running recording keeps it
locked without that line; Save is disabled during a session; the free-space
warning at opt-in (shown under the threshold without blocking, silent with
room or without an estimate, cleared by an untick); the busy then saved
state, the share wording, the nothing-saved wording, the missing-session.json
wording, a failure with its reason, and no second save while busy; the saved
mark only after a hand-off that delivered, at its moment, and a mark that does
not persist still reports the save (M1b). End to
end: `playwright-tests/ar-mode.spec.js` (the recording e2e) and
`ar-layout.spec.js` (the marker inside the overlay's tallest state).
