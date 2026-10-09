# visit-settle.ts

## Purpose

The authoring settle (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.2, milestone M2c; owner decisions D2, D10b and D33): at the end of an AR
visit, and at Finish for the visit still running, the geo of the code
measured in that visit and of every object placed in it is recomputed from
its odometry pose, so that a note and the code it sits by share one
alignment and keep the relation the phone's tracking saw (symptom B's half
"B2", plan §2.2). Without picks that is one alignment for the whole visit;
with them, each object's own (D33) and, near a code event, the code's
(R1 and R3 below).

**Each object at its own moment (owner decision D33, 2026-10-03).** With the
visit's picks (`visit-alignment-picks.ts`; `input.picks`) every object, the
measured code and each sighting of a stored code is composed through the
FIRST MATURE alignment at or after its own moment (40 m of session GPS
extent, the framework's `state/alignment-maturity`), else the visit's
alignment at its end. The plausibility bound of a D10b correction is judged
through the sighting's own alignment, not the drifted end one. Measured (`visit-settle.left-behind.test.ts`): a note left
500 m behind at 1 % / 1 degree per 100 m settled 8.4 m off through the end
alignment and about 1.2 m through the first mature one, flat in the
distance walked after; a start note of an out-and-back that saw the stored
code again at the end went 11 m off through the latest sighting; and long
meanders at 2 degrees per 100 m had correct codes refused through the end
alignment. **Near a code event, the code's alignment (reviews R1 and R3 of D33,
2026-10-04).** Each object at its own moment broke B2 again for notes
placed after the session matured: a code measured in this visit and a note
placed a minute later went through different alignments. So a note within
`CODE_EVENT_REACH_M` (40 m) WALKED of a code event of its visit is placed
relative to the code through the nearest event by walked distance:

- the visit MEASURED the code: the measurement's own pick (the code's
  alignment), or a later stable sighting's pick corrected onto the code as
  re-minted (the D10b correction within the visit, its bound included); a
  tie goes to the measurement; basis `measured-here` either way;
- a STORED code: the nearest sighting's D10b correction (`code-corrected`).
  Farther from every event a note keeps its own pick (`measured-here` /
  `visit-alignment`). Walked distance, not time (R3): drift grows with the
  distance walked, so after a stand-still the nearest sighting in time can be
  a walk away. The walked distance is the odometry path length over the
  device fixes (`walked-distance-tracker.ts`), stamped on each event by
  `visit-alignment-picks.ts`. Picks without one (an older caller) keep the
  rules before: their own pick, and the sighting nearest in time, uncapped.
  Without picks (`picks` absent: the live views, `planMove`)
  everything goes through `alignment` and the input's `sighting`, exactly as
  before. Nothing visible changes while authoring: the previews stay rigid as
  placed, and only the stored geo is settled.

Pure. `creator-setup.ts` reads the store (before the session teardown),
applies the result to `ctx.placedObjects` and the code module, rewrites the
draft and logs `tourAuthoring/settled`.

## Public API

- `interface CodeMeasurement` - a mint made in this page: `levelId`, `text`,
  `odomPose` (the stable fused pose, raw WebXR), `sizeM`, `visit`.
- `interface CodeSighting` - the anchor code as the running visit last saw it
  stable: `text`, `levelId`, `odomPose` (raw WebXR, this visit's odometry).
- `type SettleBasis` - `"measured-here" | "code-corrected" | "visit-alignment"`.
- `CODE_EVENT_REACH_M = 40` - the walked distance (m) within which a note
  shares the code's alignment through a code event (R1, R3); its sweep is
  under Invariants.
- `interface TimedAlignment` (`atMs`, `alignment` or null, `walkedM?`,
  `alignmentInfo?`, `gpsExtentM?`),
  `TimedSighting` (+ `sighting`; module-internal, the element type of
  `sightings`), `VisitAlignmentPicks` (`objects` by id,
  `measurement`, `sightings` oldest first) - the D33 picks, as
  `visit-alignment-picks.ts` hands them over. An unreadable `alignment`
  counts as none (the end alignment is used).
- `interface SettleChoice` - `{ basis, alignment, refused }`: what one
  object settles through, and why.
- `settleAlignment(input): SettleChoice | null` - which alignment a visit
  settles through (with `picks`: an object placed at the visit's end, i.e.
  the latest kept sighting judged through its own alignment):
  - `measured-here` - the visit measured the level in hand (its
    `CodeMeasurement` has this visit and this level id): the visit's own
    alignment at its end;
  - `code-corrected` - the level's pose was stored EARLIER (another visit,
    or a restored draft - no measurement in this page) and this visit saw
    that code (`sighting.levelId === mintedLevel.id`): the visit's alignment
    corrected through the code (`correctedAlignment`, `visit-anchoring.ts`);
  - `visit-alignment` - everything else, including a stored level whose geo
    does not read, a sighting of a DIFFERENT code, a correction that cannot
    be computed, or one the plausibility bound refuses (`refused` then
    says how far and how turned, and the bounds).
  - the input's optional `gpsAccuracyM` is this visit's median GPS
    accuracy, for the bound.
  - null - the alignment is not 16 finite numbers, or there is no zero.
- `measurementRole(input)` - what a NEW measurement of a code is (D10b, M2c
  review #5), from the level id, the visit it was taken in, the level in
  hand with its measurement, and the hosted zip's level file:
  - `{ kept: "level-in-hand", reference }` - the level in hand is this
    code's, reads a pose, and was NOT measured in this visit (an earlier
    visit of this page, a restored draft, or a hosted level a previous
    measurement kept): it stays the reference;
  - `{ kept: "hosted-level", reference }` - nothing of this code in hand, but
    the open tour's zip stores it with a readable pose;
  - `{ kept: "measurement" }` - nothing stored reads (no file, no geo, not
    JSON), a DIFFERENT code is in hand, or the level in hand was measured in
    THIS visit (same odometry; the visit's settle re-mints it anyway).
    With a reference kept, the caller keeps it as `mintedLevel`, takes the
    measurement as this visit's sighting, and the visit settles
    `code-corrected`. Whether this visit's view REPLACES a stored pose is decided at the settle (UI round 1, U3: `code-position-settle.ts`, which hands `planVisitSettle` a measurement of the code when it changes) - never a side effect of measuring.
- `planMove(input & { object, local })` (M4) - an object moved to `local`
  (the reticle, odometry-NUE) in the running visit: its geo recomputed
  through `settleAlignment`'s choice - the D10b code correction when this
  visit saw a stored code - so a pin moved in a later visit lands where
  the code says. Returns `{ object, basis, alignment, refused }`, or null
  without an alignment or a zero. The record keeps its id, text and
  creation time.
- `sightedCodeOffset(input)` (M4 review #3) - how far, and turned by how
  much, the code as this visit sees it lies from its stored pose, with NO
  plausibility bound: what an explicit replace moves the code by for every
  visitor, so what its confirm states. Null without a readable alignment,
  a zero, a sighting of the level in hand or a stored pose. Shares its
  computation with the settle's correction (`sightedStoredCode`), so the
  two can never disagree about the number. Also `northM`/`eastM`: where
  this visit sees the code minus its stored position.
- `storedGeo(json)` - a level's stored geo, or null (the object list's
  distance to the code); `storedSizeM(json)` - a level's printed size, or
  null when it is not a positive number (the size a code is solved at,
  `creator-measuring.ts`).
- `visitEndChoice(input): VisitEndChoice | null` (code book plan M5a) - the
  visit's END choice through the code seen LAST (the latest event of any
  code of the visit), with that code's `level` and `sighting`: what a late
  photo, the visit log's path and the settled log's basis go through. With
  one code it equals `settleAlignment` (the golden seeds hold it). Unlike
  `planVisitSettle` it exists for a visit that placed and measured nothing
  (M5 design review #1); null only when the alignment or the zero do not
  read. `planVisitSettle`'s `basis` / `alignment` / `refused` are the same
  choice.
- `liveCodeChoices(input): LiveCodeChoices` (code book plan M5b) - while
  the visit runs: each code's choice through the CURRENT alignment (no
  pick: the live frame follows the alignment as it stands), keyed by
  level, and the code seen last (`last`, read from the picks' events).
  The earlier objects are drawn through the nearest corrected code; the
  refused line is judged for `last`. With one code its entry equals
  `settleAlignment` over the input.
- `planVisitSettle(input): VisitSettle | null` - the settled records by
  index into `placed` (only objects whose `placement.visit` is this visit),
  each with its own `SettleChoice` (D33: its pick by id; near a code event
  the code's alignment through the nearest event, R1 and R3; no pick: the
  end alignment and the latest sighting); the
  visit-level `basis`/`alignment`/`refused` of an object placed at the
  visit's end (what a photo landing after the settle goes through); and
  `level` re-minted through the measurement's pick (else the end alignment;
  `levelAlignment` says which) when the basis is `measured-here` (through `mintQrLevelFromWorld`, the code's
  pose converted with the same `odomNueFromWebXr`). Null when the visit
  placed and measured nothing, or when `settleAlignment` is null.
- **Several codes (code book refactor plan M4b): `codes` and `levels`.**
  `input.codes` (`VisitCode[]`: a level, this page's measurement or null,
  the measurement's pick) lists the visit's codes. Each object settles
  through the code event nearest it in WALKED distance of ANY code (D2, the
  owner's choice after the M3 sweep; a tie goes to the later event), then
  through that code's own one-code rules unchanged: a measured code's
  measurement or sighting (R1), a stored code's sighting (D10b, its bound
  included), within `CODE_EVENT_REACH_M`. With one code, no moment or an
  unknown walked distance, the first code (the code in hand) decides, as
  before. The visit-level choice (a photo landing after the settle) goes
  through the code whose latest event is the latest. `levels` holds every
  code measured in the visit re-minted through its own pick; `level` /
  `levelAlignment` stay the first one's. Without `codes` the legacy fields
  are the one code and the result is identical (the one-code oracle).

## Invariants & assumptions

- **One alignment per visit WITHOUT picks.** Every object of the visit and
  the code measured in it go through the same matrix, so their relative
  geometry is exactly the odometry's (unit test: the offset between pin and
  code after the settle equals the odometry offset turned by the end
  alignment, within 1 mm; before it the tap-time records disagree by more
  than 0.1 m). **With picks (D33)** each goes through its own first mature
  alignment instead: after the session matured, objects placed close in
  time share nearly the same alignment, and an object left behind no longer
  carries the drift walked after it.
  - **Known difference (accepted 2026-10-04):** `creator-setup.ts`'s
    `logVisit` still composes the visit's walk for the summary through the
    end choice's alignment (`pathAlignment`), while each pin now settles
    through its own pick, so the summary's path and its pins can differ
    slightly (about the drift between a pin's pick and the visit's end).
    Filed in the authoring plan's D33 follow-ups.
- **The code event reach is 40 m walked** (`CODE_EVENT_REACH_M`; reviews R1
  and R3 of D33). Measured in `visit-settle.left-behind.test.ts`
  (`VISIT_SETTLE_RELATION_SWEEP`, `VISIT_SETTLE_SIGHTING_SWEEP`; 30 visits
  per cell, drift 0.5-2 % and 0.5-2 degrees per 100 m, GPS 5 m; scored on
  the note-minus-code relation, the 0.3 m field target of plan §6a item 2,
  and on the absolute error; ranges over the nine drifts, p50 / p90):
  - a code measured once the session is mature and a note placed after a
    stand-still of 60-120 s or a 10-30 m walk: each object's own pick
    1.0-1.7 / 2.1-2.8 m relation (0.3-0.9 / 0.8-1.7 after 10-30 m walks);
    through the code's pick 0.1-0.7 / 0.2-0.8 m;
  - a later sighting next to the note (a 120 m or 300 m walk ending at the
    code): 0.2-0.3 / 0.5-0.6 m, where the code's pick is 0.6-8.2 / 0.9-10.3;
  - a stored code after a 3-5 minute stand-still and a 120 m walk past it:
    the sighting nearest in time 0.6-2.5 / 1.0-3.4 m, nearest walked
    0.1-0.3 / 0.4-0.6 m;
  - the reach swept {10, 20, 40, 80, 120, 240, 480} m: 20 m loses the 30 m
    walks back to the code (0.9-1.0 / 1.7-2.0 m relation for a stored code
    against 0.2-0.6 / 0.5-0.9); 80 m wins a 60 m walk back to the code
    (stored: 0.3-1.2 / 0.6-1.5 against 1.1-1.2 / 2.0-2.3) but loses a note
    placed 60 m away from it (relation p90 4.4-5.2 against 2.2-2.4, absolute
    4.1-4.4 / 8.4-8.7 against 1.3-1.5 / 2.2-2.4 with a stored error); 120 m
    and more lose both at 120 m. 40 m is the largest swept value at which
    no cell's p50 relation is worse than its own pick's. Its cost: a note
    placed 30 m AWAY from the code (one way) is worse in p90 relation
    (2.4-2.9 against 2.0-2.2 m) and, with a stored error, in absolute error
    (3.0-3.1 against 1.1-1.3 m p50).
  - **What would reverse it:** the reach trades drift and the code's
    heading error times the note's distance from the code (the one-way
    cells) against the alignment wander between moments (the out-and-back
    cells). Lower drift, or a code heading better than the 2 degrees of look
    noise, moves the best value up; field notes placed mostly far from their
    code move it down. A spatial term (the note's distance from the code)
    would separate the two families and is the candidate refinement; it is
    not built.
  - **Absolute error near the code is the code's**: within the reach a note
    inherits the code's own error (1.0-1.4 / 1.7-2.9 m measured mid-visit;
    with a stored code, the stored error), which is the D10b trade: the
    relation to the code is kept, not each note's independent GPS fix.
- **Only what has odometry is touched.** Objects of other visits and
  restored draft objects (no `placement`) are never in the result; their geo
  stands.
- **A pin keeps no facing** (the identity rotation, as `mintPin` writes it);
  a photo's rotation turns with the alignment.
- **The stored code is the reference in a corrected visit**: it is NOT
  re-minted (`level: null`), because the correction maps this visit onto it.
- **A re-minted level keeps the id** and takes its geo, its quality block
  and its D31 heading marker from ONE alignment (review R7 of D33): the
  measurement pick's when the pick carries its mint info
  (`picks.measurement.alignmentInfo`, `gpsExtentM`), else all three from
  the end alignment (`alignment`, `alignmentInfo`,
  `alignmentGpsExtentM`) - never the pick's geo with the end's block. The
  marker is the framework's `qrMintHeadingMarker` (the Recorder mint's
  rule, DEC-H3): `alignmentGpsExtentM` and `headingUncertain` (under 10 m)
  when the extent is known, nothing when it is not. It matters since D33: a
  visit that never matures re-mints through an alignment that may span under
  10 m, and the moved-code rule (`moved-code-rule.ts`) never settles a
  level marked uncertain. And the settle's time as `mintedAtIso`. A refused re-mint (fewer than `MIN_ALIGNMENT_SAMPLES` fixes)
  keeps the old level.
  - **It keeps the code's automatic-move memory** (`qr.spots`, code book
    plan M6 v5.1). The mint builds a fresh level, so `remintedLevel`
    carries the memory over with `carryCodeSpots` (`level-spots.ts`). This
    is the one seam every re-mint of a stored code goes through.
  - **Why the block describes the SETTLE, not the tap.** `mintQuality` is
    the record the field validation (QR-pose plan M5) attributes a code's
    position error with: "this geo came from an alignment of N fixes at a
    median accuracy of A m, at time T". After the settle the stored `geo`
    comes from the visit's end alignment, so the block must describe that
    alignment; keeping the tap-time block would pair the settled geo with
    numbers that did not produce it. No field is added or renamed: the
    block keeps meaning "the mint that produced this geo", and the settle
    is such a mint (`mintQrLevelFromWorld`).
  - The tap-time values are not lost for troubleshooting: the recording's
    `tourAuthoring/codeMeasured` logs the tap's alignment info and level,
    and `tourAuthoring/settled` the visit alignment and the one used.
  - **Every mint-time field comes from the settle, none from the tap**:
    `mintedAtIso` (the settle's time), `alignmentSampleCount` and
    `gpsAccuracyM` (those of the alignment the geo comes from). The unit test compares the whole
    block, so a field that stayed tap-time would fail it. The one extra
    `quality` field set here is the D31 marker, re-derived from the
    settle's alignment; any other added to the tap's mint would have to be
    re-derived here too, or the settle would silently drop it.
  - Geo and block always travel together: a corrected visit does not
    re-mint (the stored geo keeps its block), and a refused re-mint keeps
    both old halves.
  - Visible in the e2e "the creator measures the code, finishes, and
    downloads a rebuilt zip": 3 fixes at the tap, 3 more seeded before
    Finish, so the zip's level says 6.
- **The code correction is bounded** (M2c review #2; constants
  `CORRECTION_FLOOR_M` = 5, `CORRECTION_ACCURACY_FACTOR` = 3,
  `CORRECTION_DEFAULT_ACCURACY_M` = 5, `CORRECTION_MAX_YAW_DEG` = 120;
  `correctionBoundM`, `CorrectionRefusal`). A level's id is a hash of the
  printed text, so a second print of the poster, or one re-hung elsewhere,
  is "the same code", and its correction would move every note of the
  visit. A correction whose HORIZONTAL move of the code exceeds
  `5 m + 3 x hypot(this visit's median GPS accuracy, the stored level's
mint accuracy)` (unknown or unusable accuracies count as 5 m), or whose
  yaw exceeds 120 degrees, is refused: `settleAlignment` returns the plain
  visit alignment with `refused` set, the plan carries it, the setup
  shows one line and logs it in `tourAuthoring/settled`.
  - **A tighter yaw bound from the sighting's own GPS** (field test 3,
    owner decision D-F6b; `LARGE_TURN_DEG` = 60, `TURN_OUTLIER_FACTOR` =
    3, `turnLimitDeg(quality)`). A stored code whose heading was saved
    wrong turned a whole visit 108 degrees, and a pin 13 m away moved
    24 m. The yaw bound of a correction through a sighting is the smaller
    of 120 and that sighting's pick's turn limit: `max(60, 3 x
visitHeadingSigmaDeg(accuracy, GPS spread))`, from the pick's
    `alignmentInfo.gpsAccuracyM` and `gpsExtentM`. A turn beyond it is
    more than the visit's own GPS heading can be off by, so the code is
    the wrong one and the objects keep the visit's alignment (`refused`,
    `maxYawDeg` the limit). Unknown quality, or a correction judged
    through the end alignment, keeps the fixed 120. The same limit
    replaces the code itself at the settle (D-F6a,
    `code-position-settle.ts`). The golden oracle's seeds 66 and 87 changed
    with it on purpose: their objects had followed a 117- and a 62-degree
    turn against picks good to about 8.5 and 4 degrees.
  - `LARGE_TURN_DEG` is also the result screen's large-turn warning
    (`code-position-rule.ts`, F3), one constant for both.
  - `correctionBoundM(visit, stored, options?)` takes an optional
    `{ accuracyFactor, defaultAccuracyM }` replacing the factor 3 and the
    default 5 m (absent or unusable: the shipped values). They exist for
    the moved-code rule of D20 (`code-displacement.ts`), which shares this
    bound under a floor and whose M5a sweep varies both; the settle never
    passes them.
  - **What the correction's size is when nothing is wrong** - the
    difference of two visits' GPS-only alignments at the code. Measured
    through the real solver (a throwaway sweep, 2026-09-30, 25 seeded pairs
    per arm): visit shapes {a straight walk, pacing within ~6 m of the
    poster, a 30 m walk then pacing}, lengths {30, 120} s at 1 Hz, white
    GPS noise sigma {3, 5} m, and a constant bias of {0, 8, 15} m that was
    (by the sweep's construction) nearly the SAME in both visits:
    - horizontal: p95 3.8-13.8 m, max 14.9 m (30 s visits at sigma 5 m);
      the bias barely moves it when it is shared;
    - yaw: p95 2.3-80.5 degrees, max 95.3 degrees (30 s of pacing at
      sigma 5 m); 120 s of pacing at sigma 5 m still reaches 42.6 degrees,
      a 120 s straight walk only 5.7.
  - **Horizontal bound.** With sigma 3 m in both visits it is 17.7 m, with
    5 m 26.2 m, with 10 m 47.4 m, with 15 m 68.6 m: noise alone (max 14.9 m)
    is never refused. What reverses it: GPS biases that DIFFER between the
    visits add up to their difference on top (two independent 8-10 m
    biases in opposite directions, reported as 5 m accuracy, reach the
    26 m bound) - then a legitimate correction is refused and the visit
    keeps its plain alignment, i.e. symptom B for that visit, never worse
    than before D10b. The other side: a wrong print closer than the bound
    (a poster moved a few metres) cannot be told from GPS and IS applied,
    moving the visit's notes by that much. The costs are symmetric in the
    distance, so the bound only catches gross cases - which is what it is
    for.
  - **Yaw bound.** The heading of a GPS-only alignment is weak when a visit
    is short and stays near the poster: legitimate yaw corrections reached
    95 degrees in the sweep, and those are exactly the corrections D10b
    exists to make (without them the visit's notes turn about the walk's
    centre). So no bound near the code's own yaw noise (a few degrees) is
    admissible; 120 degrees refuses a code seen on the opposite side
    (a print facing another way) and no measured legitimate sample. What
    reverses it: a visit shorter than 30 s, or one minted after the mint
    gate's 3 fixes and settled before more arrive, can have any heading,
    and a legitimate correction above 120 degrees is then refused (plain
    alignment, as above).
  - Not modelled: correlated (random-walk) GPS noise, which makes headings
    worse than white noise does; multi-code tours.
- **The sighting is already a fused pose.** `CodeSighting.odomPose` is the
  fused source's joint solve over its window (up to 8 detections), not a
  single frame. The source offers no average across successive stable
  evaluations (overlapping windows, correlated), so none is taken.
- **"Seen" is the fused pose source's own `stable` status** (the gate the mint already uses; see
  `creator-setup.ts.md`).
- **A stored pose is never replaced by measuring** (`measurementRole`):
  a code re-measured in a later visit is that visit's sighting, and the
  earlier pose stays the reference. Until M2c review #5 the newest
  measurement won, which re-minted the code through the later visit's GPS
  away from the notes settled against it - and, for a hosted tour opened in
  a new page, replaced the hosted code while the hosted notes kept the old
  frame (symptom B across sessions). Combining several visits'
  measurements is still the M3a spike (plan §3.3).
- Never throws: a pose that cannot be minted leaves that object out.

## Examples

```ts
const plan = planVisitSettle({
  visit: ctx.arSessionGeneration,
  placed: ctx.placedObjects,
  alignment: selectAlignmentMatrix(state), // before the teardown
  zero: selectZeroReference(state),
  mintedLevel: codes.inHand(),
  measurement: codes.measurement(),
  sighting: codes.sighting(),
  alignmentInfo,
  nowIso: new Date().toISOString(),
});
```

## Tests

- `visit-settle.codes.test.ts` (M4b) - two stored codes, each note through
  the code nearest it in walked distance; what lands after the settle
  through the code seen last; a note out of every reach on its own
  alignment; a one-code list equal to the legacy fields; a mixed visit (a
  stored code sighted, a new one measured); two measured codes both
  re-minted. Its five sampled mutants are in
  `scripts/fixtures/creator-setup.mutants.json` ("settle per code").
- `visit-settle.golden.test.ts` - the one-code oracle; since M4b it
  compares the legacy fields and checks `levels` is the legacy `level`.
- `visit-settle.test.ts` - B2 (code and pin through different tap-time
  alignments disagree; settled they agree), a pin's record and facing, a
  photo's rotation, the re-minted code's quality block (the settle
  alignment's; a refused re-mint changes neither geo nor block), other visits and restored objects untouched, nothing to
  do, refusals without alignment or zero; the cross-visit correction to the
  measuring visit's alignment, the same with the second session's odometry
  origin turned 70 degrees and moved 8 m (so only the sighting, never the
  measurement's pose, gives the right answer; M2c review #3), the plain
  alignment without a sighting or
  with a different code's, a restored level counting as stored earlier, and
  an unreadable stored level; the plausibility bound (its formula, a
  correction just inside and just outside it at accuracies {3, 5, 10, 15}
  m, the yaw bound at 119 and 121 degrees, and the refusal carried into
  the plan); the bound's options (a factor and a default accuracy reach
  it, absent or unusable ones are the shipped values).
- `visit-settle.test.ts` also covers `measurementRole`: the level in hand
  kept (earlier visit, restored draft), the hosted level kept, a same-visit
  re-measure replacing, and every no-readable-pose case; and `planMove`:
  a pin moved in a later visit lands relative to the stored code through
  the correction, the plain visit alignment without a sighting, and a
  refusal without an alignment or a zero.
- `authoring-settle.test.ts` - the same through the real creator setup
  (mint, place, end the visit), the recording's action, the draft rewrite,
  and the cross-visit case with the second session's detections in a moved
  odometry origin.
- `creator-finish.test.ts` - the settle at Finish, once.
- D33: `visit-settle.test.ts` "each object at its own moment" (each object
  and the measured code through its own pick, an unpicked one through the
  end; a code re-minted through its pick carries that alignment's quality block,
  and a pick without its info does not decide the code's geo (R7); the D31
  heading marker of the alignment a code is re-minted through (R7); each note corrected through the sighting nearest it in time, where
  the latest sighting is metres off; the bound judged through the
  sighting's own alignment admits a correct code the end alignment refuses
  and still refuses a far one; kept sightings of another code ignored);
  "which sighting corrects a note" (R3: nearest walked after a stand-still,
  none past the reach, the time rule kept without distances); "a note near
  a code event of the visit that measured the code" (R1: within the reach
  through the code's pick, beyond it its own; nearer a later sighting,
  corrected onto the re-minted code; no distances, its own pick);
  `visit-settle.left-behind.test.ts` (the shipped path at three sweep
  cells, each also failing through the end alignment, and at one R1 and one
  R3 cell, each also failing through the rule it replaced; the relation and
  sighting sweeps, opt-in); and
  `authoring-settle.test.ts` (the wiring).
