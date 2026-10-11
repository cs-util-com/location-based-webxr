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
- `decideCodePosition({ stored, candidate, offsetM, automaticMove?, far?, turnedDeg? })`
  -> `CodePositionDecision`, in this order:
  - `automaticMove` (the automatic code-spot rule moved the code,
    `code-spots.ts`, code book plan M6) and the candidate is reliable:
    `move`. The spot rule only moves after a reliable walk; the check
    here keeps this rule's promise that nothing unreliable ever changes
    a position, whatever its caller asks;
  - `far` (default `offsetM >= REPLACE_CAP_M`, 15 m;
    `code-position-settle.ts` passes the code correction's plausibility
    bound and yaw bound too): `keep` / `far` - the code-spot rule's
    domain, never a silent replace;
  - `turnedDeg` (the visit sees the code at its spot turned beyond what
    its own GPS heading can be off by, `turnLimitDeg`; field test 3,
    owner decision D-F6a): `replace` with `turnedDeg` - the stored
    heading is the wrong one, whatever the walk or the stored quality;
  - candidate not reliable: `keep` / `not-walked` with `walkMoreM`;
  - stored position reliable itself: `keep` / `stored-good` (no churn per
    visit);
  - otherwise `replace`.
- `CodePositionOutcome { decision, applied, turnDeg? }` and
  `codePositionSentence(outcomes)` - the result screen's line after Finish
  (no button announces the decision any more): an applied improvement or
  move outranks a later "kept" (a replace for a turn says that the
  saved DIRECTION was corrected, by how many degrees the visit's GPS
  disagreed, and that nearby pins and photos moved with it); otherwise the
  latest speaks - how many
  metres this visit's walk was short of what its accuracy needs, for
  `not-walked`; `stored-good` and `far` say nothing. When the latest
  outcome's `turnDeg` is at least `LARGE_TURN_DEG`, a sentence follows
  that this visit's GPS and the code's saved direction disagree by that
  many degrees, and how to correct the code if it is the wrong one - it
  blames neither (the 2026-10-08 field test, F3; owner decision D-F3).
- `LARGE_TURN_DEG` (60, defined in `visit-settle.ts` since field test 3)
  - from this turn on the line warns: a short walk's own GPS direction is
    off by tens of degrees. Not swept (the corpus replay that would set it
    is gone; filed). Below the visit's turn limit the code still corrects
    the visit and the warning shows; beyond it the code is replaced.
- `alignmentTurnDeg(a, b)` - how far one column-major alignment is turned
  against another about the vertical, 0..180 degrees, either way round;
  translations ignored.
- `REPLACE_CAP_M` (15 m) - the farthest a silent replace may shift a saved
  position (U3 milestone review #11). Until M6 it was the move question's
  `MOVE_PROMPT_FLOOR_M`.
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
branch (an automatic move applied, and never from an unreliable walk;
`far` below 15 m), a property
that nothing unreliable ever replaces or moves, the result line, and
`qualityOfLevel` on new, old and broken files.

## The undo outcome (code book plan M6 v5.1)

`CodePositionDecision` has an `undo` kind. It is never decided here: the
settle logs it when the code was seen back at the spot an automatic move
left. `codePositionSentence` says so. A replace still outranks every other
outcome, and of a move and its undo since the last Finish, the later one
speaks, because that is where the code now is.

- `keep` / `far-unjudged` (M6 milestone review #3) is set by the settle
  when the code-spot rule could not judge a code seen far off. Its line:
  "The code was seen about N m from its saved spot, but this visit could
  not tell whether the poster moved: walk with the code in view for a
  minute or more." An automatic move also needs the floor
  (`MOVED_CODE_FLOOR_M`), even when re-planned (review #9).
