# code-position-settle.ts

## Purpose

The keep-or-replace decision for a STORED code, at its visit's settle (UI
round 1, U3:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`
§7 #3, §8, §9). The settle is where the visit's alignment, its picks and
the code's sightings still exist. This plans what `code-position-rule.ts`
decides there and, when the saved position changes, hands the settle a
measurement of the code, so the existing re-mint path (`planVisitSettle`,
"measured here") does the rest. Pure.

## Public API

- `planCodePosition(input): CodePositionPlan | null`
  - input: `visit`, `mintedLevel` (the saved position), `measurement`,
    `sighting`, `picks`, `alignment` (the end one), `zero`, `endQuality`
    (the end alignment's walk and accuracy), `sizeM` (the print size the
    visit's poses were solved at), `automaticMove?` (the automatic
    code-spot rule moved the code, `code-spots.ts`; the settle re-mints it
    through this plan).
  - null: no stored code in hand, a code measured in THIS visit (its own
    settle re-mints it), no sighting of it, no readable alignment or zero,
    or an offset that cannot be computed.
  - otherwise `{ levelId, decision, offsetM, candidate, stored,
offsetNorthM, offsetEastM, measurement, pick }`; `measurement` and
    `pick` only for `replace` and `move`.

## Invariants & assumptions

- **One source for the judge and the re-mint** (R7 of D33): the latest
  kept sighting of the code in hand through its own pick when the pick
  carries its quality block and its walk is reliable (least drift since
  the sighting), else through the end alignment. A pick freezes once its
  alignment matures at 40 m of GPS spread, and 4.77 x accuracy exceeds
  40 m above about 8.4 m accuracy: judged through the pick alone, no walk
  could improve or move the code (U3 milestone review #1). The end
  alignment keeps growing with the walk. Through the end alignment the
  returned pick has no alignment but keeps the sighting's moment and
  walked distance, so the code event of R1/R3 of D33 still ties this
  visit's nearby notes to the code.
- The offset is measured through the same source.
- **Far** for a silent replace is the smaller of 15 m and the code
  correction's plausibility bound (`correctionBoundM` of the two
  accuracies, about 13.5 m at 2 m), or a turn beyond
  `CORRECTION_MAX_YAW_DEG`: the settle treats such a sighting as a second
  print or a moved poster (U3 milestone review #11).
- **Turned** (field test 3, owner decision D-F6a): within the horizontal
  bound, a yaw beyond the candidate's turn limit (`turnLimitDeg` of the
  candidate's spread and accuracy: at least 60 degrees and 3 sigma of the
  heading model) means the stored heading is wrong: `turnedDeg` goes to
  the rule, which replaces the code through the usual re-mint whatever
  the walk. Such a turn is then not "far" even past
  `CORRECTION_MAX_YAW_DEG` (a heading stored backwards, or a poster
  re-hung on its spot facing elsewhere). The recording of 2026-10-09: 108
  degrees against a limit of 60 (20.1 m at 5.6 m).
- The re-mint takes the visit's print size (`ctx.activeSizeM`): the size
  the sighting's pose was solved at, as a tap's mint did.
- Pure; the caller applies the plan, moves earlier objects with an improved
  code (`move-with-code.ts`) and logs it.

## Examples

```ts
const plan = planCodePosition({ ...settleInputs, sizeM, automaticMove });
const input = {
  ...settleInput,
  measurement: plan?.measurement ?? codes.measurement(),
  picks:
    plan?.measurement == null ? picks : { ...picks, measurement: plan.pick },
};
```

## Tests

`code-position-settle.test.ts`: a replace through the sighting's own pick,
the offset through the pick and not the drifted end alignment, R1 kept, a
well-walked saved position kept, a far code left to the code-spot rule,
an automatic move applied (and kept from an unreliable walk), the offset
north and east, the null cases, the
end-alignment fallback without a quality block and for a frozen pick that
is not reliable, the reachability sweep over accuracy 3-20 m (a walk just
past the need replaces, just short keeps), the plausibility bound below
15 m. The composed behaviour is in `authoring-settle.test.ts` "the
code's saved position, decided at the settle" and "the automatic code
spots at the settle".

## The candidate's offset (code book plan M6)

The plan carries `offsetNorthM` / `offsetEastM`: where a move would mint
the code, relative to its saved spot. The automatic code-spot rule
(`creator-settle.ts`, `settleCodeSpots`) reads them, so its "move" and
U3's re-mint are the same pose. The one-code oracle
(`__golden__/visit-settle.golden.json`) was regenerated for the two
fields only: 96 added lines, nothing changed or removed.
