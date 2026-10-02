# visit-settle.ts

## Purpose

The authoring settle (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.2, milestone M2c; owner decisions D2 and D10b): at the end of an AR visit,
and at Finish for the visit still running, the geo of the code measured in
that visit and of every object placed in it is recomputed through ONE
alignment, so code and notes share the same GPS error and keep the relation
the phone's tracking saw (symptom B's half "B2", plan §2.2).

Pure. `creator-setup.ts` reads the store (before the session teardown),
applies the result to `ctx.placedObjects` and `ctx.mintedLevel`, rewrites the
draft and logs `tourAuthoring/settled`.

## Public API

- `interface CodeMeasurement` - a mint made in this page: `levelId`, `text`,
  `odomPose` (the stable fused pose, raw WebXR), `sizeM`, `visit`.
- `interface CodeSighting` - the anchor code as the running visit last saw it
  stable: `text`, `levelId`, `odomPose` (raw WebXR, this visit's odometry).
- `type SettleBasis` - `"measured-here" | "code-corrected" | "visit-alignment"`.
- `settleAlignment(input): { basis, alignment } | null` - which alignment a
  visit settles through:
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
    `code-corrected`. Replacing a stored pose on purpose is the explicit
    "Replace the code's saved position" action in
    `creator-setup.ts` (plan §3.4, M4), which skips this function with a
    confirm step first - never a side effect of measuring.
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
  this visit sees the code minus its stored position - the spot the move
  prompt (`code-move-prompt.ts`, M5b) remembers an answer for.
- `storedGeo(json)` - a level's stored geo, or null (the object list's
  distance to the code).
- `planVisitSettle(input): VisitSettle | null` - the settled records by
  index into `placed` (only objects whose `placement.visit` is this visit),
  the basis and the alignment used, and the level re-minted through it when
  the basis is `measured-here` (through `mintQrLevelFromWorld`, the code's
  pose converted with the same `odomNueFromWebXr`). Null when the visit
  placed and measured nothing, or when `settleAlignment` is null.

## Invariants & assumptions

- **One alignment per visit.** Every object of the visit and the code
  measured in it go through the same matrix, so their relative geometry is
  exactly the odometry's (unit test: the offset between pin and code after
  the settle equals the odometry offset turned by the end alignment, within
  1 mm; before it the tap-time records disagree by more than 0.1 m).
- **Only what has odometry is touched.** Objects of other visits and
  restored draft objects (no `placement`) are never in the result; their geo
  stands.
- **A pin keeps no facing** (the identity rotation, as `mintPin` writes it);
  a photo's rotation turns with the alignment.
- **The stored code is the reference in a corrected visit**: it is NOT
  re-minted (`level: null`), because the correction maps this visit onto it.
- **A re-minted level keeps the id** and takes the quality block of the
  alignment at the visit's end (`alignmentInfo`) and the settle's time as
  `mintedAtIso`. A refused re-mint (fewer than `MIN_ALIGNMENT_SAMPLES` fixes)
  keeps the old level.
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
    `gpsAccuracyM` (the end alignment's). The unit test compares the whole
    block, so a field that stayed tap-time would fail it. The tap's mint
    passes no extra `quality` fields today; one added there would have to
    be re-derived here too, or the settle would silently drop it.
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
  mintedLevel: ctx.mintedLevel,
  measurement: ctx.codeMeasurement,
  sighting: ctx.visitCodeSighting,
  alignmentInfo,
  nowIso: new Date().toISOString(),
});
```

## Tests

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
