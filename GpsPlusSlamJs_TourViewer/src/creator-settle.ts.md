# creator-settle.ts

## Purpose

The creator's AR visit settle: at a visit's end, or at a Finish tapped in
it, the code's saved position is decided and every object placed in the
visit gets its geo; plus the refused correction's line, the earlier
objects' frame choice, the page-side visit log and the summary after
Finish. Split out of `creator-setup.ts` unchanged in the code book
refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M4 settles every code of the book, not only the one in hand.

## Public API

- `wireCreatorSettle({ ctx, arStore, seams, previews, alignmentPicks, draft, codes, visitLog, pageId, summary?, alignmentInfo, sizeOf, offerUndo?, withdrawUndo? }): CreatorSettle` - `sizeOf(text)`: the size a
  code is solved at (`creator-measuring.ts`); a replaced or moved stored
  code is re-minted at its sighting's size, not the field's (M4 milestone
  review #2)
- `CreatorSettle`:
  - `settleVisit(trigger)` - settle the running visit (`"visit-end"` from
    `endAuthorVisit`, `"finish"` from a Finish tapped in a session). READS
    THE STORE, so it runs before the session's teardown.
  - `record(visit)` - what a settled visit settled through (a late photo
    is minted through it); `lateArrival(visit, photo)` logs such a photo
    as that settle's; `unsettle(visit)` forgets the running visit's settle
    (a Finish that wrote nothing, so the session end settles it again)
    and withdraws that settle's offer (`withdrawUndo`).
  - `refusalLead()`, `judgeRefusal()`, `judgeOnNewFix()`,
    `placeEarlierObjects()` - the refused correction's line (naming its
    code by `codes.numbering()` when the tour has several), its re-judge,
    the per-fix re-judge called on every render (moving nothing; since M5b
    the settle's, no longer the move prompt's), and the earlier visits'
    frames. Since M5b all of them read `liveCodeChoices` (`visit-settle.ts`)
    over the visit's codes - the same list the settle uses
    (`visitCodeList`): each code's choice through the CURRENT alignment,
    the line for the code seen last, one frame per code whose correction
    was accepted.
  - `positionSentence()` / `afterFinish()` - the result screen's line
    about the codes' positions, over the settles since the last Finish:
    one sentence per code, named by `codes.numbering()` ("Code 2: ...")
    when the tour has several (M5c). The outcome of the code the visit was
    corrected through carries the turn between the visit's own alignment
    and the corrected one (`turnDeg`), so its line can say the two
    disagree (F3, D-F3).
  - `showSummary()` - the summary after Finish.
  - `endVisit()` / `reset()` - a visit ended (its refusal goes); a tour
    closed (its move boundaries and decisions go).
  - `settleUndone(visit)` - the AR strip's Undo took `visit`'s settle
    back (`creator-undo.ts`): that settle's per-code
    outcomes (the result line), move boundaries and applied decisions go,
    so the Finish's result does not report a change the creator took back.
  - `finishesWritten()` - how many Finishes wrote the tour since it
    opened (`afterFinish` counts them, `reset` clears): a settle's undo
    compares it with the count at its offer to say that the next Finish
    saves the undo.
- `offerUndo(target, visit)` (optional dep) - told right after a settle's
  step when it changed a stored code automatically: each code of the step
  (`nextStep(...).codes`) is named by the decision that changed it (an
  applied `replace` an improvement, `move` a move, else null - also a
  decision re-applied after a failed Finish) and `settleUndoTarget` names
  the step; no automatic change, no offer. A code-spot undo (the move
  back) is written by `saveLevel` before the settle's step, outside the
  history, so it is never offered.
- `withdrawUndo(visit)` (optional dep) - told when `unsettle` forgets
  `visit`'s settle: its offer goes (the re-settle re-applies it).

## Invariants & assumptions

- **A code set aside by a size adoption is a code of the visit for its
  objects** (`visitCodeList`; the 2026-10-08 field test, F2; owner decision
  D-F2): its sightings marked `otherSize` still place the objects placed or
  moved through it, at its saved text (else the open tour's). The code is
  decided from none of them: it is not among `visitCodes` until it is seen
  again, at the new size.
- **The settle** (authoring plan 2026-09-28-0953 §3.2, M2c; D2, D10b):
  `endAuthorVisit` (called by `ar-entry.ts` FIRST in the session end, before
  the store teardown resets the alignment) and a Finish tapped while the
  session is live run `settleVisit`: `planVisitSettle` (`visit-settle.ts`)
  recomputes the geo of the code measured in this visit and of every object
  placed in it - since D33 each through the first mature alignment after its
  own moment (`visit-alignment-picks.ts`, fed by `creator-alignment-picks.ts` on
  every store change with the alignment, the zero, the session GPS extent
  and the walked distance (`walked-distance-tracker.ts`, reviews R1 and R3 of
  D33);
  a pin at its Save, a photo at its tap, a move through
  `object-editing.ts`'s `notePlaced`, the measurement when its level identity resolves (its `atMs` is the tap's), each
  stable sighting of the code in hand; emptied at each visit's start and
  end), and a note within `CODE_EVENT_REACH_M` walked of a code event of
  the visit shares the code's alignment through the nearest event; the records
  replace the tap-time ones
  in the tour document (`move`, the AR placement kept) and the code
  module's book, each settled object's draft
  record and the draft's codes record are REWRITTEN (the settle writes
  no meta: the codes have a record of their own since plan M3b) (the per-object file design already
  keys by id; no format change - so a page reload keeps the settled geo,
  while a killed tab keeps the tap-time geo, accepted in the plan), and
  `tourAuthoring/settled` is logged. The input carries the end alignment's
  GPS extent (`alignmentGpsExtentM`), the D31 heading marker of a code
  re-minted through it (review R7 of D33).
  - **Each visit settles once, keyed by the visit the settle ran for**
    (`visitSettles`, M2c review #1): the record holds the basis, the
    alignment used, the store's alignment, the zero and the sighting. Since
    M5a the record is `visitEndChoice` over the visit's codes - the code
    seen LAST, its level as `referenceLevel`, its sighting - not the code
    in hand's `settleAlignment`; it exists whenever the alignment and the
    zero read, exactly as before. A
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
  - The mint records its measurement (its raw inputs and visit) with the
    level in the code module (`codes.setInHand`), which clears it whenever
    the level is cleared (a new tap, an adopted print size, a tour close
    through `resetFinishStep`).
  - A photo's visit is taken at the tap, before its async encode (its
    odometry belongs to that visit); see "Late arrivals" above.
  - **Later visits, corrected through the code (D10b).** Every detection's
    fused evaluation goes through `noteSighting`: a STABLE pose of the code
    whose level is in hand (or of any code while none is measured) becomes
    the visit's sighting (`codes.setSighting`), the latest one of this visit. A text's level id
    is a hash (`qrCodeId`, async), so it is derived once per text
    (`codeIds`) and the sighting waits for it. When the level's pose was
    stored in an EARLIER visit (or came from a draft) and this visit saw the
    code, the visit settles through the corrected alignment
    (`visit-settle.ts`); without a sighting, through its plain alignment.
  - **Earlier visits' objects on re-entry.** `beginAuthorVisit` (called by
    `ar-entry.ts` once the runtime runs) renders every earlier object into
    one frame at the scene root, placed from geo like the viewer's content;
    each sighting re-places that frame (`placeEarlierObjects`, the frame
    itself in `creator-previews.ts`): once the
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
      frames are re-chosen only by `placeEarlierObjects`: a stable sighting
      of the code in hand, a size adoption (M5b: the code's sightings were
      voided), and the explicit paths (a measurement of the code, the visit's start). So
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
  - **A preview from geo waits for the zero** (M2c review #4):
    `creator-previews.ts`.
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
  - **The code's saved position, decided at the settle** (UI round 1, U3;
    owner decisions 2026-10-06; U3 milestone review #1-#5, #8): no button
    replaces a stored code. At each visit's settle `planCodePosition`
    (`code-position-settle.ts`) judges this visit's latest sighting of the
    stored code in hand - since M5c of EVERY stored code the visit sighted,
    each through its own latest sighting and pick - with `decideCodePosition` (`code-position-rule.ts`),
    through ONE source that the re-mint then takes: the sighting's own pick
    when its walk is reliable, else the end alignment (a pick freezes at
    40 m of GPS spread, which phones at more than about 8 m accuracy never
    find enough).
    - It replaces a weaker or unknown saved position after a walk the
      summary's model calls enough at this accuracy (at least 10 m), and
      keeps a well-walked one.
    - It never silently replaces a code seen beyond the code correction's
      plausibility bound or `REPLACE_CAP_M` (15 m), or turned beyond its
      yaw bound: that is the automatic code-spot rule's (below).
    - It applies the automatic code-spot rule's move (`automaticMove`)
      after a reliable walk.
    - A change hands `planVisitSettle` a measurement of the code (the
      sighting's pose, the print size the visit solved at, the chosen
      pick), so it is re-minted as if measured here and this visit's
      objects settle relative to it.
    - An IMPROVED position moves the tour's other objects with it - by
      their stations, below (`moveEarlierWithCode`; hosted, restored and
      earlier visits' objects, as edits by id). A real MOVE leaves them
      and marks the visit's move boundary.
    - **Version 3: whole stations** (tour editor plan D17). The rule picks
      STATIONS by their anchor (`station-code-move.ts`), and each moves
      rigidly as the tour document's `stationMoved` (`moveStation`), the
      desktop's own action. Its items keep their local poses and move with
      the frame, edited ones included. This visit's own objects in a moved
      station are put back where the visit's settle put them (`move`). An
      object in a station that does not move stays, whatever its own
      distance: every object stands in a station (the tour document's
      station rule), so none is judged on its own any more. Claims are per
      object id and per `station:<id>`; the stations this visit started
      are claimed from the start (below).
    - **A station this visit started settles with it.** Its anchor is the
      AR placement of the item it was started for
      (`stationPlacements()` of `creator-document.ts`), and the settle
      hands it to `planVisitSettle` (`stations`), which settles it
      through that item's own choice. The settle moves each such station
      to its settled anchor FIRST (`moveStation`: its items rigidly with
      it), then puts each of the visit's objects at its own settled spot,
      so no item is shifted twice and the station stays anchored at its
      first item, whatever the correction (a 10 m shift and a 10 degree
      turn are pinned). The code move leaves such a station alone: it was
      settled through the improved code already. An item of such a station
      that this visit did not place (earlier work moved into it, a
      restored draft) is put back where it stood before the settle, as the
      code move's `stay` does: the visit's correction says nothing about
      it. Put back by a move, so it stays in the station while the
      item stays within the moved station's found radius (25 m by
      default); further off, the move re-seats it by the station rule.
    - **One settle is one step** (plan M3b, Q-D): every station and
      object move of the settle, the code move's included, is collected in
      the document's `settleBatch()` (each reading the document as the
      moves before it left it), and reaches the document with the codes
      the settle re-minted as ONE `settleApplied` at the end
      (`codes.applySettle`): one undo takes the whole settle back, the
      codes' improved texts included, and the draft follows it in one
      write round. That round is still several writes (each moved
      object's record, the settings record, the codes record), so a
      crash inside it can leave part of the settle on disk; what the step
      removed is the write round per station and object. The
      automatic code spots' undo and confirmation stay saved before the
      settle reads the codes (`saveLevel`), outside that step.
    - **The draft keeps the station's move** (tour editor plan §19 #1):
      the document's listener writes the moved poses into the draft's
      settings record (`creator-draft.ts`), and a restore moves the frame
      before its items' records land in it - the items keep their local
      poses across a crash.
    - A settle redone after a failed Finish re-applies the decision it
      already made (`appliedCode`): the objects are not moved twice and the
      visit log keeps the saved pose.
    - **Per code (M5c).** Each decision folds into its own code's entry
      of the code list (`visitCodeList`'s `otherRemints`), is re-applied
      by a settle redone after a failed Finish (`appliedCodes`, by
      level). An improved
      code takes along the objects that belong to it: every code's pose
      is snapshotted BEFORE the settle re-mints any (`poseBefore`), and an
      object goes with one code at most (`claimed`) - two improved codes
      used to move one object twice (M5 design review #7). Drawing
      during a visit (nearest SIGHTED code, any distance) and moving with
      an improved code (nearest of ALL the tour's codes, 40 m) are
      different rules on purpose: see the plan's M5c design notes.
    - The decisions are logged on `tourAuthoring/settled` as
      `codePositions` (every one) and `codePosition` (the first, for older
      readers), also for a visit that settled nothing else; the result
      screen's line after Finish is `positionSentence` over the settles
      since the last Finish.

## The page-side visit log (authoring plan 2026-09-28-0953 §3.3 and §7 #4, M3b)

- The store's walk and alignment are wiped at every AR exit, so the settle
  (`settleVisit`, which already runs while the store holds the visit) also
  copies the visit into `visit-log.ts`'s log: the device fixes and the
  odometry, the fused path through the alignment the visit's objects
  settled through, and each code the visit saw (every code's measurement
  in this visit - all of them since M4e, not only the code in hand's -
  then its latest sighting; the log keeps the LAST) through the
  visit's OWN plain alignment, never the code-corrected one (that would
  repeat the stored pose and fake agreement between visits). A visit with
  no fix and no code is not logged.
- **Every stored code, not only the one in hand** (M3a/M3b review #6):
  `noteSighting` also keeps the latest stable sighting of ANY code with a
  stored pose (the level in hand, or a level of the open tour with a geo)
  in `creator-codes.ts`, tagged with its visit and cleared at the
  visit's end. Only the visit log reads it: such a sighting never makes a
  code the one in hand and never corrects anything.
- **The saved pose is marked** (M3a/M3b review #2): `settleVisit` plans the
  settle (pure) before logging, and hands every level it re-mints (one
  per code measured in the visit, M4e) to the log as `saved`, so the
  summary can grade each stored pose by the visit it came from.
- The id is `newVisitId(pageId, arSessionGeneration)` with a random page
  id, so it stays unique across reloads; a visit settled again (a failed
  Finish) replaces its entry.
- Each entry is written to the draft as its own file, and a draft holding
  visits is never spent: `creator-draft.ts` (its sidecar, "Visits in the
  draft").

## Tests

Composed, through `wireCreatorSetup`: `authoring-settle.test.ts` (the
settle, each object's pick, the code's saved position, the refusal line,
the earlier visits' frame, the visit log; a station the visit started
staying anchored at its first item after a 10 m and a 10 degree
correction with no item moved twice, an earlier visit's station left
alone, and the code move leaving this visit's station where the settle
put it; an undo of the settle's station move putting the station back,
and, as a known divergence marked `it.fails` until the codes-in-store
plan's M3b, the same undo leaving the improved code in place),
`creator-finish.test.ts` (a
Finish's settle and the summary) and the e2e authoring specs; the decisions
themselves in `visit-settle.test.ts`, `code-position-settle.test.ts` and
`visit-settle.golden.test.ts` (the one-code oracle). The sampled mutants
of the regions "settle", "refusal" and "visit log"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.

## The automatic code spots (code book plan M6 v5.1)

`settleVisit` runs `settleCodeSpots` FIRST, before it reads any code's
level, because an undo rewrites the level everything below reads. For every
STORED code the visit sighted, `judgeCodeAtSpots` takes the visit's inputs:

- its kept sightings;
- THIS visit's device fixes only, sliced at
  `ctx.gpsSamplesAtSessionStart`, because the store's lists span every
  visit and an earlier visit's odometry has another origin;
- the U3 rule's own candidate (`planCodePosition`) and its reliability;
- whether the odometry frame changed since the visit started
  (`ctx.frameEpochAtSessionStart`);
- whether `previous` is a day old (`MOVE_CONFIRM_AFTER_MS`).

It hands these to `judgeCodeSpots` (`code-spot-settle.ts`). The decision
is applied as follows:

- **undo:** the level is restored with `writeCodeSpots` before anything
  reads it. It is the visit log's boundary (`movedInVisit`), U3 does not
  run, and the result screen says so (the `undo` outcome).
- **confirm:** the memory is written (the spot the move left becomes a
  copy), and U3 runs as usual.
- **move:** handed to the keep-or-replace path as the creator's "Yes, it
  moved" was (`spots.moves`). That path re-mints the code, and the settle
  then writes the memory into the re-minted level (`previous` = the old
  spot). No objects are taken along.
- **copy, or a sighting at a known spot other than the current one:**
  - the sighting corrects nothing in this settle: it is filtered out of the
    settle's picks and of the visit log (`spots.excluded`);
  - U3 does not run for the code.

Each decision is logged on `tourAuthoring/settled` as `codeSpots`. A
visit whose only change is an undo is logged too.

**A settle redone after a failed Finish** re-applies the decision it made
(`spotDecisions`), never judging again against the level it already
changed (M6 v5 review #4). A re-applied move does not write its memory a
second time.

**Tests** (`authoring-settle.test.ts`, "the automatic code spots at the
settle"):

- a move at 30 m;
- nothing at 12 m;
- an undo restoring the exact pose and quality;
- a second print changing nothing;
- a frame change judging nothing;
- only this visit's fixes fitted;
- no correction through a second print 22 m away (inside the bound).

Seven hand mutations of the wiring were each caught.

**The live view** (`secondPrintSightings`, M6 v5 review #3): no fit exists
yet while the visit runs. A sighting is placed at the nearest known spot
within the floor by where the current alignment sees it. A sighting at a
second print, or at the spot an automatic move left, is dropped from the
live choices, so earlier objects are drawn plainly there instead of through
the saved pose.

**Take-along** judges each object also against the known spots of every
code this visit saw (M5c review #4, M6 v3 review #12). These are their
second prints and the spots automatic moves left, this code's own
included. A pin next to a second print stays when the code's saved spot is
improved. Codes the visit did not see contribute only their current pose:
a known limitation.

**After the M6 milestone review:**

- **An undo excludes every sighting at a known spot other than the one it
  restores**, a copy included (review #1). This is defensive: one code
  corrects through its latest sighting today.
- **A silent improvement never lands within the floor of another known
  spot** (`withinSpots`, review #2). Such a replace is kept as `far`, so
  two known spots never sit closer than the floor.
- **A far code the visit could not judge** (too short a walk, no gated
  fit, or a frame change) is logged as `keep` / `far-unjudged` with its
  offset. The result line asks for a longer walk with the code in view
  (review #3).
- **A sighting without a fit, live and at the settle,** belongs to
  another known spot only within half the floor of it (`spotByAlignment`,
  review #6). After a frame change the fit classifies nothing (review #5).

## A visit a stored code's votes still line up

A stored code seen in a visit casts votes: synthetic GPS fixes saying the
phone is where the stored code says. They are re-cast with every device
fix while the code is held (a 120 s hold and a 120 s fade), and only the
moved-code check withdraws them. When any vote is still in the GPS history
at the settle, the store's alignment and every pick are held by the code:
seen through them, the code sits where it is stored by construction. Read
as a measurement, that once replaced a code with its own stored spot,
stamped it with the walk's quality and logged a perfect agreement, so a
stored error of 10-15 m became permanent.

`settleVisit` therefore builds a device view (`deviceViewOf`) for such a
visit: the visit's device fixes and their rigid fit
(`code-device-fit.ts`, `codeDeviceFit`), gated on at least 3 device fixes
(after fixes far worse than the median are left out), a walk reliable for
their accuracy by the GPS spread and by the phone's own tracking, and no
tracking restart. The view's quality - what a code is judged and stamped
with through it - is the shorter of the two walks, with the median
accuracy.

- **With a fit:** every stored code is judged by the keep-or-replace rule
  and the code-spot rule through the fit (`planCodePosition`'s
  `deviceFit`), read at the pose `codeFitPose` picks from the code's
  sightings (`codeFitSightings`: those solved at a replaced print size
  left out) - between its first and last look, at the share of the way its
  fixes carry on average (the loop closure: it removes the AR drift the end
  look carries) - else at the creator's own sighting. A change is
  re-minted through the fit and stamped with the fit's quality, so the geo
  and its stamp come from the same fit. A turn alone (the rule's turned
  branch) replaces a code stamped by a better walk than the fit's only
  through a fit at least as good (`code-position-settle.ts`). A code the
  fit sees closer to its saved spot than 0.75 times the fit's accuracy is
  kept (`keep` / `stored-good`, no re-mint, no new stamp): that offset is
  mostly the fit's own GPS error. It is still logged through the fit.
- **The visit's own objects, stations and late photos** settle through the
  fit too (`throughDevice`: every object's pick, and the end alignment,
  are the fit), so they move with the codes corrected through it. Objects
  near a look at a code are still placed relative to that code (the code
  event rule), at its new spot when it was corrected. A visit whose code
  stayed (well stamped, or too far for a silent replace) also places
  objects far from every look through the fit - the rule every visit has
  for them, its own GPS.
- **New codes** measured in the visit are minted through the fit and
  stamped with its quality.
- **Without a fit:** each stored code is kept as stored
  (`keep` / `code-placed`, with `walkMoreM` when a short walk was the
  cause, for the result line), nothing is re-minted or stamped, and the
  code-spot rule gets no candidate (it judges nothing, as for a walk too
  short to judge). Objects keep the vote-held frame - nothing better
  exists - and a new code minted through it claims no quality (its stamp
  has no accuracy and no walk, so later visits may improve it).
- **The visit log** reads every code through the fit, at the fit's pose,
  and draws the path through the fit, or logs no code at all (the fixes
  and the odometry are still logged); never through the vote-held
  alignment.
- **A visit without votes** - one that never voted, or one whose votes the
  moved-code check withdrew (a code moved 20 m or more) - has no device
  view and settles exactly as before.
- **Height** is kept from the vote-held alignment: the fit is horizontal.

Tests: `creator-code-votes.test.ts` - a mixed visit (votes, then a walk
with GPS, then the code seen again) correcting a code stored 10 or 14 m
off; no stamp, no logged code and the walk hint when the walk cannot
judge; the same for a short walk whose fixes jump; an indoor-only visit
inventing nothing; the loop closure at 3 % drift, also with fixes on the
way back and at the end look; the visit's pins near a look and far from
both settling with the corrected code; the path through the fit; a new
code through the fit, and with no claim of quality without one; a stamped
code kept; an unstamped code stored 0 or 3 m off kept within the fit's
error; a vetoed code at 25 m moving as before; no automatic
measurement while the code is out of view; and the sweep (walk 24/38/60 m,
accuracy 5/8/15 m, stored error 0-25 m, drift 0-3 %): a property that the
visit's own view of a code does not depend on where it is stored, with the
full table behind `CREATOR_INDOOR_SWEEP_OUT`.
