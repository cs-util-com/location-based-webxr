# bench-methods.ts

## Purpose

Turns the page's choices into the list of methods to run, and reads the form's values.

## Public API

- `MethodSelection { sift, xfeat, aliked, backends, precisions }`.
- `buildMethods(selection, deps)`: SIFT once; XFeat per backend and precision; ALIKED + LightGlue per backend. Cheapest first.
- `backendsFor(value)`: `webgpu`, `wasm` or `both`; throws `RangeError` otherwise.
- `precisionsFor(value)`: `fp16`, `fp32` or `both`; throws `RangeError` otherwise.
- `parseRuns(value)`: a whole number 1 to 50, else 5.

## Tests

`bench-methods.test.ts`.
