# creator-finish.ts

## Purpose

The creator's Finish: the open tour rebuilt in the browser (DEC-N6) with
the measured level, the manifest and the photos, a listed tour's series
continued, the walk left out unless kept, and what the written zip changes
on the page; plus the keep-the-walk switch. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M4 makes it write every code of the book, not only the one in hand.

## Public API

- `wireCreatorFinish({ ctx, arStore, arController, wizard, codes, dom, measuring, settle, handoff, previews, movePrompt, draft, sessionLive, render }): CreatorFinish`
  - `dom` (`CreatorFinishDom`): `finishButton` (whose click this module
    handles), `keepScanRow`, `keepScanInput`, `finishStatus`,
    `downloadButton`, `finishBlock`.
  - The Finish settles a visit still running FIRST
    (`settle.settleVisit("finish")`), and forgets that settle again when
    no zip was written (`settle.unsettle`).
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
  written again) at `qrLevelEntryName(id)` and `tour.json` from `ctx.tourManifest` (what the
  zip already carried, so a re-measure never drops placed content) or an
  empty manifest, plus each placed photo's bytes under
  `session.manifestWrap` (the session's own prefix, never re-derived).
  The input is the **newest bytes for this tour**: `ctx.rebuiltZip` when a
  previous finish produced one, else `session.readWholeArchive()` (the
  warmed copy, else range slices). The hosted archive is untrusted, so its
  rebuild inflates under the session's own budget (`session.budget`, K0
  milestone review R1) and a deflate bomb fails the Finish with the cap's
  sentence; a previous Finish's zip is this page's own stored output and
  gets the rebuild's default budget. On success `ctx.rebuiltZip` is set,
  `ctx.tourManifest` **advances to what was just written** and
  `ctx.placedObjects` is cleared, the AR session is ended through the
  controller (the framework's session-end path runs the app teardown) and
  step 4's finish block is revealed - AFTER the `disable()`, so it cannot
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
  Afterwards it drops from `placedObjects` only
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
  viewer can place the photos. The tick is cleared with the Finish step
  when the tour closes (review #9).
  The ready line then says so (`FINISH_LABELS.scanLeftOut`), because the
  hosted file may be the creator's only copy of the walk.
- The finish's append is **id-deduplicating**, because the serializer
  rejects duplicates: one already-hosted object would otherwise make every
  finish throw for as long as the draft was restored, with no escape inside
  the app.

## Tests

Composed, through `wireCreatorSetup`: `creator-finish.test.ts` (what the
rebuilt zip holds, the budget, the listed series, the baked spots, the walk
left out, the save guard's inputs, a finished photo's bytes) and the e2e
finish specs; the entry list itself in `finish-entries.test.ts`. The
sampled mutants of the region "finish"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
