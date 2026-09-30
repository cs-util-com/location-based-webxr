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
    does not read, a sighting of a DIFFERENT code, or a correction that
    cannot be computed.
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
    `code-corrected`. Replacing a stored pose on purpose is an explicit action
    later (plan §3.4, M4), never a side effect of measuring.
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
- **No threshold is introduced.** "Seen" for the correction is the fused
  pose source's own `stable` status (the gate the mint already uses; see
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
  an unreadable stored level.
- `visit-settle.test.ts` also covers `measurementRole`: the level in hand
  kept (earlier visit, restored draft), the hosted level kept, a same-visit
  re-measure replacing, and every no-readable-pose case.
- `authoring-settle.test.ts` - the same through the real creator setup
  (mint, place, end the visit), the recording's action, the draft rewrite,
  and the cross-visit case with the second session's detections in a moved
  odometry origin.
- `creator-finish.test.ts` - the settle at Finish, once.
