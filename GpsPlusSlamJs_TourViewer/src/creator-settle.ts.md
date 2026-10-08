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

- `wireCreatorSettle({ ctx, arStore, seams, previews, alignmentPicks, draft, movePrompt, codes, visitLog, pageId, summary?, alignmentInfo, sizeOf }): CreatorSettle` - `sizeOf(text)`: the size a
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
    (a Finish that wrote nothing, so the session end settles it again).
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
    when the tour has several (M5c).
  - `showSummary()` - the summary after Finish.
  - `endVisit()` / `reset()` - a visit ended (its refusal goes); a tour
    closed (its move boundaries and decisions go).

## Invariants & assumptions

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
  in `ctx.placedObjects` and `ctx.mintedLevel`, each settled object's draft
  record and the meta are REWRITTEN (the per-object file design already
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
    - It leaves a code seen beyond the code correction's plausibility bound
      or 15 m (or turned beyond its yaw bound) to the move question.
    - It applies a remembered "Yes, it moved" only while this visit still
      sees the code 15 m or more away, under the same walk rule.
    - A change hands `planVisitSettle` a measurement of the code (the
      sighting's pose, the print size the visit solved at, the chosen
      pick), so it is re-minted as if measured here and this visit's
      objects settle relative to it.
    - An IMPROVED position moves the tour's other objects within 40 m of
      the code's old position, and no nearer to another of the tour's
      codes (M4b, `takesAlong`), with it (`moveEarlierWithCode`,
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
    - **Per code (M5c).** Each decision folds into its own code's entry
      of the code list (`visitCodeList`'s `otherRemints`), is re-applied
      by a settle redone after a failed Finish (`appliedCodes`, by
      level), and clears its own code's "moved" answers. An improved
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
the earlier visits' frame, the visit log), `creator-finish.test.ts` (a
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
