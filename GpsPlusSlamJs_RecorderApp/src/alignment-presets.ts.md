# alignment-presets.ts

## Purpose

The alignment presets the in-recording settings wheel switches between (2026-09-02, rotation-first search plan D8 / M3 / M5). Each is a whole candidate config in the library's PUBLIC override names; the wheel dispatches it through `setAlignmentOverrides`, which replaces the previous preset entirely.

## Public API

- `AlignmentPreset` — `{ id, label, overrides }`; `overrides: null` means the shipped defaults (clears any preset).
- `SHIPPED_PRESET_ID` — `'shipped'`, always the first entry.
- `ALIGNMENT_PRESETS` — nine entries, in dropdown order:
  - `shipped` (recency 250, threshold 5).
  - The two stage-2 SURVIVORS: recency 100, and recency 100 + accuracy exponent 0.75 (the rotation-first scorecard's candidates 1 and 2; both calmer than shipped on every rotation axis, within 1° of cross-walk agreement).
  - The FIELD-JUDGEMENT block (full search stage 2, 2026-09-02, findings G3): recency 25 + accuracy 0.75; the calmest row of the grid (no recency, keep 40 %); no recency + no rejection + accuracy 0.75 (owner request at the stage-2 interview: the no-rejection end of the grid); and two recency-25 rows (no rejection; threshold 7 + keep 40 %). Every one of these failed the search's cross-session guardrail and carries the cost in its label ("agreement −4.4°": two walks of the same street agree that much less than under shipped, one building; "+1.1 m" where the position p90 also left the +1.0 m allowance).
  - The ROBUST-SOLVER arm (recency 50, robust solver, accuracy 1): its calmest stage-1 cell, inside noise of shipped; present so the wheel's heading-penalty box has a preset under which it acts (plan D6).
- `findAlignmentPreset(id)` — lookup; `undefined` for an unknown id, never a silent default.

## Reading "recency N"

`timeWeightFactor` is the steepness of the recency penalty on old fixes, not a memory length: a fix weighs `1 / (1/w + factor · age/oldestAge + 1)`. LARGER is SHORTER memory (old fixes count less); shipped 250 is the short end of the searched range, recency 100 and 25 are flatter penalties (longer memory), and "no recency" weighs every fix the same (the longest). Read that way the stage-2 table is monotone: the longer the memory, the calmer the yaw within a walk and the more two walks disagree, because a long-memory solve keeps its earlier fixes as ballast. The first draft of the labels said "memory 100" and was read as shorter than shipped; the labels now name the direction, and the test refuses "memory N".

## Invariants & assumptions

- **Only whitelisted keys.** Every override key must be one the library's `setAlignmentOverrides` accepts (`ALIGNMENT_OVERRIDE_KEYS`, re-exported by the framework); an unknown key would throw at dispatch time in the field, so the test pins it here.
- **Nothing here is a promotion.** The shipped config stays the default of every session; a preset is applied only when the tester picks it on the wheel and is never persisted.
- **Exactly one preset enables the robust solver**, so the heading-penalty box (disabled otherwise) has a defined home.
- Ids are dropdown values and never renumbered; labels are written for a phone outdoors, not for a config reader, and name the memory direction.

## Example

```ts
const preset = findAlignmentPreset(select.value);
if (preset) store.dispatch(setAlignmentOverrides(preset.overrides));
```

## Tests

`alignment-presets.test.ts` — shipped first with `null`, unique ids, every key whitelisted by the library, the three scorecard candidates' knobs, the nine-entry order with the field-judgement labels carrying their agreement cost, exactly one robust preset, "recency N" naming with the direction on the survivors, unknown id → `undefined`.
