# code-position-rule.ts

## Purpose

Which position of a printed code a tour keeps, now that the position is
measured automatically (UI round 1, U3:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`;
owner decisions 2026-10-06: automatic, one question left; the walk rule
depends on GPS accuracy; a real move keeps the pins). It replaces the
"Save the measured position" and "Replace the code's saved position"
buttons and the replace's confirm. Pure.

## Public API

- `interface PositionQuality { extentM, accuracyM }` - the GPS spread an
  alignment rested on and its fixes' accuracy (m); `null` is unknown.
- `isReliable(q)` - `extentM >= max(10, walkNeededM(accuracyM))`; unknown is
  never reliable.
- `decideCodePosition({ stored, candidate, offsetM, moved })` ->
  `CodePositionDecision`, in this order:
  - `moved` (the creator answered "Yes, it moved"): `move` when the
    candidate is reliable, else `move-waits` with how many more metres to
    walk;
  - `offsetM >= MOVE_PROMPT_FLOOR_M` (15 m): `keep` / `far` - the move
    question's domain, never a silent replace;
  - candidate not reliable: `keep` / `not-walked`;
  - stored position reliable itself: `keep` / `stored-good` (no churn per
    visit);
  - otherwise `replace`.
- `CodePositionOutcome { decision, applied, candidate }` and
  `codePositionSentence(outcomes)` - the result screen's line after Finish
  (no button announces the decision any more): an applied improvement or
  move outranks a later "kept"; otherwise the latest speaks - "walk about
  N m in AR after seeing the code" for `not-walked` (N from the walk
  model) or "walk about N m more" for `move-waits`; `stored-good` and
  `far` say nothing.
- `qualityOfLevel(json)` - a saved level's `qr.mintQuality`
  (`alignmentGpsExtentM`, `gpsAccuracyM`, D31); unknown for an older level
  or an unreadable file.

## Invariants & assumptions

- One walk model for the rule and the summary: `walkNeededM` from
  `code-verdict.ts` (accuracy / tan of the heading budget, about 4.77 x
  accuracy), so the result screen and the summary never disagree.
- Parameters and their sweep: the 10 m minimum (D31's own threshold) and
  the summary's heading budget. The walk needed at 3 / 5 / 7 / 10 / 20 m
  accuracy is about 14 / 24 / 33 / 48 / 95 m. The field recording's
  standing re-measure (R1: 3-6 m of spread at 7 m) is refused at every
  accuracy from 1 to 20 m, so that verdict does not rest on one value. What
  would reverse it: a minimum below 6 m.
- `move-waits` assumes 5 m when the accuracy is unknown, only for the
  "walk about N m more" figure.
- Defensive: unknown inputs are never reliable; `qualityOfLevel` never
  throws.

## Examples

```ts
decideCodePosition({
  stored: { extentM: null, accuracyM: null }, // a level from before D31
  candidate: { extentM: 40, accuracyM: 5 },
  offsetM: 2,
  moved: false,
}); // { kind: "replace" }
```

## Tests

`code-position-rule.test.ts`: the reliability table, the result line, the R1 sweep over
accuracy, a property tying `isReliable` to the walk model, each decision
branch, a property that nothing unreliable ever replaces or moves, and
`qualityOfLevel` on new, old and broken files.
