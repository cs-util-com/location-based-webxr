# bench-methods.ts

## Purpose

Turns the page's choices into the list of methods to run, and reads the form's values.

## Public API

- `MethodSelection { sift, xfeat, aliked, backends, precisions }`.
- `buildMethods(selection, deps)`: SIFT once; XFeat per backend and precision; ALIKED + LightGlue per backend. Cheapest first.
- `backendsFrom(values)`: the ticked backend boxes (`webgpu`, `wasm`) in that fixed order, whatever order they come in; an empty list stays empty (no XFeat or ALIKED then); throws `RangeError` on an unknown value.
- `precisionsFrom(values)`: the ticked XFeat model file boxes (`fp16`, `fp32`), same rules.
- `parseRuns(value)`: a whole number 1 to 50, else 5.

## Tests

`bench-methods.test.ts`.
