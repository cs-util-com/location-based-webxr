# recording-panel.ts

## Purpose

The troubleshooting recording's page controls: the "Record this session for
troubleshooting" switch in step 4, the "Recording" marker inside `#ar-root`
(so it is composited over the camera AND shown on the page), and "Save the
recording". Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a.

## Public API

- `wireRecordingPanel({ recording, dom, save, handOff, sessionLive, now }):
RecordingPanel`
  - `dom`: `optIn` (the switch's checkbox), `marker`, `saveButton`, `status`.
  - `save`: the recording's `save`, bound to the store's flush.
  - `handOff`: the share-or-download seam the tour zip also uses.
  - `RecordingPanel.beginOnArEntry(): boolean` - called by the AR entry before
    the session is requested; starts the recording when the switch is on and
    none runs yet, and says whether this entry records (and so needs depth).
  - `RecordingPanel.render()`.
- `recordingMarkerText(status)` (module-private) - the marker's words, or null (hidden).
- `saveOutcomeText(outcome, filename)` (module-private) - "Saved as ...", "Shared as ...", or
  "Nothing was saved - tap Save the recording again.".
- `SAVE_RECORDING_LABEL`, `SAVE_RECORDING_BUSY_LABEL`.

## Invariants & assumptions

- **Nothing is written behind the creator's back.** The switch only arms the
  recording; it starts at the next AR entry, and from then on the marker is up
  for as long as it runs. The switch then locks on: a recording runs for the
  page's life, and unticking would promise a stop that does not exist.
- **Save is a page action.** Disabled while an AR session runs (the session
  still writes into the folder, and a download needs its own tap); outside
  `#ar-root`, so never over the camera.
- **Async-UI rule.** Busy label and disabled while the zip is built and handed
  over; then the durable outcome (the file's name, or that nothing was saved);
  a failure surfaces its reason and the button comes back. A tap while busy
  starts nothing.
- **Creator-only.** `main.ts` wires it only in creator mode; the block wears
  `.creator-only`.
- Reaches no globals: every element, the clock and the hand-off are injected.

## Examples

```ts
const panel = wireRecordingPanel({
  recording,
  dom: { optIn, marker, saveButton, status },
  save: () => recording.save({ flush, nowMs: Date.now(), userAgent, pageUrl }),
  handOff: (blob, name) => seams.shareOrDownloadZip(blob, name),
  sessionLive: () => arSessionLive(arController.getState().status),
  now: () => new Date(),
});
```

## Tests

`recording-panel.test.ts`: an unticked switch starts nothing; a ticked one
starts the recording at the entry, shows the marker, locks the switch and
shows Save; a later entry does not start a second recording; the marker counts
failed writes and says when the recording could not start; Save is disabled
during a session; the busy then saved state, the share wording, the
nothing-saved wording, a failure with its reason, and no second save while
busy. End to end: `playwright-tests/ar-mode.spec.js` (the recording e2e) and
`ar-layout.spec.js` (the marker inside the overlay's tallest state).
