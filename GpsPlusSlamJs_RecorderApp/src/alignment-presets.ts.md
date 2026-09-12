# alignment-presets.ts

## Purpose

The alignment presets the in-recording settings wheel switches between (2026-09-02, rotation-first search plan D8 / M3 / M5). Each is a whole candidate config in the library's PUBLIC override names; the wheel dispatches it through `setAlignmentOverrides`, which replaces the previous preset entirely.

## Public API

- `AlignmentPreset` — `{ id, label, overrides }`; `overrides: null` means the shipped defaults (clears any preset).
- `SHIPPED_PRESET_ID` — `'shipped'`, always the first entry.
- `ALIGNMENT_PRESETS` — seven entries, in dropdown order:
  - `shipped` (recency 250, threshold 5) — the baseline; a field test without it measures nothing.
  - The MEMORY LADDER (2026-09-12): `w45`, `w90`, `w180`, `w300`, `wall`. One variable — how far back the solver may look — and nothing else.

**What the ladder is FOR, and it is not what the first draft of this sidecar said.** An offline sweep ranked "no window at all" best and that result was **withdrawn the same day** under adversary review: the metric behind it scores less motion as better (its ranking correlates with "which arm moved least" at Spearman +0.943), and on the in-sample GPS residual every rung from `w90` outward is worse than shipped on **159 of 159** recordings. So the ladder is a **question**, not a recommendation.

The question it asks the tester is **not "which feels steadiest"** — a frozen alignment feels beautifully steady, which is exactly how this failure mode hides. It is **"after a long walk, does the content still sit on the right spot"**. `w45` is present as the deliberately bad rung, because a ladder with no bad rung cannot calibrate the eye against the numbers.

- The ROBUST-SOLVER arm (recency 50, robust solver, accuracy 1): its calmest stage-1 cell, inside noise of shipped; present so the wheel's heading-penalty box has a preset under which it acts (plan D6).

**Removed 2026-09-12** — `f100`, `f100-exp075`, `f25-exp075`, `calm-ret04`, `calm-none-exp075`, `f25-none-exp1`, `f25-thr7-ret04-exp1`. All seven came from the 2026-09-01/02 rotation-first scorecard, whose accuracy-exponent axis is now known to be confounded: the kernel ADDS the accuracy and age terms, so raising `gpsAccuracyExponent` also squashes the recency span, and those presets were never testing accuracy. Each also varied two or three knobs at once, so a field impression could not be attributed to any of them. Recordings store the override PAYLOAD rather than the preset id, so nothing recorded with them is affected — but `seedWheelSettings` reverse-matches overrides to a preset, so replaying such a recording now shows `shipped` in the wheel. The replay is byte-identical; the readback LABEL is what lies.

- `findAlignmentPreset(id)` — lookup; `undefined` for an unknown id, never a silent default.

## Reading "recency N"

`timeWeightFactor` is the steepness of the recency penalty on old fixes, not a memory length: a fix weighs `1 / (1/w + factor · age/oldestAge + 1)`. LARGER is SHORTER memory (old fixes count less); shipped 250 is the short end of the searched range, recency 100 and 25 are flatter penalties (longer memory), and "no recency" weighs every fix the same (the longest). Read that way the stage-2 table is monotone: the longer the memory, the calmer the yaw within a walk and the more two walks disagree, because a long-memory solve keeps its earlier fixes as ballast. The first draft of the labels said "memory 100" and was read as shorter than shipped; the labels now name the direction, and the test refuses "memory N".

## Invariants & assumptions

- **Only whitelisted keys.** Every override key must be one the library's `setAlignmentOverrides` accepts (`ALIGNMENT_OVERRIDE_KEYS`, re-exported by the framework); an unknown key would throw at dispatch time in the field, so the test pins it here.
- **Nothing here is a promotion.** The shipped config stays the default of every session; a preset is applied only when the tester picks it on the wheel and is never persisted.
- **Exactly one preset enables the robust solver**, so the heading-penalty box (disabled otherwise) has a defined home.
- **Every ladder rung sets `timeWeightEnabled: false`.** With recency decay left running, the oldest fix INSIDE a 90 s window is still weighted 251x lighter than the newest, so the window would not be the variable under test. That exact confound wasted an arm in the offline probe; on the phone it would waste a walk.
- **`wall` carries no window key at all, and that is load-bearing.** No public override sets `useOnlyRecentData` back to `false`, so the rung depends on the shipped default being `false` PLUS `setAlignmentOverrides` replacing rather than merging. If that ever became a merge, `wall` would silently inherit the previously selected rung's window — which is why a test pins the produced payload.
- Ids are dropdown values and never renumbered; labels are written for a phone outdoors, not for a config reader, and name the memory direction.

## Example

```ts
const preset = findAlignmentPreset(select.value);
if (preset) store.dispatch(setAlignmentOverrides(preset.overrides));
```

## Tests

`alignment-presets.test.ts` — shipped first with `null`, unique ids, every key whitelisted by the library, the ladder contract (rung ids and order, keys a subset of `{timeWeightEnabled, recentWindowSeconds}`, `timeWeightEnabled: false` on every rung, strictly increasing windows, `wall` carrying only the one key), the seven-entry dropdown order, every removed id resolving to `undefined`, exactly one robust preset, "recency N" naming with `^no recency` required on every rung, unknown id → `undefined`.
