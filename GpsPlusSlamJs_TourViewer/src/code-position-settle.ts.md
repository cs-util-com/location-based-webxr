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

## The device-only fit (a visit a stored code's votes line up)

`deviceFit` (optional) replaces the source above when the settle passes
it (`creator-settle.ts`, "A visit a stored code's votes still line up"):
the code is read through `deviceFit.alignment` at `deviceFit.codeOdomPose`
(the loop-closed pose, `code-device-fit.ts`), judged with
`deviceFit.quality` (the fit's own walk - the shorter of the GPS spread
and the phone's tracking - and the device-only accuracy), and a change is
re-minted at that pose through a pick carrying the fit's alignment, the
device-only `alignmentInfo` and that walk - so the stamp and the geo come
from one fit. Through a fit a turn alone (the turned branch) replaces a
code whose stamp is reliable only when the fit's quality is no weaker
(at least its walk, at no worse an accuracy): through the votes a visit's
heading was always the stored code's, so the branch is new for such a
visit, and a turn seen by a weaker walk is the fit's error as likely as
the code's. An unstamped code is replaced as before. The pick keeps
the latest kept sighting's moment and walked distance (NaN moment when
there is none). Tests: `code-position-settle.test.ts` "planCodePosition
through a device-only fit".

### The replace guard (through a fit only)

Through a fit, a replace for the code's position (not the turned branch)
needs the fit to see the code at least
`FIT_REPLACE_MIN_OFFSET_PER_ACCURACY` (0.75) times the fit's accuracy
from its saved spot. Nearer, the code is kept as `keep` /
`stored-good`, with no re-mint and no new stamp.

- **Why `stored-good` and not `code-placed`:** `code-placed` means the
  visit's own GPS could not judge the code (no fit), and a code kept that
  way is never logged and gives the code-spot rule no candidate. Here the
  fit did judge it, and found it where it is stored within its own
  error: the no-churn meaning of `stored-good` (GPS jumps 5-10 m
  between visits), read from this visit instead of the stamp - so the
  plan's `stored` quality is then NOT reliable. `stored-good` is silent
  on the result screen; `code-placed` speaks only with a walk hint.
- **Why:** a code stored correctly but never stamped (its earlier visits
  were lined up by its votes) was replaced by the fit's own GPS error and
  stamped there, so later visits kept the wrong spot.
- **Why the turned branch is left out:** it fixes a wrong heading, which
  the offset says nothing about. Its guard is `turnLimitDeg` of the fit's
  walk and accuracy (`visit-settle.ts`); the stamped-code check above
  (`turnTrusted`) never holds back an unstamped code. A turned replace
  through a fit re-mints at the fit's pose, so it also moves the position
  by the fit's error and stamps it: the same lock-in, accepted there for
  a heading fix, which is rare.
- **Measured** on the indoor sweep (`creator-code-votes.test.ts`,
  `CREATOR_INDOOR_SWEEP_OUT`: walks 24/38/60 m, accuracy 5/8/15 m, stored
  error 0-25 m, drift 0-3 %, 4 seeds, AR(1) GPS noise), of the voted
  visits' replaces, kept by the guard at k = 0.5 / 0.75 / 1:
  - 5 m accuracy:
    - stored 0 m off (true churn: none would have improved the code): 8 /
      18 / 29 of 32 kept;
    - stored 5 m off: 6 / 20 / 21 of 32 kept, of which 6 / 17 / 18 would
      have improved the code (5 m to a median 2.9-3.2 m);
    - stored 10-15 m off (corrections): 0 / 0 / 0 of 56 kept.
  - 8 m accuracy:
    - stored 0 m off: 6 / 14 / 17 of 18 kept, none an improvement;
    - stored 5 m off: 12 / 14 / 14 of 18 kept, of which 10 / 10 / 10
      would have improved it (to a median 3.5 m);
    - stored 10-15 m off: 0 / 4 / 15 of 28 kept (they would have reached
      a median 4.9 / 4.6 m).
  - 15 m accuracy: no replace at all (the walk gate refuses those fits).
  - So the guard gives up real but small gains (a code 5 m off) along
    with the churn. It is still taken because the two are not symmetric:
    a kept code stays unstamped, so a later visit through a fit can still
    correct it, while a churned code is stamped and stays wrong. The
    verdict on lost corrections turns at 8 m between 0.75 and 1; 0.75
    was chosen (2026-10-26).
- Tests: `code-position-settle.test.ts` (just under and at 0.75 x
  accuracy; a visit without a fit still replaces close to the spot) and
  `creator-code-votes.test.ts` (an unstamped code stored 0 or 3 m off
  kept by a mixed visit).
