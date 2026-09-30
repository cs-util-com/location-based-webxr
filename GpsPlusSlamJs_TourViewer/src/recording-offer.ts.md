# recording-offer.ts

## Purpose

The offer of a troubleshooting recording a killed tab left unsaved: "The
recording from <time> was not saved. Save it or delete it?", one recording
at a time, inside the recording block beside the record switch. Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1 ("An unsaved recording left by a killed tab is offered on the next
open, reusing the draft-offer machinery"), M1b.

## Public API

- `wireRecordingOffer({ dom, pack, discard, handOff, now, describeTime, reveal }): RecordingOffer`
  - `dom`: `offer` (container), `text`, `saveButton`, `dismissButton`,
    `discardButton`, `status` (the recording block's outcome line, shared
    with "Save the recording").
  - `pack(name)`: `packOrphanRecording`, bound - rebuilds the folder's
    `session.json` and zips it; resolves a `PackedRecording`.
  - `discard(name)`: `deleteRecordingFolder`, bound.
  - `handOff`: the share-or-download seam every zip uses.
  - `describeTime(ms)`: the start time in the page's locale.
  - `reveal()`: open the step the offer sits in (`wizard.revealStep`).
  - `RecordingOffer.present(recordings)`: offer these (oldest first); an empty
    list offers nothing and reveals nothing.
- `RECORDING_OFFER_SAVE_LABEL` ("Save it"), `RECORDING_OFFER_SAVE_BUSY_LABEL`.

## Invariants & assumptions

- **What it reuses of the draft offer, and what not.** The pattern: offered,
  never applied; three choices because declining and deleting are different
  intentions ("Not now" hides it and it comes back on the next open; "Delete
  it" is the only way an unsaved recording is removed); and it reveals its
  step, the draft offer's M5 review #8 lesson (an element un-hidden inside a
  collapsed `<details>` is no signal). The saved marker goes through the
  draft store's `DraftFileStore` (`recording-folders.ts`). NOT the draft
  offer's element: that one belongs to a tour's draft, appears when a tour
  opens and in creator mode only, while this one appears at page open in
  both modes (a visitor's `?debug=1` recording too) - and both can be pending
  at once, so one element would need a queue shared by two owners.
- **"Save it" takes "Save the recording"'s path** (`handOverRecording` in
  `recording-panel.ts`): the folder is marked saved only after a hand-off
  that delivered; the outcome wording is the same ("Saved as ...", "Shared as
  ...", the missing-`session.json` note, "Nothing was saved - tap Save it
  again."). A delivered save moves to the next recording; one that delivered
  nothing keeps the offer up.
- **Async-UI rule.** Save: "Saving the recording…" and all three buttons
  disabled until the hand-off settles. Delete: "Deleting…" likewise, then
  "Deleted the recording from <time>." Each failure names its reason in the
  status line and leaves the offer up with the buttons back. A tap while
  busy starts nothing.
- **Several recordings**: one at a time, oldest first, with "(n of m)".
- Reaches no globals; tested in node with plain objects.

## Examples

```ts
const offer = wireRecordingOffer({
  dom,
  pack: (name) => packOrphanRecording(dir, name, env, AUTHORING_CONTEXT_TAG),
  discard: (name) => deleteRecordingFolder(dir, name),
  handOff: (blob, filename) => seams.shareOrDownloadZip(blob, filename),
  now: () => new Date(),
  describeTime: (ms) => new Date(ms).toLocaleString(),
  reveal: () => wizard.revealStep("measure"),
});
offer.present(
  await tidyRecordings(dir, () => heldRecordingFolders(locks), Date.now()),
);
```

## Tests

`recording-offer.test.ts`: nothing offered for an empty list; the offer names
the start time, reveals its step and applies nothing untapped; Save's busy
state, the saved name, the mark at the moment of the hand-off and the next
recording; a hand-off that delivered nothing; a failed save; Not now deletes
nothing; Delete's busy state, its outcome and the next; a failed delete; no
second action while busy. End to end: `playwright-tests/ar-mode.spec.js` ("a
recording whose tab was killed ...").
