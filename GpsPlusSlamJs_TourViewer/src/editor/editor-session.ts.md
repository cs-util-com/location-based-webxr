# editor/editor-session.ts

## Purpose

The desktop editor's open tour and its edits (M6 E2a): the phone's object
rules (`object-edits.ts`) over the opened tour, and a Save built by the
phone's own Finish rules (`finish-rebuild.ts`). Page-free: the page draws
`model()`, calls the edits and downloads what `save()` returns.

**The tour itself is not here** (D29-D31, root rule "App state lives in the
Redux store"): the open tour, its edits, the history and the save status
are the store's `tourDocument` slice (`../tour-document.ts`), shared with
the phone's creator in a later milestone. The session is the page's facade
over it: it asks the document's own guards first (`objectFits`,
`canPlace`, `canStep` - the reducers keep the same rules, so a refusal
here is only the page's words for one) and checks what only the page can
(a photo's picture for an undo), then dispatches. An edit's payload is
shaped by the document too (`pinTextChange`, `objectMoveChange`), and the
save is the document's (`../tour-document-save.ts`): thunks dispatched
into the store, whose handle keeps the newest bytes, the photo spots'
decision and the save queue, while the slice's save status says whether
a save runs, landed or failed. The session imports none of the shared
rules itself (`config/.dependency-cruiser.cjs`). Its closure keeps
imperative resources only - that handle and the pictures' side table
(Blobs are never state). Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
§9 ("E2 as revised").

## Public API

- `createEditorSession({ session, manifest, levels, fileName?, draft?, loadPhoto?, store? }): EditorSession`
  (`manifest` as `openTourForEditing` opened it; the document drops a
  file's debug camera captures)
  - `store` - the page's `createTourViewerStore()`; a fresh one when
    absent (tests). Creating the session dispatches `opened` (with a
    fresh `newTourId()` for a tour without an id, Q-I): whatever
    the store's document held is gone, and an older session on the same
    store is disowned (`generation`) - its edits are refused with
    `NOT_IN_TOUR`, a save it started before lands nowhere, a save or a
    move of the walk asked of it after refuses ("Another tour was
    opened since"), and everything it reads (`model`, the counts, the
    details) is its own tour as it stood when replaced - never the new
    one's (the r875 milestone review #4). "As it stood" follows the store
    (a listener on `listenToDocument` keeps the newest state of this open
    after every action that changed the document), so an edit or a landed
    save that no read followed is part of it. This relies on Redux
    Toolkit's listener middleware calling the effect synchronously after
    the reducer, inside the dispatch (its `notifyListener` calls the
    effect before its first await): a read right after a dispatch never
    finds `last` behind.
  - `draft` (M6 E2c) - the `EditorSessionDraft` every edit, move,
    delete, undo and redo is backed up through (`editor-draft.ts`): the
    four `DraftObjectWrites`, whose delete sequence is `draft-actions.ts`'s
    as the phone runs it, plus `saveSettings` for the tour-level settings
    (QR-first M1b-2). The draft follows the document's STATE, not the
    gesture: a listener on the store's `listenToDocument` runs
    `followDocument` (`../tour-document-draft.ts`) after each edit, undo,
    redo or restore - per id whose standing against the saved file
    changed, the record, its tombstone, or their removal, and the settings
    record when it changed.
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
    with an edit or a move not yet saved; `savedName()` - the name every
    save of this open is written under (`finishedFileName`), which the page
    names the walk's file after before a save ran (the r875 milestone
    review #6: the page no longer imports the Finish's rules).
  - `needsNoGps()` / `setNeedsNoGps(on)` (QR-first M1b-2, owner Q-QF-1) -
    the tour's "needs no GPS" setting as it stands with the edits, and its
    edit: `changed` (backed up through `draft.saveSettings`) or
    `unchanged` (the same value: nothing written). A save writes it into
    the manifest it builds (`needsNoGps: true`, which the framework's
    writer puts at minor 2) or leaves the field out (false is never
    written). The phone's Finish keeps the flag the same way: the rebuild
    spreads the opened manifest (`finish-rebuild.ts`).
  - `details()` / `setDetails(form)` / `coverChoices()` (W2 of the tour
    editor plan 2026-10-17-1816) - the tour's name, description, cover and
    contact as a `DetailsForm` (`../tour-details-form.ts`), with the edits;
    their edit, all at once: checked by `checkDetailsForm` through the
    document's `detailsChange` (shared with the phone's rename)
    (`../tour-details-form.ts`: the format's rules, `tour-details.ts` in
    the framework; the name by `checkTourTitle`, trimmed, at most
    `TOUR_TITLE_MAX_CHARS` = 80 characters counted as code points -
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
    stations farther than 40 m from every code that can place the tour,
    and whether a code can place it).
  - `editText(id, text)` - `pinTextEdit`'s outcome, through the document's
    `pinTextChange` (`edited`, `unchanged`, `refused` with the phone's
    sentence; `refused` with `NOT_IN_TOUR` for an id the tour no longer
    carries).
  - `move(id, lat, lon)` - `moveObjectTo` (height and facing kept),
    through the document's `objectMoveChange`:
    `{ kind: "moved" }`, or `EditorRefusal` (module-private: `refused` with `NOT_IN_TOUR`)
    for an id the tour no longer carries (PR #622 bot finding C). Beyond
    the note's station's found radius the slice's station rule seats it
    anew (the station holding its new spot, or a new one there), so no
    move is too far: the format's 10 km bound between an item and its
    station (`TOUR_ITEM_MAX_OFFSET_M`), which once made every later save
    fail after a far drag, cannot be crossed by a move. Throws for a
    position nobody can draw.
  - `remove(id)` - `deleteObject`; `{ kind: "deleted" }`, undone like any
    edit (`undo()`). A deleted photo's picture is kept for that undo - the
    one its entry carries, else read once through `loadPhoto` - since a
    save that writes the delete leaves it out of the file. For an id the
    tour no longer carries it changes nothing and returns the same
    `EditorRefusal` as `editText` and `move`, so the page shows no
    "Deleted" toast and no Undo (finding C). The undo of a delete of an
    edited note writes the record to the draft again.
  - `place(object)` - a new object (`placed`): refused for an id the
    tour carries and for a spot further from its station than a tour can
    carry. The desktop has no placing gesture yet; the parity contract
    drives it, as the phone places in AR.
  - `moveStation(stationId, geo)` - D17 (`stationMoved`): the frame moves
    and every object of the station moves rigidly with it, each an edit at
    its new spot (its local pose kept), as the phone's settle leaves its
    lists. Refused for a station the tour does not carry, and (in the same
    words as an object's move, "That spot is not on the map.") for a pose
    that is no spot: a latitude, longitude or height that is not finite,
    a latitude or longitude out of range, or a heading or rotation that is
    not finite. The 3D view's drag of a station's middle reaches it.
  - The 3D editor's station and item edits (desktop only; the phone edits
    stations by placing in AR). Each is ONE step through the document's
    actions (`../tour-document.ts.md`), backed up through the draft like
    any edit, and refused in plain words, changing nothing, for what the
    document's guards refuse (the station field the format refuses,
    `stationEditChange`; `NOT_IN_TOUR` for an id the tour no longer
    carries; `NOT_APPLIED` when the tour changed under the call):
    - `editStation(stationId, edit)` - title, found radius (2 m to 300 m),
      description, card image (`StationEdit`): `edited` or `unchanged`.
      `unchanged` also when the document dropped the edit (its revision
      did not move): an edit of a station a delete emptied that leaves it
      with nothing of its own (its radius alone) is not listed, so no step
      was taken. Known case, left for the inspector-editing milestone: a
      title cleared on such a station, while it is selected, takes it off
      the list under the selection - the edit is right (a reload agrees),
      but the inspector loses what it showed.
    - `addStation({ lat, lon, alt })` - an empty automatic station there,
      `Station N` by its place: `added` with its new id; `NOT_ON_MAP` for
      a point nobody can draw.
    - `deleteStation(stationId)` - the station with its items and every
      route to it; the tour's last station is refused (`LAST_STATION`).
      Its photos' pictures are kept for the undo, as `remove` keeps one.
    - `reorderStations(order)` - every station once (`NOT_AN_ORDER`
      otherwise): `reordered` or `unchanged`.
    - `duplicateStation(stationId)` / `duplicateObject(id)` (async) - a
      copy beside the original (a station twice its found radius plus 5 m
      east, an item 1.5 m east); a photo's picture is read first (the
      page's copy, `loadPhoto`, then the newest zip; `PICTURE_UNREAD` when
      none reads) and held under the copy's id, so the save writes the
      copy's own `content/<id>.<ext>` and the draft keeps it.
    - `groundItems([{ id, alt }])` - "Put on the ground": the altitudes the
      page measured, ONE step for all; refused whole for an unknown id or
      a height beyond an item's reach of its station (`HEIGHT_REFUSED`).
    - `resizeModel(id, sizeM)` - a placed model's size, 0.05 m to 500 m
      (`MODEL_SIZE`; `NOT_A_MODEL` for anything else).
    - `pose(id, geo, { newStation? })` - an item at a whole pose (position,
      height, turn): beyond its station's radius the rule seats it anew;
      `newStation` ("Move to a new station") starts one where it stands.
    - `moveToNewStation(id)` - "Move to a new station" where the item
      stands, turned as it is: one step, `{ kind: "moved", stationId }`
      naming the station it made; refused for an id the tour lacks.
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
    200 steps are kept (`TOUR_HISTORY_LIMIT`). The history is the
    document's, over all of it - the station frames included - so an undo
    after a save that dropped an emptied station brings it back WHERE IT
    STOOD in the order (the M5a review M2 deviation, settled).
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
    carries is skipped; an object its station cannot carry (a draft
    written before far moves re-ran the station rule) is seated by the
    rule, never skipped; the stations the draft's objects were seated in
    that the tour lacks come back whole first (the record's
    `createdStations`);
    the settings are applied unless the setting was
    changed here since the open (counted among `changed`), and the
    record's details likewise unless they were (each changed field counted;
    a cover naming no image of the tour - a photo deleted since - is
    dropped and the rest restored, M4a review #1; other details the format
    would drop leave them as they are); the record's station poses unless a
    station was moved here (each station whose pose differs counted; applied
    before the objects, so an item restores under the frame it was placed
    under, and its reach is checked there - review #1 of the tour document
    milestone); the stations edited there (the record's `frames`, at the
    opened file's poses, `order` and `deletedStations`: a station renamed,
    added, deleted, reordered or copied there; the stations it does not
    name keep the opened file's version) unless a station was changed
    here (each station change counted, `stationEditsBetween`); a copy made there (the offer's
    `made`, an id the tour does not carry) put back with its picture
    (`pictures`; a photo copy without one is skipped); what was applied
    is written to the draft again. Returns the counts.
  - `save({ keepScan, inPlace? })` - the document's save thunk
    (`../tour-document-save.ts` `save`, through `dispatchThunk`):
    `rebuildFinishedTour` with `levels: []`, from the last
    save's bytes; returns `{ blob, filename, scanLeftOut, written }` (`written`: the manifest the zip carries, for the draft's
    bases) and advances to what was written (`saved`,
    `pendingAfterRebuild`). `inPlace`: the page writes it over the opened
    file, and the document learns where in its history that file stands
    (`saved`'s `inPlaceAt`): an undo or a redo across it is then due a
    resave (D33, `../tour-document.ts.md`).
  - `saveCopy({ keepScan })` - File's "Save a copy…": the same rebuild as
    `save` (queued behind a running save, the pictures read first), from
    the same snapshot, named by `copyFileName`; it never lands - the
    document, its change count, its history and where its file stands are
    as they were, so the next `save` still writes the tour's own file.
    Refused like `save` once another tour replaced the session.
  - `debugData()` - the debug data of the OPENED file
    (`session.readWholeArchive()` under the session's budget) as a debug
    bundle (`buildDebugBundle`, the same identity as the move's), queued
    with the saves; refused in words for a file without a walk. For "Save
    the debug data" after a save that left the walk out (M2 of the
    debug-captures plan): the newest bytes then carry none.
    Changes nothing of the session. For a tour opened from a file the
    "opened bytes" are a reference to that file (a `File`), read when
    this runs: valid only while the file on disk is unchanged - a copy put
    in its place first makes the read fail, which the caller shows.
  - `debugTour()` - the tour an added debug data file is compared with
    (`bundleMatchesTour`, "Add debug data…"): a listed tour's series, the
    tour id the OPENED file carries (never the one its open minted, which
    is in no file until a save writes it: comparing by it would call this
    session's own bundle another tour's once the original, still without
    an id, is opened again), the title of the newest written file (an
    edit not yet saved is not the file's), the saved file name. A bundle
    this session saves names the tour id of the newest written file
    (`debugData`, the move), the copy it was saved beside (r901 review
    #2).
  - `walkEntries()` - the walk recording's entries in the newest bytes
    (the last save's, else the opened file's; `scanEntryNames`): none once
    it was moved out, or when a save left it out.
  - `moveWalkOut()` - "Move the debug data out" (W2, D19), queued with
    the saves: a `WalkMove` with the debug bundle (`buildDebugBundle` of
    `../debug-bundle.ts`, M2 of the debug-captures plan: the whole
    recording of the newest bytes, every frame included, so it is a
    complete recording on its own - byte for byte, under its own paths,
    plus `debug-bundle.json` and the note naming the tour's file, its
    title and, for a listed tour, its series; the M4b milestone review #8;
    named by `debugBundleFileName`, `castle.zip` -> `castle-debug.zip`;
    it replaced the walk's own zip, `castle-walk.zip` with
    `about-this-walk.txt`) and the tour
    rebuilt without the walk (`keepScan: false`, with the pending edits
    from the same bytes: the opened file is read once), or a refusal in
    words: `NO_WALK`. Every recorded frame moves with the walk, also one
    a file's capture spots named: a visitor never reads it.
    **Nothing changes until
    `commit()`**: the page writes the walk's zip first, then the tour,
    and commits only when both landed; `current()` says no other save
    landed since the build (asked before the tour is written, so a stale
    move writes nothing); `commit(inPlace?)` (`inPlace`: the tour was written
    over the opened file, as for `save`) then makes the
    walk-free bytes the newest (the save handle's `land`; the series
    version advances as in any
    save), so no later save - an in-place autosave keeps "the walk" of the
    bytes it rebuilds from - can bring the walk back. It throws when
    another save landed since the move was built (the page holds saves
    while a move runs). A moved-out bundle never comes back into the
    tour; the editor only shows it (`edit-main.ts`, "Add debug data...").
- The module-private `WalkMove` and `NO_WALK` are read through `moveWalkOut()`.
- `EditorSession`, `EditorSave`, `EditorSessionDraft`, `TOO_FAR_FROM_STATION`; the module-private `CoverChoice` (an image id and its zip entry) and `UndoOutcome` (`undo()` / `redo()`'s result) are read through the session's methods.

- `copyFileName(name)` - a copy's file name: " copy" before a trailing
  `.zip` (any case), or at the end of a name without one
  ("tour.zip" -> "tour copy.zip").

## Invariants & assumptions

- `find()` never throws (E2c plan review #11, decided): an id the tour no
  longer carries - a card outliving its object - is refused in words.
- A restore is one step to undo, the deletions it applied with it.
- **An undo is an edit** (W2): a step is a snapshot of the edits' effect
  (the objects as they stand, the setting, the details), and going back
  to it is measured against the file as saved NOW - so an undo after the
  save that wrote its step is a change of its own, pending until the next
  save writes it. Written to the draft too - but a note an undo brings
  back after a save wrote its delete is offered by a later open only when
  its record carries no `seen` base (`editor-draft.ts.md`), so such an undo
  may last only this tab; the page
  therefore holds autosave while a delete's Undo toast is offered (M4a
  review #2, correcting W2's "backed up by the draft").
- Undo and redo are refused while a save runs: the save's end moves the
  saved file the step is measured against.

- Saves (and moves of the walk) run one after another: one called while
  another runs starts when it ends (E2a review #9).
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
- `stationLocked` (optional input): `moveStation` refuses a station it names as locked with `STATION_LOCKED`, before anything is dispatched. A station's radius, title, delete and copy are not pose edits and stay open. Undo and redo are outside the lock: they replay steps already made. So is a draft's Restore (`restore`): it puts back station poses the creator made in an earlier visit, locked or not - a replay of their own work, as an undo is. Without the input (the phone, a test) every station moves as before.

## Tests

`editor-session.test.ts` on real zips: an edit, a move and a delete reach
the saved `tour.json`; an empty pin refused; a delete undone in place; an
edit made during a save kept for the next; the saved file's name; the
draft's calls (an edited note's delete undone writes its record again),
a restore (live work winning, unknown ids skipped), an unknown id refused,
a move far beyond its station seated in a station at its new spot (and
the emptied one dropped) and a draft offering one restored the same way, a
new note NAMING a station too far away refused in words
(`TOO_FAR_FROM_STATION`),
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
the session's last bytes when the page's copy does not read (#5). Moving
the walk out (W2, D19): the walk's zip carrying the whole recording byte
for byte (the frame a file's capture spots named too) and the note, and the tour none of the
walk, also after the next save with `keepScan`; nothing changed before
`commit()`; `commit()` refused once another save landed; every frame
the walk's (also one a file's capture spots named, which the document
drops); a tour whose file carries no capture spots moved out the same,
and one without a walk refused; the note naming a listed tour's file,
name and series; the opened file read once; a walk none of whose frames
the tour carries (the real sample recording without its photos) moved
out, and left out by a lean save; the walk's file name. Undo and redo (W2): every edit kind undone
newest first and redone; a new edit dropping the redo; the revision; an
undo after a save being a change the next save writes; a saved photo
delete coming back with its picture, and refused in words (the step kept)
when the picture could not be read; refused while a save runs; every step
backed up in the draft; a cover coming back with its photo; a deleted
placed model coming back across a save with its model file (the history
keeps the asset); a restore as one step; an undo after a save that dropped the emptied station putting the
note back into that station (the M5a milestone review M2,
`tour-content.ts`).
`editor-session-stations.test.ts` on real zips: each station edit one
undo step, and each refusal in words changing nothing; an edit the document
drops (the radius of a station a delete emptied) "unchanged"; the last station
refused, another deleted as one step; a copied photo station saving the
copy's picture under its own content file; an item moved into a station
of its own and items put on the ground as one step; renamed, added,
copied, deleted and reordered stations coming back from the real draft
after a reload as the save had them.
The tour document (D29-D31): a later open on the same store disowning the
session (its edits refused, a save begun before landing nowhere, one asked
for after refused, its reads its own tour), and a replaced session reading
its tour as it stood when replaced, an edit no read followed included. The
save thunk itself: `../tour-document-save.test.ts`. Save a copy: the
copy carrying the edits under "<name> copy.zip" while the change count,
the undo and the next save are as before; `copyFileName`'s cases; a
copy asked for during a save waiting for it.

`station-lock.property.test.ts` drives a real session with random command sequences (moves, radius, rename, delete, copy, reorder, item moves and poses, grounding, adds, and the lock itself; up to 30 at full length) and checks that no command changes a station's pose while it is locked, plus the refusal's words and the open edits.
