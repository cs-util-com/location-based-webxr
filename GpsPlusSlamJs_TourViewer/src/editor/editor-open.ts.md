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
    stations whose card image names a picture the tour no longer has
    (format minor 2, `station-image-gone`; G2 build plan
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
      after the open succeeded.
  - `onIntegrityFailure` is passed to the opener for the late (background)
    check; `open` replaces the opener in tests.
- `droppedDetailsLine(dropped): string | null` - the page's toast for
  them: which details ("This tour's cover and contact could not be
  read..."), that the next save writes the tour without them, and to set
  them again; null for none. Station card images are not details and are
  not listed here.
- `droppedStationImagesLine(dropped): string | null` - the toast for the
  dropped card images: which stations, by id (`The card image of station
"well" names a picture this tour no longer has...`), and that the next
  save writes them without it; null for none. Not told to set it again in
  the tour's details: a card image is no tour detail.
- `EditorOpen`, `NOT_A_TOUR`, `NOT_A_ZIP`.

## Invariants & assumptions

- A refused open closes the session it made.
- Never throws: every failure is a `refused` with a sentence.

## Tests

`editor-open.test.ts` on real zips: a tour, a zip without a tour, a broken
`tour.json`, a non-zip name (the opener never called), a zip the opener
refuses, the dropped details named in the toast's words, and the dropped
station card images named apart from them.
