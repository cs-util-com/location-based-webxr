# save-toast.ts

## Purpose

The words of the toast an explicit Save ends with on the desktop editor
(`edit-main.ts`), and whether that toast offers "Save the debug data".

A download of a file the page cannot write leaves the walk recording out of
the copy by default, so the opened file is then its only copy. "Save the
debug data" reads that file when it runs (the page keeps a reference to
it, not a copy: `EditorSession.debugData`), so the creator must save the
debug data BEFORE putting the copy in the file's place. The toast says the
debug-data step first and offers it as its action (r901 review #1: the
toast used to say "put it in place" first, which, followed, could lose the
walk).

## Public API

- `savedToastWords({ inPlace, name, leftOut }) -> { text, offerDebugSave }`
  - pure.
  - `inPlace`: the save was written over the opened file. Says
    `Saved to <name>.`, plus `FINISH_LABELS.scanLeftOut` if anything was
    left out; never offers the save (the opened file was the one written,
    so nothing can be read back from it).
  - a download that left nothing out: `Saved as <name>. Put it in place of
the old file, under the same name, so the printed codes keep opening
it.`; no offer.
  - a download that left `leftOut > 0` files out: `Saved as <name>.`, then
    `FINISH_LABELS.leanCopy(leftOut)`, then "Save the debug data first,
    before you put this copy in place: it is read from the file you
    opened.", then "Then put it in place of the old file, ..."; offers the
    save.

## Invariants

- `offerDebugSave` is exactly `!inPlace && leftOut > 0`.
- When it is offered, the debug-data step comes before the put-in-place
  step in `text`.
- The page runs the offered action through the same `saveDebugData` as the
  Done dialog's button, called in the click (its save dialog needs it),
  with "Saving the debug data…" on the toast's button meanwhile and the
  result (`debugSaveResultLine`, `done-dialog.ts`) in a toast of its own.

## Tests

- `save-toast.test.ts`: the three cases, and a property over every count
  that the offer and the order follow the rule.
- `playwright-tests/editor.spec.js`: "after a lean download, its toast says
  to save the debug data first, and its button saves it".
