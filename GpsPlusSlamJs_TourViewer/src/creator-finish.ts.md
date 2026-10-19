# creator-finish.ts

## Purpose

The creator's Finish: the open tour rebuilt in the browser (DEC-N6) with
the measured level, the manifest and the photos, a listed tour's series
continued, the walk left out unless kept, and what the written zip changes
on the page; plus the keep-the-walk switch. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M4 makes it write every code of the book, not only the one in hand.

Since M6 E0 the page-free rules below - the manifest with the edits, the
title, the files written and removed, the series successor, the newest
bytes as input, the session's budget - run in `finish-rebuild.ts`
(`rebuildFinishedTour`), shared with the desktop editor; since E0b also
the photo-spot rule (`captureSpotsForRebuild`, this file passes its
progress line) and the bookkeeping after a write (`pendingAfterRebuild`). This file keeps
the page: readiness, the settle, the capture-spot bake, progress, the
re-checks of `ctx.session`, what the written zip changes on the page, and
the hand-off. The rules are described here as the Finish's behaviour; the
module's sidecar states them as its contract.

## Public API

- `wireCreatorFinish({ ctx, arStore, arController, wizard, codes, dom, measuring, settle, handoff, previews, draft, sessionLive, render }): CreatorFinish`
  - `dom` (`CreatorFinishDom`): `finishButton` (whose click this module
    handles), `keepScanRow`, `keepScanInput`, `finishStatus`,
    `downloadButton`, `finishBlock`.
  - A Finish that wrote the zip saves it by itself once its block is on
    the page (`handoff.save(notes)`; the 2026-10-08 field test, F4; owner
    decision D-F4a), with its result sentences as the notes that stay on
    the line under the save's status, and brings that line into view. The
    status reads `savingTour` until the save settles.
  - With an AR session running (a new one began during the rebuild, or
    ending the session failed) the zip is offered on the button instead
    (`handoff.offer`): no download inside AR (F4 milestone review #6).
  - A Finish's start calls `handoff.finishStarted()`: a "did you upload
    it?" question left from the previous Finish's file goes, so its yes is
    never read as this Finish's (F19 review #2). The rebuilt zip carries
    its `written` tour.json, which a yes notes.
  - A Finish that fails AFTER making its zip still hands that zip over the
    same way (review #1); an earlier Finish's zip stays saveable from the
    button. The button is disabled while a Finish runs, so a tap cannot
    save the previous zip just before the new one (review #5).
  - The Finish settles a visit still running FIRST
    (`settle.settleVisit("finish")`), and forgets that settle again when
    no zip was written (`settle.unsettle`).
- `CreatorFinish.start()` - start a Finish now if `canStart()`; whether
  one started. The panel's Finish button and the creator's Done in AR
  (polish round M3, Q-Done, through `creator-setup.ts`'s `finishNow`)
  share it. When a finish ends, `deps.renderArEntry` re-renders the AR
  button (it reads "Saving…" / "Close AR" from the finish).
- `deps.beforeStart` (optional) - runs first in `start()`, before the
  readiness is read: the page commits what is still in a field (the tour
  name, whose "change" a tap may not fire; the r880 milestone review
  LOW-3), so a name that is the only change still has its Finish.
- `CreatorFinish.readiness()` / `canStart()` - whether a Finish could run
  (the readout's hint), and whether a tap starts one now: ready, no
  measurement in flight, none running. The ONE rule the button's state and
  the click both read (M2 review #2; M4 changes readiness, and two copies
  could disagree).
- `CreatorFinish.renderKeepScan()` - the keep-the-walk switch: shown on the
  page only, for a tour whose manifest settled and that carries entries a
  visitor never reads (counted once per tour and manifest), never while a
  rebuilt file waits.

## Invariants & assumptions

- **A named deviation from the root rule "App state lives in the Redux
  store"** (the r880 milestone review MEDIUM-1): the phone's save status
  stays in the session object (`TourViewerSession`) beside the slice's
  own (`save.rebuilds`, `save.error`) - `ctx.finishing` (a Finish
  runs), `ctx.finishError` (why the last one failed),
  `ctx.finishProgress` (its progress line) and `ctx.rebuiltZip` (the
  file it made, a Blob - which stays outside the store either way). Two
  places say whether a save runs, so a reader must know which one it
  reads: the undo reads the slice (`canStep`); the object list's lock,
  the readout, the Finish button and the AR button read `ctx`. Follow-up:
  the save moves into a tour-document thunk (the same follow-up as the
  rebuild I/O's TEMPORARY boundary entries, `config/.dependency-cruiser.cjs`),
  which takes the status into the store and leaves only the Blob beside
  it. As the desktop's selection was recorded (`editor/edit-main.ts.md`).

- **The tour's title** (polish round M4a; W2 of the tour editor plan
  2026-10-17-1816) is the tour document's: step 3's "Tour name" field
  renames the tour (`renameTour`, `tour-name-field.ts`; checked as the
  desktop checks it - at most 80 characters, counted as a reader counts
  them - and trimmed), so the Finish writes it with the document's other
  changes (`manifestNow` applies the details); an emptied name removes
  it; a name never typed keeps the title the tour had. A rename alone is
  work (`hasWork`: `tourChanged`). The visitor's start page (V4) leads
  with it.

- **Finish** (`finishReadiness`): needs something to write (`hasWork`,
  code book plan M4d: a code the book would write, a changed or deleted
  object, or in AR a code in hand), an open tour AND
  a settled manifest load (pending or broken refuses, with the reason:
  finishing would overwrite a placement it could not read, M3 review #5);
  runs once at a time (`ctx.finishing`). A **desk edit** (no AR visit, no
  code in hand, §9 D4) finishes too: it writes the objects and no level
  entry, so the hosted level files are kept byte for byte, and the
  finished log's `levelId` is null. While it runs the panel shows
  its progress with priority over the measuring readout, and a failure
  stays on the line until the next tap (`ctx.finishProgress`,
  `ctx.finishError`; store dispatches used to erase both). The
  continuation re-checks `ctx.session` after every await and ends the AR
  session only if it is still the one it started in
  (`ctx.arSessionGeneration`). An existing level for the same id (also in
  the tolerated wrapped shape) is replaced in place, never duplicated.
  The size note next to the button says what the rebuild will copy. Entries: each level the code
  book says changed (`creator-codes.ts` `toWrite()`, captured after the
  settle; since M4c-1 - a code the zip already holds unchanged is not
  written again) at `qrLevelEntryName(id)` and `tour.json` from the page's tour document
  (`ctx.tourDocument`, `creator-document.ts`: what the zip already carried,
  so a re-measure never drops placed content, or an empty manifest), plus each placed photo's bytes under
  `session.manifestWrap` (the session's own prefix, never re-derived).
  The input is the **newest bytes for this tour**: `ctx.rebuiltZip` when a
  previous finish produced one, else `session.readWholeArchive()` (the
  warmed copy, else range slices). The hosted archive is untrusted, so its
  rebuild inflates under the session's own budget (`session.budget`, K0
  milestone review R1) and a deflate bomb fails the Finish with the cap's
  sentence; a previous Finish's zip is this page's own stored output and
  gets the rebuild's default budget. The write is the document's:
  `saveStarted` before the snapshot (an undo waits while it runs),
  `saved` when the zip is built, `saveEnded` in every outcome. On success
  `ctx.rebuiltZip` is set, the document's written tour **advances to what
  was just written** (`saved`),
  `ctx.walkDecidedFor` is set to the open session when the walk is
  settled - its spots written, or no photo to place - so the creator's
  station HUD drops its hedge (PR #642 review); NOT after a declined bake
  (`notPlaced`), which writes nothing, so the next Finish bakes again
  (PR #643 review) - and
  the written work leaves the page's entries (`saved`), the AR session is ended through the
  controller (the framework's session-end path runs the app teardown) and
  the wizard opens step 6, "done" (polish round M2, B9: a completion step
  of its own), and its finish block is revealed - AFTER the `disable()`, so it cannot
  appear over a session that is still compositing; on failure the reason
  stays in the panel and the button re-enables.
  - **Why the chaining and the advance go together** (PR #435 review):
    finishing ends the AR session but does NOT close the tour, so a
    creator can measure again, place more and finish again. Leaving the
    manifest at its pre-finish value silently dropped the first batch;
    advancing it while still rebuilding from the hosted zip would write a
    manifest naming photos the archive does not contain. Both halves are
    needed, and the e2e finishes twice in one open tour to hold them.
- **The rebuilt zip is named after the hosted file** -
  `finishedFileName` (`finish-rebuild.ts`, shared with the desktop editor):
  `session.hostedFileName()`, else `archiveFileName(url)` - because Drive
  offers "Replace" only for the same name (Drive replace plan §2
  decision 3).
- **The Finish replaces and filters** (`applyObjectChanges`), removes
  each deleted photo's content file (`contentEntriesToRemove` into the
  rebuild's `remove`), drops `manifest.sig.json` (a signature over the
  old list cannot cover the files this Finish rewrites: the output is an
  honest unsigned tour until K2 re-signs on export) and, for a LISTED
  tour, writes `manifest.json` again as the series' next version
  (`successorManifest`, K1 milestone review R7: the same series id, the
  next version, the hash of every file the zip holds - the kept ones from
  the list the input carries, the written ones hashed at the Finish; a
  second Finish starts from the list the first one wrote, kept in
  `ctx.rebuiltZip.signedManifest`). Dropping it, as K1 first did, dropped
  the series id's only home. A phone that knew the signed tour still
  warns that this copy is not signed. A NEW level file of a listed tour
  is written inside the tour's folder (`manifestWrap`), where its list
  can name it (a root `qr/` beside a wrapped list would be unlisted).
  Afterwards the document (`saved`) drops from the page's entries only
  what the zip carries WITH THE SAME CONTENT, and clears the applied
  deletions. The draft's tombstones stay until the hosted zip lacks the
  ids, the same proof the objects wait for.
- **The Finish bakes a recording's photo spots** (scan-pass plan S1,
  S-D11): a tour that carries a recording and no `captureSpots` yet is
  replayed once (`capture-bake.ts`, busy line `FINISH_LABELS.placingPhotos`)
  and `tour.json` gains the spots, written at minor 1. Spots the tour
  already carries are kept, not baked again. A recording that cannot be
  read or joined never fails the Finish (the tour keeps the visitor's live
  join, as before); a cap's refusal and a failed integrity check do, as
  every read's does.
- **The published copy leaves the creator's walk out** (scan-pass plan
  S1, S-D10): unless the creator ticks "Keep the walk recording in the tour
  file" (`keepScanRow` / `keepScanInput`, on the page BEFORE AR since UI
  round 1, U2 - hidden in a session, since the Finish there reads it -,
  shown only for a tour that carries a walk, counted once per tour and
  manifest), the Finish removes
  `scanEntryNames` of the manifest it writes (`tour-read-set.ts`): the
  action stream, `session.json` and the recorded frames no visitor sees.
  A file the recording did not write (a README, credits) always stays.
  **Never without baked spots** (S1 milestone review #2): a recording the
  bake declined or could not read keeps its walk, and the ready line says
  why (`FINISH_LABELS.photosNotPlaced`); the walk is then the only way a
  viewer can place the photos - unless the walk places nothing (it names
  no recorded photo the tour carries, `placesNothing`, passed on as
  `walkPlacesNothing`): it is then left out like any walk, with no word
  about photos (the M4b milestone review #3). The tick is cleared with the Finish step
  when the tour closes (review #9).
  The ready line then says so (`FINISH_LABELS.scanLeftOut`), because the
  hosted file may be the creator's only copy of the walk.
- The finish's append is **id-deduplicating**, because the serializer
  rejects duplicates: one already-hosted object would otherwise make every
  finish throw for as long as the draft was restored, with no escape inside
  the app.
- The objects it wrote are reported to the draft (`draft.finished`, M6
  E2p): their versions in this file are this device's own, so a creator
  who uploads it from this tab and edits again is not told the edit was
  replaced by a newer one.

## Tests

Composed, through `wireCreatorSetup`: `creator-finish.test.ts` (what the
rebuilt zip holds, the budget, the listed series, the baked spots, the walk
left out, the save guard's inputs, a finished photo's bytes) and the e2e
finish specs; the entry list itself in `finish-entries.test.ts`. The
sampled mutants of the region "finish"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
