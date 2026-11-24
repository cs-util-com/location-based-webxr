# bench-methods.ts

## Purpose

Turns the page's choices into the list of methods to run, and reads the form's values.

## Public API

- `MethodSelection { sift, xfeat, aliked, siftLightGlue, backends, precisions }`.
- `RunPlace`: `main thread` or `worker`.
- `buildMethods(selection, deps, place = "main thread")`: SIFT once (its backend names the place); XFeat per backend and precision; ALIKED + LightGlue per backend; SIFT + LightGlue (`method-sift-lightglue.ts`) per backend. Cheapest first. Every model method carries the backend it asks for (`BenchMethod.backend`); SIFT has none.
- `backendsFrom(values)`: the ticked backend boxes (`webgpu`, `wasm`) in that fixed order, whatever order they come in; an empty list stays empty (no XFeat or ALIKED then); throws `RangeError` on an unknown value.
- `precisionsFrom(values)`: the ticked XFeat model file boxes (`fp16`, `fp32`), same rules.
- `selectionGaps(selection)`: one sentence per ticked method that `buildMethods` would leave out (XFeat with no backend or no model file, ALIKED + LightGlue or SIFT + LightGlue with no backend); empty when every ticked method runs. The page refuses to run on a gap rather than drop a method without a word.
- `runSettings({ pair, backends, precisions, runs }, webgpuAvailable)` -> `RunSettings { photoTest, backends, precisions, runs, warmup, line }`. A protocol pair (any key but `none`) is a photo test and overrides the Options: 1 run, no warm-up, `webgpu` only (`wasm` when `webgpuAvailable` is false, and the line says "(no WebGPU on this device)") and the `fp16` XFeat file only. `none` or `null` (the synthetic run) keeps the Options with a warm-up. `line` starts with `runs:` and names what is used, e.g. `runs: 1, no warm-up, backends webgpu, XFeat files fp16 (photo test 1b)`.
- `parseRuns(value)`: a whole number 1 to 50, else 5.

## Tests

`bench-methods.test.ts`: including the property that `selectionGaps` is empty exactly when every ticked method gives at least one entry in `buildMethods`; `runSettings` for a photo test pair, the WASM fallback and the Options path; a worker build naming `js (worker)`; the backend asked for set on every model method and absent on SIFT.
