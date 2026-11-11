# editor/editor-open.ts

## Purpose

Opening a file in the desktop editor (M6 E1): the viewer's own
`openTourFile` (its zip-bomb caps and integrity checks), then the manifest
and the codes, or the reason the file cannot be edited, worded by
`open-errors.ts`.

## Public API

- `openTourForEditing(file, { onIntegrityFailure?, open? }): Promise<EditorOpen>`
  - `{ kind: "opened", session, manifest, levels, fileName, dropped }` -
    `manifest` is the file's, an empty one for a tour with codes but no
    `tour.json`; the walk's debug camera captures start no station (until
    M1 of the debug-captures plan the open baked them into stations; an
    earlier file's `captureSpots` is an unknown field to the reader);
    `dropped` lists the details the format's reader left out (a
    hand-edited description, contact or cover; M4a review #6) and the
    stations whose description or card image it left out (format minor 2:
    a card image naming a picture the tour no longer has,
    `station-image-gone`, or a value a hand edit broke, no cause; G2 build plan
    `GpsPlusSlamJs_Docs/docs/2026-10-21-2247-g2-3d-editor-build-plan.md`,
    Q14) - `TourManifestDrop`s.
  - `{ kind: "refused", reason }`:
    - `NOT_A_ZIP` for a name without `.zip` and a type other than
      `application/zip` (checked before any read);
    - `describeOpenError(err)` when the opener refuses (a cap, a broken
      zip, a failed integrity check);
    - `NOT_A_TOUR` for a zip with neither `tour.json` nor a code (a
      Recorder or scan zip) - refused rather than shown as an empty map
      (M6 E1 plan review #8);
    - "This tour cannot be read: ..." when the manifest or a level rejects
      after the open succeeded;
    - for a tour of an older format (`TourManifestOlderFormatError`),
      `olderFormatRefusal(err, false)` (`open-errors.ts`) with
      `olderFormat: { fileKey, error }` - the file's key (its session's
      `archive.url`, the draft's key) so the page can delete the draft it
      kept for it and say so.
  - `onIntegrityFailure` is passed to the opener for the late (background)
    check; `open` replaces the opener in tests.
- `droppedDetailsLine(dropped): string | null` - the page's toast for
  them: which details ("This tour's cover and contact could not be
  read..."), that the next save writes the tour without them, and to set
  them again; null for none. A station's drops (the only ones that carry
  `station`) and a block's, a block field's or a character's (the ones
  that carry `kind`) are not details and are not listed here.
- `droppedStationFieldsLine(dropped, manifest): string | null` - the toast
  for the dropped station descriptions and card images: which stations,
  named as the rail names them (`stationTitle` against `manifest`: the
  title, else "Station N"; never the random id), the gone images apart
  from the unreadable values (`The card image of "The old well" names a
picture this tour no longer has. The description of "Station 3" could
not be read. The editor left them out: ...`), and that the next save
  writes them without; null for none. Not told to set them again in the
  tour's details: neither is a tour detail.
- `droppedBlockFieldsLine(dropped, manifest): string | null` - the toast
  for a block's text the reader left out (a transcript, a caption or a
  description over its cap: the block is kept, the text is not): which
  blocks, named by `objectTitle` (the id only for a block the manifest
  does not hold), and that the next save writes them without it; null
  for none. Whole blocks a reader cannot show are not listed here.
- `droppedFolderScalesLine(dropped, manifest): string | null` - for the
  plain folders whose size (`scale`, a newer editor's outside 0.1 to 10) the reader left
  out: which folders, by their names ("a folder without a name" for one
  with none), that their items show at their own size, and that the next
  save writes the folders without it; null for none.
- `droppedFolderTitlesLine(dropped): string | null` - for the plain
  folders whose names the reader left out (over this editor's cap of 80,
  in a newer minor's file): how many (the names are gone, so they are
  counted), that each shows as "Folder", and that the next save writes
  them without their names; null for none.
- `droppedChildrenLine(dropped): string | null` - for whole items the
  reader could not read (a `child` or a `block` drop: a newer kind, a
  choice left with fewer than two ways on): how many (they are gone from
  the tour as opened, so they cannot be named), and that the next save
  writes the tour without them; null for none.
- `openedNoticeLines(dropped, manifest): string[]` - every line above
  that applies, in the order the page shows them (`edit-main.ts`). The
  plain folders themselves take no line: the editor keeps them (`tour-document.ts`,
  `framesOf` and `withTourContent`) and the next save writes them back.
- `showOpenedNotices(lines, superseded, toast): T[]` - shows the lines,
  then a superseded draft's line, each as a toast that stays until closed
  (`holdMs` null), in that order; returns the toasts for the page to close
  with the file.
- `EditorOpen`, `NOT_A_TOUR`, `NOT_A_ZIP`.

## Invariants & assumptions

- A refused open closes the session it made.
- Never throws: every failure is a `refused` with a sentence.

## Tests

The folder-size, folder-name and whole-item lines on a newer minor's tour read
leniently (and on hand-made drops: one folder, repeated ids, none), and
`showOpenedNotices`'s order and stay-until-closed toasts, are in
`editor-open.test.ts` too.

`editor-open.test.ts` on real zips: a tour, a zip without a tour, a broken
`tour.json`, a non-zip name (the opener never called), a zip the opener
refuses, the dropped details named in the toast's words, and the dropped
station descriptions and card images named apart from them, by station
name (title or "Station N"), gone images apart from unreadable values.
