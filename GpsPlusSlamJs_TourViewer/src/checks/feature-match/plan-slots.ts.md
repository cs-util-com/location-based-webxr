# plan-slots.ts

## Purpose

The photo test's protocol as plain data: the list of pair slots a run walks through, each slot's status, the photo due next, the step after a complete pair and the summary the tester pastes back. Pure, so the slice and every view share one reading of it.

## Public API

- `MAX_SPOTS` (3), `MAX_EXTRA` (8).
- `slotList(spots, extra): Slot[]` - the light pairs 1a, 1b, 1c per place (1 to `MAX_SPOTS`), then 2a to 4d at place 1, then `x1-s1` ... extra pairs. Slot ids (`<key>-s<spot>`) name the pairs' folders and the plan's records. Counts are clamped; NaN reads as the minimum.
- `slotStatus(pair)` - `missing` (no A), `half` (A only), `done`, or `retake` (both photos, light check failed).
- `doneCount(list, pairs)` - slots with both photos (done or retake).
- `shotDue(pair, retake)` - the photo the camera button takes: the retake's, else A, else B, else null.
- `nextStep(list, pairs, current)` - the first slot after `current` that is not done (a retake stops the walk, so its warning is seen), else the first slot missing a photo unless that is the current one, else `end`.
- `runZipName(session)` - `feature-match-run-<session>.zip`.
- `summaryText(input)` - the lines the tester copies: complete count, places, missing ids (`none` when none), light checks, retakes, the file, the phone, and that no location, time or names are included.

## Invariants and assumptions

- Ids are unique for any counts; light pairs come before all others.
- `nextStep` never points at a done slot and never offers the current slot as missing.
- Pure; no DOM, no state.

## Example

```ts
const list = slotList(plan.spots, plan.extra);
const step = nextStep(list, plan.slots, plan.current);
```

## Tests

`plan-slots.test.ts` (list order, clamping, statuses, shot due, the steps, the summary) and `plan-slots.property.test.ts` (unique ids and caps; the step rules for any pairs).
