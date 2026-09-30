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
- **No threshold is introduced.** "Seen" for the correction is the fused
  pose source's own `stable` status (the gate the mint already uses; see
  `creator-setup.ts.md`). A code re-measured in a later visit becomes that
  visit's `measured-here`; which measurement a level should keep across
  visits is the M3a spike (plan §3.3).
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
  photo's rotation, other visits and restored objects untouched, nothing to
  do, refusals without alignment or zero; the cross-visit correction to the
  measuring visit's alignment, the plain alignment without a sighting or
  with a different code's, a restored level counting as stored earlier, and
  an unreadable stored level.
- `authoring-settle.test.ts` - the same through the real creator setup
  (mint, place, end the visit), the recording's action, the draft rewrite.
- `creator-finish.test.ts` - the settle at Finish, once.
