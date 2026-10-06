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

## Crash-safe authoring (second testing session, F13)

Everything measured and placed lives in page memory until Finish, and an AR
session on a phone can be killed by the OS at any moment. So each mint and
each placement is also written to an OPFS draft, keyed by the tour's url
after trimming (`draftKeyForTour`), which is the namespace name
(`authoring-draft.ts` holds the rules, `draft-persistence.ts` the on-disk
shape, and the framework's `opfs-draft-store.ts` the mechanics).

- **NOT the File System Access API.** F13 asked for write access to the
  hosted zip; the pickers do not exist on Chrome for Android, which is the
  only device the creator's AR session runs on. See the plan's §10.1.
- **The write is fire-and-forget.** The placement already happened in
  memory; a storage problem must never fail the tap that made it. A failed
  write says so ONCE, in the panel - a creator mid-walk cannot act on it
  more often than that.
- **Work made before the draft opened is written when it opens**
  (scan-to-open plan §9 #5): with no tour open, or between an open and its
  manifest settling, there is no namespace yet - that is not a storage
  failure and does not spend the one warning. When the store is assigned,
  the in-memory placements the read did not return are written (after the
  read, so no branch deletes them), and a level measured before the open is
  recorded in the meta even when an older draft is being offered.
- **A draft is OFFERED, never applied.** It can be days old and can be one
  the creator believes they discarded; restoring it silently would append
  content they did not ask for into a zip they are about to publish. Three
  answers: add it back, not now (kept), delete it (gone). "Not now" keeps
  it because a mis-tap must not become the loss this exists to prevent;
  "delete it" exists because a draft with no way out is offered forever.
- **Restoring brings the LEVEL and the SIZE back too**, not just the
  objects. The level is what makes Finish reachable without walking to the
  poster again; the size is rewritten from the framework default on every
  load, so without it a re-entry would solve against 16 cm for a poster
  printed at 20. A live measurement wins over a drafted one - it is newer.
- **"Delete it" is committed by ONE meta write, and undone by a second if
  that one fails.** The handler records the rejected ids in the meta file
  and only then removes their object files. If the write does not land, the
  in-memory rejection is restored AND re-written behind any snapshot a mint
  or finish already took - best-effort, since the store that refused may
  refuse again - so a queued write cannot commit a discard the creator was
  told had failed. It removes nothing in that case - and the
  creator is told, in its OWN words and every time, because a discard that
  silently did not happen is met again on the next open with no
  explanation. Deliberately NOT the shared "not saving a backup copy"
  notice: that one fires once per wiring, so an earlier refused write would
  have left this branch mute, and its wording says nothing about the draft
  the creator just tapped Delete on. So an interrupted or failing sweep cannot
  bring the draft back, and a reload before the
  write lands sees the draft exactly as it was - safe in both directions,
  which neither earlier shape was. The ids come from what `readDraft`
  returned, so a placement made while the offer sat on screen is never in
  the list. The rejection is re-stated on every later meta write, and the
  leftovers of a sweep that did not finish are swept on the next open.
- **Meta writes are ORDERED PER NAMESPACE.** They all target one key in one
  directory, and the mint and finish ones are never awaited, so an earlier
  write landing later would overwrite a newer one - a rejection, or a
  measured level replaced by the null it captured. Each write queues behind
  the last for its own NAMESPACE - the trimmed url the directory is named
  from, not the raw one, since two urls differing only in whitespace share a
  directory and must therefore share a chain. That makes both properties
  structural: a tour
  whose write stalls blocks only itself, and the ordering survives any
  interleaving of opens.
- **So are an object's writes, PER ID** (M4 review #7; the M2c review's
  filed #7). A placement's write is unawaited, so a quick delete of it
  could land first and the object come back on the next open. Every write
  and removal for one id - record, bytes, tombstone, a sweep - runs in that
  id's queue (`keyed-chain.ts`, keys per tour namespace and id), so they
  land in call order.
- **A change to an id the meta rejects CLAIMS the id first** (M4 review
  #1, `writeForObject`). The meta's rejected list outranks an object's
  files, so an edit or delete of an object a spent draft or "Delete it" had
  rejected was hidden by the next read and swept by the next open - the
  edit lost, or the deleted object back. In the id's queue, each step
  awaited: remove the rejected files, rewrite the meta without the id,
  then write the change. A crash between steps leaves the rejection or
  nothing for the id, never the rejected version. A sweep (discard, spent,
  an unfinished earlier sweep) removes an id's files only if it is STILL
  rejected when its turn comes, so a claim made meanwhile survives it.
- **Work done before the draft opened is written after the read, ALL of
  it** (M4 review #2): an edit or a deletion keeps its id, so the draft
  may hold an older change of the same id, and writing only ids the draft
  lacked left that older change for a crash to bring back.
- **A draft is deleted only on PROOF**: a re-opened tour whose `tour.json`
  already carries its ids. Not on the download tap - on Android that
  resolves true the moment a download starts, and the creator still has to
  upload the file by hand afterwards.
- **The Finish bakes a recording's photo spots** (scan-pass plan S1,
  S-D11): a tour that carries a recording and no `captureSpots` yet is
  replayed once (`capture-bake.ts`, busy line `FINISH_LABELS.placingPhotos`)
  and `tour.json` gains the spots, written at minor 1. Spots the tour
  already carries are kept, not baked again. A recording that cannot be
  read or joined never fails the Finish (the tour keeps the visitor's live
  join, as before); a cap's refusal and a failed integrity check do, as
  every read's does.
- **The save cannot be forgotten** (UI round 1, U2, `finish-guard.ts`):
  after a Finish the save button is scrolled into view and focused; on a
  phone, Finish steps aside while the rebuilt file waits for its save
  (`hideFinishForResult`); after AR ends without a Finish (the back
  gesture), Finish reads "Finish and save your changes"; a delivered save
  marks `ctx.rebuiltZip.delivered`; `leaveNeedsConfirm()` and `leaveQuestion()` (exported) are what `main.ts` asks before another tour or leaving the page. A failed Finish reveals a file it already made, and the keep-the-walk switch hides while a rebuilt file waits (the next Finish rebuilds from it; U2 milestone review #2, #4).
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

## Public API

- `wireCreatorSetup({ ctx, mode, arStore, arController, seams, wizard, dom, openDraftStore?, codeTour?, summary? }): CreatorSetup`
  - `openDraftStore(key)` resolves this tour's draft namespace, or
    `undefined` where there is no persistence. Injected so the unit tests
    and the e2e can supply one without OPFS.
  - `CreatorSetupDom { panel; controls; finishBlock; replaceHelp; replaceHelpShare; replaceHelpGeneric; replaceHelpDrive; sizeInput; printPanel; status; finishButton; keepScanRow; keepScanInput; finishStatus; downloadButton; pinButton; pinLabel; pinSave; pinCancel; photoButton; draftOffer; draftOfferText; draftRestore; draftDismiss; draftDiscard; sizeOffer; sizeOfferText; sizeOfferUse; sizeOfferKeep; objectList; movePrompt; movePromptText; movePromptUse; movePromptCopy; movePromptLater; moveUndo; moveUndoText; moveUndoButton }`
    - `objectList` (authoring plan 2026-09-28-0953 §3.4, M4) - the
      `object-list.ts` view (`bind`, `render`); `main.ts` builds it over
      `#object-list` inside the panel.
    - `movePrompt*` (M5b; UI round 1, U3) - "Did the poster move here?" and its three answers, inside `#setup-controls` - the one question about the code's position left (the explicit replace and its confirm are gone); `moveUndo*` - the Undo of a "Yes, it moved" while its visit runs.
  - `arSessionLive(status)` - whether the controller's status means a
    session is up (`starting` / `running` / `stopping`). Exported because
    `main.ts` hands the same predicate to the wizard, which must not
    collapse step 4 while it is true.
    - `panel`, `status`, `controls`, `finishButton` live inside `#ar-root` (the DOM overlay); `finishBlock`, `finishStatus`,
      `downloadButton` and `replaceHelp` sit at the end of step 4 but
      OUTSIDE `#ar-root` - the download is tapped after the session ends,
      so putting it over the camera would promise otherwise.
  - `CreatorSetup` members: `renderAuthorReadout`, `startAuthorPipeline`,
    `resetFinishStep` (a tour closed), `presentDraftForTour` (a tour
    opened AND its manifest settled - "spent" is a question about that
    manifest, so it cannot be asked earlier), `beginAuthorVisit`,
    `endAuthorVisit`, and `selectInView` (M4: a tap in AR - an XR select
    the overlay did not cancel - selects the object the `pickObjectInView`
    seam names among the rendered previews for the tap's target ray, or
    the screen centre when it is null; or clears the selection on a miss).
  - `CreatorSetup.renderAuthorReadout()` - the measuring readout
    (`authorStatusLine`) joined with the setup hint once measured
    (`setupHint`); a persistent pipeline error (`ctx.authorErrorText`) has
    priority. No-op in visitor mode.
  - `CreatorSetup.startAuthorPipeline(): boolean` - validates the printed
    size (opening step 2 when it is unusable), creates the author tracking
    controller into `ctx.qrController`; false keeps AR unstarted.
- Both are properties (handed to the hooks object unbound).
- `deps.codeTour` (optional; `ScanOpen`'s `onDetection`, `status`,
  `tourOf`) - step 4's scan-to-open (`scan-open.ts`, owned by
  `archive-open`). Every author detection is fed to it; the live readout
  appends `codeTourLine(status)` and "Tour: <label>" for the open tour; no
  status locks Save (a code of another tour joins the open tour, plan §13);
  the mint records the tour its code named in `ctx.mintedLevelTour`. A draft
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

## The page-side visit log (authoring plan 2026-09-28-0953 §3.3 and §7 #4, M3b)

- The store's walk and alignment are wiped at every AR exit, so the settle
  (`settleVisit`, which already runs while the store holds the visit) also
  copies the visit into `visit-log.ts`'s log: the device fixes and the
  odometry, the fused path through the alignment the visit's objects
  settled through, and each code the visit saw (its measurement in this
  visit, then its latest sighting - the log keeps the LAST) through the
  visit's OWN plain alignment, never the code-corrected one (that would
  repeat the stored pose and fake agreement between visits). A visit with
  no fix and no code is not logged.
- **Every stored code, not only the one in hand** (M3a/M3b review #6):
  `noteSighting` also keeps the latest stable sighting of ANY code with a
  stored pose (the level in hand, or a level of the open tour with a geo)
  in `storedCodeSightings`, tagged with its visit and cleared at the
  visit's end. Only the visit log reads it: such a sighting never makes a
  code the one in hand and never corrects anything.
- **The saved pose is marked** (M3a/M3b review #2): `settleVisit` plans the
  settle (pure) before logging, and hands the level it re-mints - if any -
  to the log as `saved`, so the summary can grade the stored pose by the
  visit it came from.
- The id is `newVisitId(pageId, arSessionGeneration)` with a random page
  id, so it stays unique across reloads; a visit settled again (a failed
  Finish) replaces its entry.
- Each entry is written to the draft as its own file (`writeDraftVisit`,
  in the id's queue like a placement, fire-and-forget, `noteNoPersistence`
  on a refusal); entries made before the draft opened are written when it
  opens. A restored draft brings its visits back into the log; a dismissed
  one does not. A visit's id is a stored id, so a discard sweeps it with
  the objects; this page's own visit ids are never swept (`notLive`).
- **Visits keep a draft alive** (M3a/M3b review #5): the zip never carries
  them, so `draftIsSpent` gets the read's visit count and a draft holding
  one is never spent - it is offered ("N AR visits for the summary map")
  until the author restores or discards it. Before, a draft holding only
  re-scan visits of a hosted code counted as spent and the reload's sweep
  deleted the visit files. The cost: such a draft is offered on every
  reload of the tour until a discard.

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

- **The settle** (authoring plan 2026-09-28-0953 §3.2, M2c; D2, D10b):
  `endAuthorVisit` (called by `ar-entry.ts` FIRST in the session end, before
  the store teardown resets the alignment) and a Finish tapped while the
  session is live run `settleVisit`: `planVisitSettle` (`visit-settle.ts`)
  recomputes the geo of the code measured in this visit and of every object
  placed in it - since D33 each through the first mature alignment after its
  own moment (`visit-alignment-picks.ts`, fed by `syncAlignmentPicks` on
  every store change with the alignment, the zero, the session GPS extent
  and the walked distance (`walked-distance-tracker.ts`, reviews R1 and R3 of
  D33);
  a pin at its Save, a photo at its tap, a move through
  `object-editing.ts`'s `notePlaced`, the measurement when its level identity resolves (its `atMs` is the tap's), each
  stable sighting of the code in hand; emptied at each visit's start and
  end), and a note within `CODE_EVENT_REACH_M` walked of a code event of
  the visit shares the code's alignment through the nearest event; the records
  replace the tap-time ones
  in `ctx.placedObjects` and `ctx.mintedLevel`, each settled object's draft
  record and the meta are REWRITTEN (the per-object file design already
  keys by id; no format change - so a page reload keeps the settled geo,
  while a killed tab keeps the tap-time geo, accepted in the plan), and
  `tourAuthoring/settled` is logged. The input carries the end alignment's
  GPS extent (`alignmentGpsExtentM`), the D31 heading marker of a code
  re-minted through it (review R7 of D33).
  - **Each visit settles once, keyed by the visit the settle ran for**
    (`visitSettles`, M2c review #1): the record holds the basis, the
    alignment used, the store's alignment, the zero and the sighting. A
    Finish tapped during a visit settles it at the tap, so the session end
    the Finish causes finds the record and does not re-mint the code a
    moment later (the draft's level would then differ from the one just
    written, and the draft would be offered again after the upload). A
    Finish that wrote no zip forgets the record while its visit still runs,
    so the session end settles everything of the visit again, including
    what was placed after the failure. A Finish tapped on the page settles
    nothing and records nothing: `arSessionGeneration` is bumped at the
    session END, so between visits it already names the NEXT visit, and
    marking that number is what once kept the next visit from settling.
  - **Late arrivals join their visit's settle** (M2c review #6): the record
    is kept even for a visit with nothing to settle yet. A photo whose
    encode lands after its visit settled (the session ended, or a Finish
    ran) is minted through the record's alignment and zero - the settle's
    choice for an object placed at the visit's end, which a photo landing
    late is (its capture a moment before the end) - and logged as `tourAuthoring/settled` with trigger
    `late-arrival`. Minting it through the store instead would use an
    alignment that belongs to no visit (the teardown resets it).
  - **A Finish removes from the list only what its zip carries** (the ids
    of the manifest it wrote): a photo that landed during the rebuild is in
    neither and waits, settled, for the next Finish.
  - The mint records `ctx.codeMeasurement` (its raw inputs and visit) with
    the level, and clears it whenever the level is cleared (a new tap, an
    adopted print size, a tour close in `archive-open.ts`).
  - A photo's visit is taken at the tap, before its async encode (its
    odometry belongs to that visit); see "Late arrivals" above.
  - **Later visits, corrected through the code (D10b).** Every detection's
    fused evaluation goes through `noteSighting`: a STABLE pose of the code
    whose level is in hand (or of any code while none is measured) becomes
    `ctx.visitCodeSighting`, the latest one of this visit. A text's level id
    is a hash (`qrCodeId`, async), so it is derived once per text
    (`codeIds`) and the sighting waits for it. When the level's pose was
    stored in an EARLIER visit (or came from a draft) and this visit saw the
    code, the visit settles through the corrected alignment
    (`visit-settle.ts`); without a sighting, through its plain alignment.
  - **Earlier visits' objects on re-entry.** `beginAuthorVisit` (called by
    `ar-entry.ts` once the runtime runs) renders every earlier object into
    one frame at the scene root, placed from geo like the viewer's content;
    each sighting re-places that frame (`placeEarlierObjects`): once the
    basis is `code-corrected` it moves under the world group with the
    corrected alignment's inverse as its matrix, which puts each object at
    the odometry spot the code says - rigid in AR, since the corrected
    alignment does not depend on the visit's GPS alignment
    (`visit-anchoring.ts` property test). `endAuthorVisit` removes the frame;
    the previews inside are disposed with `placedPreviews`. Objects already
    written to the zip by a Finish (the manifest's) are not shown - showing
    hosted objects in author mode is M4.
    - **The frame moves only on a sighting or an explicit action, never
      on a fix** (owner's drift complaint, plan §1 / §2.1; §7m #8). The
      panel line needs the refusal current, so each render that finds a
      new fix in the store re-judges the LATEST sighting through the
      CURRENT alignment (`judgeRefusal`) - but that updates the refusal
      (`liveRefusal`: the panel line) only. The objects'
      frame is re-chosen only by `placeEarlierObjects`: a stable sighting
      of the code in hand, and the explicit paths (a measurement of the code, the visit's start). So
      while the code is out of view the objects stay where its last
      sighting put them, however far GPS drifts (M5b had re-placed them
      on every fix, a jump of at least the plausibility bound - 13.5 m at
      a reported 2 m, 26.2 m at 5 m - with no tap). Consequence, accepted:
      after such a drift the preview can show the code's frame while the
      settle at that moment would save through GPS; the panel's refused
      line says so, and the next look at the code makes the two agree.
      Pinned by `authoring-settle.test.ts` "keeps the earlier notes in the
      code's frame on new fixes while the code is out of view" (it fails
      when a fix re-places the frame).
  - **A preview from geo waits for the zero** (M2c review #4): on the
    first visit of a page load (a restored draft) the zero arrives with the
    first GPS fix, after `beginAuthorVisit` ran. `previewObject` records the
    object's id instead of returning silently, and the store subscription
    renders what waited once the zero is there (once each; the set is
    emptied at the visit's end, since the next visit renders everything).
  - **"Seen" is the fused pose's `stable`, no new threshold.** The same gate
    the mint uses (the fused-pose source's own fit, motion and spread
    checks). Considered over the plausible range of "seen": at one end a
    single detection, whose single-frame pose is not gated at all (the fused
    source exists because single frames scatter; its tests use +-6 degrees),
    and every 3 degrees of yaw error moves a corrected note 20 m away by
    about 1 m; at the other end an average over several stable evaluations,
    which costs the author a longer look for an improvement nobody has
    measured. `stable` is the middle and already exists. What would change
    the choice: a field recording in which the stable poses of a re-sighted
    code disagree with its stored pose by more than the 0.3 m / 2 degree
    acceptance (plan §3.2) - then an averaged hold is the next step.
  - **A refused correction is said, in one line** (M2c review #2): each
    sighting re-evaluates the settle choice (`placeEarlierObjects`, with
    this visit's median GPS accuracy), and so does each new fix
    (`judgeRefusal`, the refusal only - see above); when the plausibility bound
    (`visit-settle.ts`) refuses the correction, the live line starts with
    `correctionRefusedLine` ("Code seen 60 m from its saved position - a
    second print or a moved poster? Not used; this visit follows GPS")
    until the visit ends or the sighting is judged acceptable again (a
    sighting, or a fix through which it is), and the visit's
    `tourAuthoring/settled` carries `refusedCorrection`.
  - **The entry hint** (§3.2a, D5): the live status line starts with
    `entryHint` while a tour is open and `ctx.visitCodeSighting` holds no
    sighting of the code in hand (any code while none is measured); it goes
    the moment this visit has one, and never locks a control.

- **A Drive tour's finish SAVES and shows the Drive steps** (Drive replace
  plan §2 decisions 1 and 4): the route is `finishRoute({canShare,
drive})`, per open tour (`isDriveUrl` of the archive link) - never frozen
  at wiring - so a Drive tour takes `seams.downloadZip` even on a phone that
  could share, and its button reads "Save the zip to this phone". Its ready
  line (`FINISH_LABELS.readyDrive`) warns about an older copy in Downloads
  BEFORE the tap, and its status after the save is `savedToPhone`. Once the
  zip is delivered, `replaceHelpDrive` shows `driveReplaceSteps` as numbered
  lines (textContent; the module stays DOM-free) with the zip's name, and
  `replaceHelpGeneric` hides; `resetFinishStep` restores the generic text.
  A hosted name a phone would change is saved as `downloadSafeName` and the
  steps ask for the same rename on Drive.
- **The rebuilt zip is named after the hosted file** -
  `session.hostedFileName()`, else `archiveFileName(url)` - because Drive
  offers "Replace" only for the same name (Drive replace plan §2
  decision 3).
- **Mint:** reads the STABLE pose from the `qrDetected` slice, the
  alignment TARGET matrix and the zero; the level's identity is the async
  `qrCodeId` of the exact printed text, guarded by `ctx.mintGeneration` so
  a stale hash cannot install an older level. Until it lands the finish
  button stays off.
  - **A stored pose stays the reference** (D10b, M2c review #5): the level
    in hand before the tap is captured, and once the id lands
    `measurementRole` (`visit-settle.ts`) decides - with the hosted zip's
    `qr/<id>.json` read through `hostedLevelJson` (`session.loadEntryText`,
    under the text cap, K0 milestone review R10) when nothing of this code
    is in hand (ignored if another tour was opened meanwhile). A kept
    reference stays `mintedLevel` (so Finish writes the hosted file back
    byte for byte), the measurement becomes this visit's sighting, the
    line says "Code seen - its saved position stays, and this visit is
    lined up with it", and `setupHint` says "Saved position kept" rather
    than "replaces". `tourAuthoring/codeMeasured` logs which happened
    (`kept`). A failed identity hash restores the level in hand. A hosted
    level whose file cannot be read, or carries no geo, is not a
    reference: the measurement is, as before.
- **Finish** (`finishReadiness`): needs a measured level, an open tour AND
  a settled manifest load (pending or broken refuses, with the reason:
  finishing would overwrite a placement it could not read, M3 review #5);
  runs once at a time (`ctx.finishing`). While it runs the panel shows
  its progress with priority over the measuring readout, and a failure
  stays on the line until the next tap (`ctx.finishProgress`,
  `ctx.finishError`; store dispatches used to erase both). The
  continuation re-checks `ctx.session` after every await and ends the AR
  session only if it is still the one it started in
  (`ctx.arSessionGeneration`). An existing level for the same id (also in
  the tolerated wrapped shape) is replaced in place, never duplicated.
  The size note next to the button says what the rebuild will copy. Entries: the level at
  `qrLevelEntryName(id)` and `tour.json` from `ctx.tourManifest` (what the
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
- **Hand-off:** `seams.shareOrDownloadZip` - the device share sheet where
  the browser can share FILES, else the framework's picker-or-anchor. The
  button's LABEL comes from `seams.canShareZip()`, read once at wire time,
  because a button reading "Download" on a phone that will open a share
  sheet names the wrong action before it is pressed. Two independent
  facts come back:
  - `delivered` reveals the replace instructions (the last thing to do,
    and only once there is a file to do it with); false - a dismissed
    picker, or a share sheet that handed nothing over - keeps the button
    live. Async-UI rule on both branches.
  - The reveal is ONE-WAY for `replaceHelp` and follows the last DELIVERED
    hand-off for `replaceHelpShare`. A creator who saved, tapped again and
    dismissed the picker keeps the step-6 instructions they earned; one who
    shared and then saved stops being told to go looking in another app.
    And the whole continuation is guarded on `ctx.openGeneration`, because
    a share sheet can stay up across a tour close - the reveal would
    otherwise land on the closed tour's panel and still be on screen when
    the next tour reached its finish (PR #440 review).
  - `route` picks the copy, and this is the half that matters: "the link
    and the printed code stay the same" is TRUE after a save over the
    hosted file and FALSE after a share, which normally creates a new file
    with a new id while the printed code still points at the old one. The
    share route therefore also reveals `#replace-help-share`, one extra
    sentence saying so. The four outcomes are pure functions
    (`finishHandoffStatus`, `finishIdleLabel`, `finishBusyLabel` in
    `qr-author-mode.ts`), tested there, because three of them cannot be
    reached in a headless browser.
    `resetFinishStep` (a hook, called when a tour closes) disables the
    button, clears the status and hides both blocks, so a re-opened tour
    never shows the previous one's dead download button.
- **Placement (M4, DEC-N9):** allowed only under the mint gate's own
  alignment floor for THIS session (a measured code, a matrix and at least
  `MIN_ALIGNMENT_SAMPLES` fixes since the session started - a level that
  survived a session end does not open it, M4 review #2), a running
  session and no rebuild in flight; re-checked at every tap. "Place a pin
  here" reads the hit-test reticle (a surface must be under it, else the
  panel says so), opens the overlay label input (with a Cancel), and Save
  mints a `pin` record from the reticle's GPS-world position
  (`content-placement.ts`; the reticle rides the lerped visual alignment,
  which converges within ~0.3 s of a correction - the one frame difference
  to the photo's target-matrix mint, accepted);
  "Capture a photo here" encodes the latest camera frame's pixels
  (`ctx.latestFrame.image`) through `seams.encodeFrameJpeg` and mints a
  `photo` record from THAT frame's raw capture pose
  (`ctx.latestFrame.cameraPose`) through the session alignment, keeping the
  JPEG for the rebuild. The photo and its placement therefore describe the
  same moment; the pose used to be read at tap time (QR perf plan 2026-09-23
  M4). A frame older than `PHOTO_FRAME_MAX_AGE_MS` (1 s) is refused -
  `photo-frame.ts`, because frames stop during a tracking loss while
  `latestFrame` keeps the last one. Each placement renders its own preview (`renderTourObjects`;
  `ctx.placedPreviews`, one handle per object, so two placements cannot
  race each other's disposal and a photo is decoded once). A preview of an
  object placed in the RUNNING visit is rigid (decision D2, plan §3.2, M2c):
  it goes under the AR world group at its odometry pose, kept in
  `placedObjects[i].placement` (`{ visit, local }`; a pin's reticle through
  `worldToLocal`, a photo's capture pose through `odomNueFromWebXr`), so a
  GPS re-solve moves it together with the camera instead of sliding it
  against the world (symptom A). Anything else - a restored draft object,
  an earlier visit's - has only its geo and is placed from it. The outcome of a placement is `ctx.placementNote`, shown until
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
    tour. `syncPreviews` keeps `ctx.placedPreviews` (a map by id) in line
    with `authoringObjects`: a preview whose object changed look or pose
    (`previewKey`) is replaced, one whose object is gone is disposed, the
    rest are left alone. Each visit starts with a fresh render into its
    frames. A hosted photo's bytes come from the zip
    (`session.loadContentEntry`), decoded under the tour pixel cap
    (`maxPixels`, tour kit K4 review R2); a photo a Finish took out of
    `placedObjects` keeps its bytes in `finishedPhotoBlobs` until the tour
    closes, since the hosted zip lacks them until the upload.
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
  - **Draft**: an edit is a record under the same id; a delete of a
    hosted object is `writeDraftDeletion`; the offer names changes and
    deletions (`restoreOfferText`); a restore replaces by id and brings
    deletions back as tombstones, with live work on the same id winning.
    The spent sweep and the discard skip ids changed live since the read
    (`notLive`): an edit keeps its id, so unlike a new placement its file
    can be in the read's list.
  - **Overlay taps are not scene taps**: `beforexrselect` is cancelled on
    the panel (the PhysicsDemo pattern), so a tap on Delete does not also
    select what stands behind the button. The framework's reticle driver
    carries the `select` listener through its own `onSelect` option, and
    since M4 review #4 hands the tap's target ray as a second argument
    (backward compatible: MinimalExample's one-parameter handler is as it
    was), so the pick goes through the tapped point.
  - **Automatic measuring** (UI round 1, U3; plan review #1; U3 milestone
    review #6, #7): there is no "Save the measured position" button. Each
    render classifies the code in view (`codeOutcome`), and the same answer
    feeds the line (`authorStatusLine`'s `ready`) and the measurement
    (`maybeMeasure`), so the line never claims a measurement that does not
    happen:
    - the code in hand: `measured`;
    - a measurement in flight, or a code still being read: `measuring`;
    - with a code in hand, another STORED code (or one not identified
      yet): `seen` - a sighting for the visit log; taking it in hand would
      change what this visit's objects are corrected through;
    - with a code in hand that is not saved in the tour yet (neither
      hosted nor written by a Finish of this page, `finishedLevelIds`), a
      new code: `finish-first` - each Finish writes the ONE code in hand,
      so measuring past it would silently drop it;
    - with no tour open: `seen`;
    - a code the open tour may not take (`autoMeasureAllowed`):
      `not-measured`, and scan-to-open's "added to the open tour" line is
      left out so the two do not contradict;
    - otherwise it is measured, once per visit and code (`autoMeasured`,
      cleared at the visit's end and when a measured print size is
      adopted), never during a Finish.

    A measurement that lost the gate is tried again; one the mint or the
    identity refused is not, and its reason becomes the panel's note (the
    only note a measurement writes - it clears none, and no failed
    Finish's line). It keeps the level in hand while its identity is
    derived (an emptied hand refused every placement in that window) and
    holds Finish off while it runs (`measuring`). The once-per-visit rule
    replaces the tap's "measure again": the settle refines a code measured
    here through its own pick (D33), not through later sightings.

  - **The code's saved position, decided at the settle** (UI round 1, U3;
    owner decisions 2026-10-06; U3 milestone review #1-#5, #8): no button
    replaces a stored code. At each visit's settle `planCodePosition`
    (`code-position-settle.ts`) judges this visit's latest sighting of the
    stored code in hand with `decideCodePosition` (`code-position-rule.ts`),
    through ONE source that the re-mint then takes: the sighting's own pick
    when its walk is reliable, else the end alignment (a pick freezes at
    40 m of GPS spread, which phones at more than about 8 m accuracy never
    find enough).
    - It replaces a weaker or unknown saved position after a walk the
      summary's model calls enough at this accuracy (at least 10 m), and
      keeps a well-walked one.
    - It leaves a code seen beyond the code correction's plausibility bound
      or 15 m (or turned beyond its yaw bound) to the move question.
    - It applies a remembered "Yes, it moved" only while this visit still
      sees the code 15 m or more away, under the same walk rule.
    - A change hands `planVisitSettle` a measurement of the code (the
      sighting's pose, the print size the visit solved at, the chosen
      pick), so it is re-minted as if measured here and this visit's
      objects settle relative to it.
    - An IMPROVED position moves the tour's other objects within 40 m of
      the code's old position with it (`moveEarlierWithCode`,
      `move-with-code.ts`: yaw and position only, as the code correction;
      hosted, restored and earlier visits' objects, as edits by id; a pin
      keeps its orientation). A real MOVE leaves them (D19) and marks the
      visit's move boundary.
    - A settle redone after a failed Finish re-applies the decision it
      already made (`appliedCode`): the objects are not moved twice and the
      visit log keeps the saved pose.
    - Every "Yes, it moved" of the code is forgotten at the settle, applied
      or not: a waiting one is asked again next time, never applied in a
      later visit out of Undo's reach.
    - The decision is logged on `tourAuthoring/settled` as `codePosition`
      (also for a visit that settled nothing else), and the result screen's
      line after Finish is `codePositionSentence` over the settles since
      the last Finish.
  - **The moved-code prompt** (authoring plan §3.6 "Authoring (D20 ask
    once)", M5b; `code-move-prompt.ts` decides WHEN): on every readout
    render the tracker is fed the latest sighting's offset through the
    current GPS alignment (`sightedCodeOffset`; its own 15 m trigger since
    D26, whether or not the settle refuses the correction, so between 15 m
    and the refusal bound the visit follows the code while the prompt
    asks; the refusal itself is still re-judged whenever a fix landed,
    `judgeRefusal`, for the panel line, never moving the earlier objects), the
    mint gate's alignment half, the store's fix count and the latest
    fix's time, and the remembered answers. It asks only for a stored
    level in hand, in a live session, outside a Finish. A new ask logs
    `tourAuthoring/codeMovePrompted` once per run beyond the trigger.
    - Every answer ("Yes, it moved", "No, it's a second poster", "Not now") is remembered per level and spot
      (`rememberMoveAnswer`), in memory and in the draft's meta
      (`moveAnswers`, re-stated by every `recordMeta`, read at tour open
      whether or not the draft is restored and merged with answers given
      before it opened); a refused meta write is the backup notice.
      A sighting of the code in hand at a spot answered "It's a second
      copy" (`isSecondCopySpot`, through the visit's plain alignment, as
      the prompt saw it) is kept out of the visit log (`logVisit`): it is
      another print, so it must not count as a visit of the stored code
      in `codeVisitPoses` (M5b review #11). "Not now" leaves it a visit.
    - "Yes, it moved" changes nothing at once: the status line says the
      new spot is saved when the visit ends if the creator walked enough,
      and the settle applies it (above). Logged as
      `tourAuthoring/codeMoveAnswered` `moved` (`replaced` false).
    - **The move boundary**: a move the settle APPLIED records its visit as
      the code's move boundary (`movedInVisit`, set before the visit is
      logged); an improved position of the same poster is no boundary.
    - **Undo until the visit settles**: a "Yes, it moved" can be taken back
      until its visit settles (a session end or a Finish - also one that
      fails afterwards); Undo re-answers the spot "Not now" (logged as
      such), so the prompt does not ask again at once. Nothing else needs
      restoring: nothing changed before the settle.
  - The readout's "N objects placed" counts only objects the zip does not
    carry; an edit of a hosted object is not a placement.
- Owns the session fields `lastDetectedText`, `activeSizeM`,
  `authorErrorText`, `mintedLevel`, `mintGeneration`, `finishing`,
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

- **The creator pipeline's fused evaluations are counted** per code into
  `ctx.fusedTallies` for the `?debug=1` readout (plan §66), from the
  source's `onEvaluated`.

- **The print-size check** (QR size consensus plan S3a, `print-size-check.ts`):
  every detection feeds it (through the `estimateQrPrintSize` seam, so the
  e2e can show an offer); its offer renders in its own element, first in the panel,
  (`dom.sizeOffer`, with "Use" / "Keep"), because `status` is rewritten on
  every dispatch. **Adopting** writes the measured size into the size field,
  invalidates a position saved this session (`mintGeneration` bump,
  `mintedLevel` null, draft meta re-written), ends the QR pipeline, clears the
  code's detections (`clearQrMarker` - solved at the old size) and starts the
  author pipeline again at the new size; a note says so until the code is
  stable again. While the check has no answer, the ready line asks for a
  sideways step (the mint is not held).

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
moved-code prompt (M5b): `authoring-settle.test.ts` "the moved-code
prompt" (asked only after the rule's fixes and seconds, logged once; not
with the gate closed; "Yes, it moved" changing nothing at once, logged and remembered, applied by the settle after enough walking with no pin moved and the move boundary marked, held without the walk and said on the result screen; Undo while the visit runs, re-answering "Not now", gone once the visit settled; the answers remembered in the draft across a reload, and a refused write surfaced as the backup notice; a sighting answered "It's a second copy" kept out of the visit log while a "Not now" one stays in it), plus the pure `code-move-prompt*`
tests and the e2e `move-prompt.spec.js` (one per answer).
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
