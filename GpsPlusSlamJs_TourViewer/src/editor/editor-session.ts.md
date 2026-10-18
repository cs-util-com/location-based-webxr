# editor/editor-session.ts

## Purpose

The desktop editor's open tour and its edits (M6 E2a): the phone's object
rules (`object-edits.ts`) over the opened tour, and a Save built by the
phone's own Finish rules (`finish-rebuild.ts`). Page-free: the page draws
`model()`, calls the edits and downloads what `save()` returns. Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
§9 ("E2 as revised").

## Public API

- `createEditorSession({ session, manifest, levels, fileName?, draft?, loadPhoto? }): EditorSession`
  - `draft` (M6 E2c) - the `EditorSessionDraft` every edit, move,
    delete, undo and redo is backed up through (`editor-draft.ts`): the
    four `DraftObjectWrites`, whose delete sequence is `draft-actions.ts`'s
    as the phone runs it, plus `saveSettings` for the tour-level settings
    (QR-first M1b-2). An undo or a redo writes, per id whose standing
    against the saved file changed, the record, its tombstone, or their
    removal (`backUpStep`), and the settings record when the setting or
    the details moved.
  - `loadPhoto` (W2) - reads a placed photo's picture by its image name
    (default: the opened zip's `loadContentEntry`); the page passes the
    copy last written, since a save replaces the file. When it fails, the
    picture is read from the session's own last saved bytes
    (`zip-blob.ts`; right after an in-place write the page's copy may not
    read yet, M4a review #5). A save waits for the pictures being read.
  - `model()` - the `EditorModel` of the tour with the edits applied.
  - `changeCount()` - edits and deletions not yet in a saved file, by
    content (a text edited back is no change), plus one while the "needs no
    GPS" setting differs from the saved file, plus one per detail that
    differs from it (W2); `pendingIds()` - the notes
    with an edit or a move not yet saved.
  - `needsNoGps()` / `setNeedsNoGps(on)` (QR-first M1b-2, owner Q-QF-1) -
    the tour's "needs no GPS" setting as it stands with the edits, and its
    edit: `changed` (backed up through `draft.saveSettings`) or
    `unchanged` (the same value: nothing written). A save writes it into
    the manifest it builds (`needsNoGps: true`, which the framework's
    writer puts at minor 2) or leaves the field out (false is never
    written). The phone's Finish keeps the flag the same way: the rebuild
    spreads the opened manifest (`finish-rebuild.ts`).
  - `details()` / `setDetails(form)` / `coverChoices()` (W2 of the tour
    x (`details-dialog.ts`), with the edits; their
    edit, all at once: checked by the format's rules (`tour-details.ts` in
    the framework; the name trimmed, at most `TOUR_NAME_MAX_CHARS` = 80 -
    a name kept as it stands passes whatever its length, so a tour named
    longer elsewhere can still have its other details edited, M4a review
    #10),
    refused in plain words for what the format would drop (never its field
    names in quotes), `unchanged` for the same values, else `changed` and
    backed up through `draft.saveSettings` with the whole record. An
    emptied field REMOVES the detail. The cover choices are the tour's
    images as they stand (its placed photos and image assets,
    `tourImageIds`) with their zip entry (`tourCoverEntry`); a recorded
    walk photo has no id and is no choice.
  - `noGpsCheck()` - `no-gps-check.ts`'s `checkNoGps` over the open
    tour's stations and codes: what the setting's warnings are about (the
    code-less stations, the stations on a code the viewer cannot use, and
    whether a code can place the tour).
  - `editText(id, text)` - `pinTextEdit`'s outcome (`edited`, `unchanged`,
    `refused` with the phone's sentence; `refused` with `NOT_IN_TOUR` for an
    id the tour no longer carries).
  - `move(id, lat, lon)` - `moveObjectTo` (height and facing kept):
    `{ kind: "moved" }`, or `EditorRefusal` (module-private: `refused` with `NOT_IN_TOUR`)
    for an id the tour no longer carries (PR #622 bot finding C); throws
    for a position the tour cannot hold.
  - `remove(id)` - `deleteObject`; `{ kind: "deleted" }`, undone like any
    edit (`undo()`). A deleted photo's picture is kept for that undo - the
    one its entry carries, else read once through `loadPhoto` - since a
    save that writes the delete leaves it out of the file. For an id the
    tour no longer carries it changes nothing and returns the same
    `EditorRefusal` as `editText` and `move`, so the page shows no
    "Deleted" toast and no Undo (finding C). The undo of a delete of an
    edited note writes the record to the draft again.
  - `undo()` / `redo()` (W2 of the tour editor plan 2026-10-17-1816) - one
    step of the edit stack: `{ kind: "undone" | "redone", what }` (`what`
    names the step: `the text of "<label>"`, `the move of …`, `the delete
of …`, `the "needs no GPS" setting`, `the tour details`, `the restored
changes`; a label is cut at 40 characters, a label-less note is "a
    photo" / "a note"), `{ kind: "nothing" }` at either end, or `refused`
    in words: while a save runs (`SAVE_RUNNING`), and for a photo whose
    delete a save wrote and whose picture could not be read
    (`PICTURE_GONE`; the step stays). Every edit kind is one step - a
    text, a move, a delete, the setting, the details (all at once), a
    restore (all of it); a new edit drops what could be redone; at most
    200 steps are kept (`UNDO_LIMIT`).
  - `revision()` (W2) - counts every edit, undo and redo: the page's
    delete toast runs its Undo only while its delete is still the newest
    step.
  - `pictureOf(id)` (W2) - the kept picture of a photo brought back by an
    undo after a save; the card draws it, since the file no longer carries
    it.
  - `restore({ objects, deleted, settings? })` (M6 E2c) - a draft's work
    put back by the session's own rules: an object the tour carries takes
    the draft's version (`upsertPlaced`), a deletion its tombstone
    (`deleteObject`); live work on an id wins; an id the tour no longer
    carries is skipped; the settings are applied unless the setting was
    changed here since the open (counted among `changed`), and the
    record's details likewise unless they were (each changed field counted;
    a cover naming no image of the tour - a photo deleted since - is
    dropped and the rest restored, M4a review #1; other details the format
    would drop leave them as they are); what was applied
    is written to the draft again. Returns the counts.
  - `save({ keepScan })` - `rebuildFinishedTour` with `levels: []`, the
    photo spots decided once per open (`captureSpotsForRebuild`, its result
    kept), `previous` = the last save's bytes; returns `{ blob, filename,
scanLeftOut, notPlaced?, written }` (`written`: the manifest the zip
    carries, for the draft's bases) and advances to what was written
    (`pendingAfterRebuild`).
- `EditorSession`, `EditorSave`, `EditorSessionDraft`, `TOUR_NAME_MAX_CHARS`; the module-private `CoverChoice` (an image id and its zip entry) and `UndoOutcome` (`undo()` / `redo()`'s result) are read through the session's methods.

## Invariants & assumptions

- `find()` never throws (E2c plan review #11, decided): an id the tour no
  longer carries - a card outliving its object - is refused in words.
- A restore is one step to undo, the deletions it applied with it.
- **An undo is an edit** (W2): a step is a snapshot of the edits' effect
  (the objects as they stand, the setting, the details), and going back
  to it is measured against the file as saved NOW - so an undo after the
  save that wrote its step is a change of its own, pending until the next
  save writes it. Written to the draft too - but a note an undo brings
  back after a save wrote its delete is not offered by a later open (the
  draft places nothing new), so such an undo lasts this tab; the page
  therefore holds autosave while a delete's Undo toast is offered (M4a
  review #2, correcting W2's "backed up by the draft").
- Undo and redo are refused while a save runs: the save's end moves the
  saved file the step is measured against.

- Saves run one after another: one called while another runs starts when
  it ends (E2a review #9).
- The edits are snapshotted before the save's first await: an edit made
  while it runs stays for the next save, by content.
- `filename` is `finishedFileName(session)` (the opened file's name, made
  safe); the model's title falls back to `fileName` (the shown name).
- The editor places nothing new yet: every entry is an edit or a move of
  an object the tour carries.
- The setting is snapshotted with the edits: a toggle made while a save
  runs is the next save's; the details likewise.
- **A cover follows its image** (W2): the cover as chosen is kept, but
  shown and written only while its image is in the tour - a deleted photo
  takes the cover with it (no change lingers once that is saved), and an
  undo of the delete brings it back.
- The settings record carries the details only once they were set or
  restored here: a record without them has no opinion about them
  (`editor-draft.ts`).

## Tests

`editor-session.test.ts` on real zips: an edit, a move and a delete reach
the saved `tour.json`; an empty pin refused; a delete undone in place; an
edit made during a save kept for the next; the saved file's name; the
draft's calls (an edited note's delete undone writes its record again),
a restore (live work winning, unknown ids skipped), an unknown id refused,
and a saved zip keyed as opening it would (`tourFileKeyOfFile`). The
"needs no GPS" setting (QR-first M1b-2): written at minor 2 when on and
left out when off (the raw `tour.json`), a toggle back being no change, a
flagged tour opening on and keeping the flag through another edit's save, a
toggle during a save waiting for the next, its draft writes, a restore
(live change winning), and `noGpsCheck`. The tour details (W2): written
at minor 3, each a change until saved; an emptied field removing the
detail and the same values no change; plain-words refusals changing
nothing; the cover choices (photos only, never a pin); the cover going with
its photo; the whole record backed up once per change; a draft's details
restored unless changed here; a draft naming a deleted cover restoring
the rest; a long stored name not blocking other edits; the walk-through
with the real draft (cover chosen, saved, its photo deleted, saved,
reopened: no offer, M4a review #1); a deleted photo's picture read from
the session's last bytes when the page's copy does not read (#5). Undo and redo (W2): every edit kind undone
newest first and redone; a new edit dropping the redo; the revision; an
undo after a save being a change the next save writes; a saved photo
delete coming back with its picture, and refused in words (the step kept)
when the picture could not be read; refused while a save runs; every step
backed up in the draft; a cover coming back with its photo; a restore as
one step.
