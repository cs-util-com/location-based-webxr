# creator-setup.ts

## Purpose

The creator's AR setup (guided-setup plan M3; `author-mode.ts` until
2026-09-08): the panel inside `#ar-root` that guides the creator through
measuring the hung code (the mint gate: a stable pose AND a GPS alignment
with at least `MIN_ALIGNMENT_SAMPLES` fixes since this session started; measured on its own since UI round 1 U3, see "Automatic measuring" below), keeps the measured level in the session, and on Finish rebuilds the hosted
zip in the browser (DEC-N6) with `qr/<id>.json` and `tour.json` (the file
list from `finish-entries.ts`; the one-code slot is being replaced by
`code-book.ts`, code book refactor plan M1-M5), ends the
AR session and reveals the download at the END of step 4, where it is its
own tap (a download needs its own user gesture).

That download was step 5, and the "put it back where the old one is" copy
was step 6, until the flow rework (second testing session, F10): neither
is a setup step, they are what happens when step 4 finishes. This module
reveals `finishBlock` after a successful rebuild and `replaceHelp` once
the zip is actually saved, and `resetFinishStep` hides both again when the
tour they belong to closes.

The panel is a creator's for the whole page, but its CONTROLS are the AR
session's: on a desktop they were a row of greyed-out buttons under an "AR
not supported" button (F11). The status line is deliberately NOT gated -
it is where an entry REFUSED before any session starts (an empty printed
size) explains itself, and a gated one would leave a Start button that
does nothing and no explanation anywhere. With no session live the live
measuring readout is blank instead: "hold the phone on the printed code"
is an instruction for a situation a desktop creator is not in.

**Since the code book refactor plan's M2 split this file is the composition
root.** Each concern is its own `creator-*.ts` module with its own sidecar:
`creator-draft.ts` (the on-device draft), `creator-previews.ts` (the AR
previews), `creator-alignment-picks.ts` (the per-moment alignments),
`creator-placement.ts` (pins and photos), `creator-codes.ts` (the one
owner of the codes, M4a), `creator-measuring.ts` (the QR
pipeline, the size offer, automatic measuring), `creator-settle.ts` (the
visit settle, the visit log, the summary), `creator-finish.ts` (the rebuilt
zip) and `creator-handoff.ts` (its download, share or Drive save). What
stays here: the wiring, the readout that joins them, the save guard's
input, and the hooks, which fan out to each module's `endVisit` / `reset`.

## Crash-safe authoring and the Finish's file

The on-device draft (second testing session, F13) is `creator-draft.ts`
since the code book plan's M2 split; its sidecar holds the rules that
were here. What stays is the Finish's side:

- **The Finish's file** (what it writes, the baked photo spots, the walk
  left out, the listed series continued): `creator-finish.ts`.
- **The save cannot be forgotten** (UI round 1, U2, `finish-guard.ts`):
  after a Finish the save button is scrolled into view and focused; on a
  phone, Finish steps aside while the rebuilt file waits for its save
  (`hideFinishForResult`); after AR ends without a Finish (the back
  gesture), Finish reads "Finish and save your changes"; a delivered save
  marks `ctx.rebuiltZip.delivered`; `leaveNeedsConfirm()` and `leaveQuestion()` (exported) are what `main.ts` asks before another tour or leaving the page. A failed Finish reveals a file it already made, and the keep-the-walk switch hides while a rebuilt file waits (the next Finish rebuilds from it; U2 milestone review #2, #4).

## Public API

- `wireCreatorSetup({ ctx, mode, arStore, arController, seams, wizard, dom, openDraftStore?, codeTour?, summary? }): CreatorSetup`
  - `openDraftStore(key)` resolves this tour's draft namespace, or
    `undefined` where there is no persistence. Injected so the unit tests
    and the e2e can supply one without OPFS.
  - `CreatorSetupDom { panel; controls; finishBlock; replaceHelp; replaceHelpGeneric; replaceHelpDrive; sizeInput; printPanel; status; finishButton; keepScanRow; keepScanInput; finishStatus; downloadButton; pinButton; pinLabel; pinSave; pinCancel; photoButton; draftOffer; draftOfferText; draftRestore; draftDismiss; draftDiscard; sizeOffer; sizeOfferText; sizeOfferUse; sizeOfferKeep; objectList; }`
    - `objectList` (authoring plan 2026-09-28-0953 §3.4, M4) - the
      `object-list.ts` view (`bind`, `render`); `main.ts` builds it over
      `#object-list` inside the panel.
  - `arSessionLive(status)` - whether the controller's status means a
    session is up (`starting` / `running` / `stopping`). Exported because
    `main.ts` hands the same predicate to the wizard, which must not
    collapse step 4 while it is true.
    - `panel`, `status`, `controls`, `finishButton` live inside `#ar-root` (the DOM overlay); `finishBlock`, `finishStatus`,
      `downloadButton` and `replaceHelp` sit at the end of step 4 but
      OUTSIDE `#ar-root` - the download is tapped after the session ends,
      so putting it over the camera would promise otherwise.
  - `CreatorSetup` members: `codes` (the one owner of the codes,
    `creator-codes.ts`; the composed tests read and write the code in hand
    through it), `renderAuthorReadout`, `startAuthorPipeline`,
    `resetFinishStep` (a tour closed: the code module's `reset` runs first,
    so nothing reset after it reads the closing tour's codes), `presentDraftForTour` (a tour
    opened AND its manifest settled - "spent" is a question about that
    manifest, so it cannot be asked earlier), `beginAuthorVisit`,
    `endAuthorVisit`, and `selectInView` (M4: a tap in AR - an XR select
    the overlay did not cancel - selects the object the `pickObjectInView`
    seam names among the rendered previews for the tap's target ray, or
    the screen centre when it is null; or clears the selection on a miss),
    and `measuredCodeIds()` (code book plan M4d: every code the book holds,
    for the print panel's reprint warning).
  - `CreatorSetup.renderAuthorReadout()` - the measuring readout
    (`authorStatusLine`) joined with the setup hint once measured
    (`setupHint`); a persistent pipeline error (`ctx.authorErrorText`) has
    priority. No-op in visitor mode.
  - `CreatorSetup.startAuthorPipeline(): boolean` - validates the printed
    size (opening step 2 when it is unusable), creates the author tracking
    controller into `ctx.qrController`; false keeps AR unstarted.
- Every `CreatorSetup` member is a property (handed to the hooks object
  unbound).
- `deps.codeTour` (optional; `ScanOpen`'s `onDetection`, `status`,
  `relation`) - step 4's scan-to-open (`scan-open.ts`, owned by
  `archive-open`). Every author detection is fed to it; the live readout
  appends `codeTourLine(status)` and "Tour: <label>" for the open tour; no
  status locks Save (a code of another tour joins the open tour, plan §13).
  A draft
  offered while a session runs also puts a note inside the overlay, where
  the offer itself cannot be seen. Without it, a no-op that
  is always quiet.

- `deps.summary` (optional; `summary-panel.ts`'s `show`/`hide`, authoring
  plan 2026-09-28-0953 §3.3, M3b) - the summary after Finish. Each
  successful Finish shows `buildSummaryModel` over the page-side visit log,
  the codes' stored poses (the level in hand, then the tour's other levels)
  and the objects the written manifest carries; a model that cannot be built
  hides the summary rather than failing the Finish. A new AR visit hides it
  (it is stale), and a closed tour hides it and empties the log.

## Invariants & assumptions

- **The troubleshooting recording's log** (authoring recording plan
  2026-09-28-0953, M1a; `tour-authoring-actions.ts`): a placed pin or photo
  dispatches `tourAuthoring/objectPlaced` (the record, the reticle in the
  world group's local frame for a pin via `worldToLocal`, the frame's capture
  pose for a photo, the store's alignment, the group's rendered matrix for a
  pin, the code last in view as its last fused evaluation stood - read with
  `last`, never `evaluate`, which would feed the motion detector - and the
  code's printed size, `ctx.activeSizeM`); a mint
  whose identity hash landed dispatches `tourAuthoring/codeMeasured` (inputs
  captured at the tap); a finish whose rebuild succeeded dispatches
  `tourAuthoring/finished` with the manifest written, before the session is
  ended; each settle dispatches `tourAuthoring/settled` (below). All are top-level dispatches (a handler, a promise continuation),
  never inside another dispatch. They change no state; without a recording
  the store writes nothing.

- **The settle, the refused correction's line, the page-side visit log
  and the summary after Finish:** `creator-settle.ts` (its sidecar holds
  the rules that were here). What the Finish and the readout do with it:
  - **A Finish removes from the list only what its zip carries** (the ids
    of the manifest it wrote): a photo that landed during the rebuild is in
    neither and waits, settled, for the next Finish.
  - **The entry hint** (§3.2a, D5): the live status line starts with
    `entryHint` while a tour is open and `creator-codes.ts` holds no
    sighting of the code in hand (any code while none is measured); it goes
    the moment this visit has one, and never locks a control.

- **Mint, automatic measuring, the print-size check:** `creator-measuring.ts`
  (its sidecar holds the rules that were here).
- **Finish:** `creator-finish.ts` (its sidecar holds the rules that were
  here); `finishReadiness` gates the button from the readout.
- **Hand-off and the Drive steps:** `creator-handoff.ts` (split out in
  the code book plan's M2; its sidecar holds what was here).
- **Placement (M4, DEC-N9):** the gate, the pin and the photo are
  `creator-placement.ts` (its sidecar holds the rules that were here).
  The outcome of a placement is `ctx.placementNote`, shown until
  the next tap AHEAD of the live readout, never instead of it: it gates no
  control (it used to replace the readout and lock Save, which on a device
  without OPFS - the backup notice fires at tour open - left Save locked
  for good; scan-to-open plan §5 #13). Placed objects survive a session end like
  the level; the finish step appends them to the manifest (at the wrapped
  path when the zip is wrapped) and writes the photos as
  `content/<id>.jpg`, then clears them - a re-opened tour or a re-measure
  must not append them again (M4 review #1). The entry assembly runs
  inside the finish's try, so a manifest the reader rejects fails the
  finish visibly instead of freezing the panel.
- The measured level survives a session end on purpose (finishing ends
  the session); a new measurement replaces it.
- **The AR status line is clamped to two lines** (2026-10-01,
  `data-clamped`, `statusExpanded`), the whole of it a tap away; the page
  is unclamped and each visit starts clamped. The live readout joins up to
  five sentences ABOVE the controls, and on a 360x640 phone with the
  code's re-measure offered and an object selected it pushed the last
  control below the first screen (`ar-layout.spec.js`). The smallest
  change: CSS clamps, the text is unchanged (screen readers and every
  check read the whole), and nothing has to decide which sentence the
  author can do without - the line already leads with what to act on.
  Test: `authoring-settle.test.ts` "the status line in AR is clamped".
- **Editing placed objects (authoring plan 2026-09-28-0953 §3.4, M4)**,
  through `object-editing.ts`:
  - **The hosted zip's objects are rendered in author mode**, keyed by id,
    through the same path as the earlier visits' objects: from geo in the
    earlier-visits frame, which moves under the world group once the code
    is seen (D10b). Before M4 they were invisible to an author reopening a
    tour. How the previews are kept in line, and where a photo's bytes
    come from: `creator-previews.ts`.
  - **Draft**: an edit is a record under the same id; a delete of a
    hosted object is `writeDraftDeletion`; the offer names changes and
    deletions (`restoreOfferText`); a restore replaces by id and brings
    deletions back as tombstones, with live work on the same id winning.
    The spent sweep and the discard skip ids changed live since the read
    (`notLive`, `creator-draft.ts`): an edit keeps its id, so unlike a new placement its file
    can be in the read's list.
  - **Overlay taps are not scene taps**: `beforexrselect` is cancelled on
    the panel (the PhysicsDemo pattern), so a tap on Delete does not also
    select what stands behind the button. The framework's reticle driver
    carries the `select` listener through its own `onSelect` option, and
    since M4 review #4 hands the tap's target ray as a second argument
    (backward compatible: MinimalExample's one-parameter handler is as it
    was), so the pick goes through the tapped point.
  - **No move question** since code book plan M6: the settle decides by
    itself whether a poster moved (`creator-settle.ts`, "The automatic
    code spots"); a sighting at a second print is kept out of the visit
    log, and a move or its undo is the code's move boundary.
  - The readout's "N objects placed" counts only objects the zip does not
    carry; an edit of a hosted object is not a placement.
- Owns the session fields `lastDetectedText`, `activeSizeM`,
  `authorErrorText`, `mintGeneration`, `finishing`,
  `rebuiltZip`, `placedObjects`, `placedPreviews`, `placementNote`; reads
  `gpsSamplesAtSessionStart`, `reticle`, `latestFrame` (written by
  `ar-entry.ts`), `session`, `currentLevels`, `tourManifest`.

## Examples

```ts
const setup = wireCreatorSetup({
  ctx,
  mode,
  arStore,
  arController,
  seams,
  wizard,
  dom,
});
hooks.renderAuthorReadout = setup.renderAuthorReadout;
hooks.startAuthorPipeline = setup.startAuthorPipeline;
```

## Tests

The summary after Finish (M3b): `authoring-settle.test.ts` ("the summary
after Finish") walks two visits through the composed setup - each settle
writes its own visit file, the second visit's code through its PLAIN
alignment although its settle was code-corrected, both survive a new read,
and the Finish hands the summary both visits, the code and the pin; a
restored draft brings its visit back after a reload; a closed tour drops
the summary and the visits. `playwright-tests/summary.spec.js` drives the
real page.

`playwright-tests/ar-mode.spec.js` - "the creator measures the code,
finishes, and downloads a rebuilt zip that carries the level and
tour.json" drives the composed flow under the fakes (the real controller,
slice, alignment solve, mint, rebuild; the download captured by the fake)
and reads the produced zip back in node, including a placed pin and a
captured photo (their records and the photo's bytes), the refused pin
without a surface, the dismissed-picker branch and the identity-hole
re-entry. `fused-pose-wiring.test.ts` pins that the readout and the mint
use the fused pose, evaluated after every detection and re-read (a cache
hit) by the readout and the mint - so a tracking restart since the last
detection withdraws the pose instead of minting the old frame's (plan
§60-§61; milestone review of b4b #1). The
pure pieces are unit-tested in
`qr-author-mode.test.ts` (`authorStatusLine`, `setupHint`,
`finishReadiness`) and `tour-session.test.ts` (`archiveFileName`,
`readWholeArchive`, `loadTourManifest`). The recording's log:
`creator-setup.test.ts` (a pin's `objectPlaced`, its odometry position and
matrices, the code's size, and the reticle with the world group yawed 90
degrees) and `creator-finish.test.ts` (the finish's manifest). Anchoring (M2c):
`authoring-settle.test.ts` (rigid previews, the settle through the real
setup, its log and draft rewrite; each visit settling once - a page-side
Finish does not stop the next visit, a failed Finish leaves the visit to
settle at its end - and late photos joining their visit's settle, including
one landing during a live Finish; a restored object shown once the zero
arrives), `creator-finish.test.ts` (the settle at
Finish, once). Editing (M4): `authoring-settle.test.ts` (hosted objects
rendered and listed, edit, delete, move through the code correction, the
async states, tap-select, the overlay guard). The code's position at the settle (U3): `authoring-settle.test.ts` "the code's saved position, decided at the settle" (a replace after a reliable walk taking the pin next to the code along and leaving the one 60 m away, a hosted pin moved as an edit by id, R1's standing re-measure kept, a well-walked position kept, the result screen's line) plus the pure `code-position-rule`, `code-position-settle` and `move-with-code` tests. The
automatic code spots (M6): `authoring-settle.test.ts` "the automatic
code spots at the settle", the pure `code-spots`, `code-spot-settle` and
`level-spots` tests, and the e2e `code-auto-move.spec.js`.
`creator-finish.test.ts` (an edit replaces in place; a deletion filters
the object and takes a deleted photo's jpg out of the archive),
`creator-setup.test.ts` (a draft's edit and deletion offered and
restored, a spent deletion swept, a live edit's file not swept; "the
order of the draft's writes": an edit or deletion of a rejected id kept
across a crash after a spent sweep and after "Delete it", one made in the
same moment as "Delete it" surviving its sweep, a rejected file the sweep
could not remove not coming back after a claim, a rejection after the
change still holding, a change made while the draft opened written over
an older one, and a quick delete landing after a slow placement write),
`keyed-chain.test.ts`, and
`playwright-tests/object-editing.spec.js`.
