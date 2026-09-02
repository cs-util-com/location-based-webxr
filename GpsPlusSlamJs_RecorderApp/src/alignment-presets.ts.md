# alignment-presets.ts

## Purpose

The alignment presets the in-recording settings wheel switches between (2026-09-02, rotation-first search plan D8 / M3 / M5). Each is a whole candidate config in the library's PUBLIC override names; the wheel dispatches it through `setAlignmentOverrides`, which replaces the previous preset entirely.

## Public API

- `AlignmentPreset` — `{ id, label, overrides }`; `overrides: null` means the shipped defaults (clears any preset).
- `SHIPPED_PRESET_ID` — `'shipped'`, always the first entry.
- `ALIGNMENT_PRESETS` — shipped, then the three rotation-first scorecard candidates (memory 100; memory 100 + accuracy exponent 0.75; memory 25 + accuracy exponent 0.75), then the stage-2 winners of the full search once it has run (appended by plan M5 with their measured columns documented in the private repo).
- `findAlignmentPreset(id)` — lookup; `undefined` for an unknown id, never a silent default.

## Invariants & assumptions

- **Only whitelisted keys.** Every override key must be one the library's `setAlignmentOverrides` accepts (`ALIGNMENT_OVERRIDE_KEYS`, re-exported by the framework); an unknown key would throw at dispatch time in the field, so the test pins it here.
- **Nothing here is a promotion.** The shipped config stays the default of every session; a preset is applied only when the tester picks it on the wheel and is never persisted.
- Ids are dropdown values and never renumbered; labels are written for a phone outdoors ("memory 100"), not for a config reader.

## Example

```ts
const preset = findAlignmentPreset(select.value);
if (preset) store.dispatch(setAlignmentOverrides(preset.overrides));
```

## Tests

`alignment-presets.test.ts` — shipped first with `null`, unique ids, every key whitelisted by the library, the three scorecard candidates' knobs, unknown id → `undefined`.
