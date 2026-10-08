# code-position-rule.ts

## Purpose

Which position of a printed code a tour keeps, now that the position is
measured automatically (UI round 1, U3:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`;
owner decisions 2026-10-06: automatic, one question left; the walk rule
depends on GPS accuracy; a real move keeps the pins). It replaces the
"Save the measured position" and "Replace the code's saved position"
buttons and the replace's confirm (the code is measured on its own:
`creator-setup.ts` "Automatic measuring"). Pure.

## Public API

- `interface PositionQuality { extentM, accuracyM }` - the GPS spread an
  alignment rested on and its fixes' accuracy (m); `null` is unknown.
- `isReliable(q)` - `extentM >= max(10, walkNeededM(accuracyM))`; unknown is
  never reliable.
- `decideCodePosition({ stored, candidate, offsetM, moved, far? })` ->
  `CodePositionDecision`, in this order:
  - `moved` (the creator answered "Yes, it moved") AND the code still seen
    15 m or more away: `move` when the candidate is reliable, else
    `move-waits` with `walkMoreM` (how much more walking it needs; 5 m
    accuracy assumed when unknown, for this figure only). A "Yes" while this visit sees the code
    near its saved spot is ignored (U3 milestone review #3: the prompt
    fires just past 15 m and an answer covers 20 m around it, so a "Yes"
    to a GPS-bias prompt could otherwise move a well-walked code);
  - `far` (default `offsetM >= 15`; `code-position-settle.ts` passes the
    code correction's plausibility bound and yaw bound too): `keep` /
    `far` - the move question's domain, never a silent replace;
  - candidate not reliable: `keep` / `not-walked` with `walkMoreM`;
  - stored position reliable itself: `keep` / `stored-good` (no churn per
    visit);
  - otherwise `replace`.
- `CodePositionOutcome { decision, applied }` and
  `codePositionSentence(outcomes)` - the result screen's line after Finish
  (no button announces the decision any more): an applied improvement or
  move outranks a later "kept"; otherwise the latest speaks - how many
  metres this visit's walk was short of what its accuracy needs, for
  `not-walked` and `move-waits` (a waiting move is forgotten at the settle
  and asked again next time); `stored-good` and `far` say nothing.
- `qualityOfLevel(json)` - a saved level's `qr.mintQuality`
  (`alignmentGpsExtentM`, `gpsAccuracyM`, D31); unknown for an older level
  or an unreadable file.

## Invariants & assumptions

- The walk model is the summary's: `walkNeededM` from `code-verdict.ts`
  (accuracy / tan of the heading budget, about 4.77 x accuracy), plus a 10 m
  minimum the summary does not have. The rule judges ONE visit; the summary
  judges visits combined - so the two can differ for a code seen in several
  visits (U3 milestone review #11).
- Parameters and their sweep: the walk needed at 3 / 5 / 7 / 10 / 20 m
  accuracy is about 14 / 24 / 33 / 48 / 95 m; the factor itself was swept
  for code yaw noise 1-5 degrees (4.72-5.19 x, results doc
  `2026-10-01-0354-code-estimate-across-visits-results.md`). The field
  recording's standing re-measure (R1: 3-6 m of spread at 7 m) is refused
  by the 10 m minimum alone: it would reverse for a standing spread of
  10 m or more at a reported accuracy of about 2 m or better. Reachability
  across accuracy 3-20 m is swept in `code-position-settle.test.ts`.
  "Reliable" is the summary's provisional 12 degree heading budget; whether
  a replace at that threshold improves on an unknown older position has
  not been simulated (plan §9).
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

`code-position-rule.test.ts`: the reliability table, the R1 numbers over
accuracy, a property tying `isReliable` to the walk model, each decision
branch (a "Yes" near the saved spot ignored, `far` below 15 m), a property
that nothing unreliable ever replaces or moves, the result line, and
`qualityOfLevel` on new, old and broken files.

## The undo outcome (code book plan M6 v5.1)

`CodePositionDecision` has an `undo` kind. It is never decided here: the
settle logs it when the code was seen back at the spot an automatic move
left. `codePositionSentence` says so. A replace still outranks every other
outcome, and of a move and its undo since the last Finish, the later one
speaks, because that is where the code now is.
