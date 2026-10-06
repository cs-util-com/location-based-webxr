# code-position-settle.ts

## Purpose

The keep-or-replace decision for a STORED code, at its visit's settle (UI
round 1, U3:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`
§7 #3, §8). The settle is where the visit's alignment, its picks and the
code's sightings still exist. This plans what `code-position-rule.ts`
decides there and, when the saved position changes, hands the settle a
measurement of the code, so the existing re-mint path (`planVisitSettle`,
"measured here") does the rest. Pure.

## Public API

- `planCodePosition(input): CodePositionPlan | null`
  - input: `visit`, `mintedLevel` (the saved position), `measurement`,
    `sighting`, `picks`, `alignment` (the end one), `zero`, `endQuality`
    (the end alignment's walk and accuracy), `answerAt(spot)` (the
    remembered answer for the code seen at this spot: `"moved"`,
    `"second-copy"` or null; `creator-setup.ts` passes
    `code-move-prompt.ts` `answerAtSpot`).
  - null: no stored code in hand, a code measured in THIS visit (its own
    settle re-mints it), no sighting of it, no readable alignment or zero,
    a print answered "second copy", or an offset that cannot be computed.
  - otherwise `{ levelId, decision, offsetM, candidate, stored,
measurement, pick }`; `measurement` and `pick` only for `replace` and
    `move`.

## Invariants & assumptions

- **One source for the judge and the re-mint.** The candidate is the latest
  kept sighting of the code in hand through its own pick when the pick
  carries its quality block, else through the end alignment - the rule
  `planVisitSettle` uses for the re-mint (R7 of D33). The walk the rule
  judges is therefore the walk the new level's quality block records, and
  the next visit compares against exactly that.
- Without the block, the returned pick has no alignment (the end one is
  used) but keeps the sighting's moment and walked distance, so the code
  event of R1/R3 of D33 still ties this visit's nearby notes to the code.
- The offset is measured through the same alignment: through the drifted
  end alignment a code seen right at its saved spot can look 40 m off.
- The re-mint keeps the saved print's size (`qr.physicalSizeM`); a level
  without one decides but changes nothing.
- Pure; the caller applies the plan, moves earlier objects with an improved
  code (`move-with-code.ts`) and logs it.

## Examples

```ts
const plan = planCodePosition({ ...settleInputs, answerAt });
const input = {
  ...settleInput,
  measurement: plan?.measurement ?? ctx.codeMeasurement,
  picks:
    plan?.measurement == null ? picks : { ...picks, measurement: plan.pick },
};
```

## Tests

`code-position-settle.test.ts`: a replace through the sighting's own pick
(quality, measurement, size), the offset through the pick and not the end
alignment, R1 kept, a well-walked saved position kept, a far code left to
the question, "moved" applied and held, the answer asked at the right spot,
the null cases, and the end-alignment fallback without a quality block.
The composed behaviour is in `authoring-settle.test.ts` "the code's saved
position, decided at the settle".
