# model-scale.ts

## Purpose

A placed model's size rule, shared by every page that draws one (the
desktop editor's 3D view today, the phone's AR next): the factor that
makes the model's largest side the tour's `sizeM` metres. It sits beside
`glb-model.ts`, the one loader both pages use.

## Public API

- `modelScale(model, sizeM)` -> the factor that makes the largest side of
  the model's box at rest `sizeM` (node transforms included, the model's
  own transform left out); 1 for a model with no extent. RangeError for a
  size that is not finite and > 0.

## Invariants & assumptions

- **"Largest side", defined once by the format** (`tour-blocks.ts` in the
  framework): the axis-aligned box of the model at rest (its geometries'
  own boxes), node transforms included, in the model's own frame
  (wherever it is placed, its own transform left out), the largest of its
  three extents. Every renderer scales by this function, so the same file
  never shows a model at two sizes.
- **Not in the Globe package:** `sizeM` is the tour format's field, and
  the globe draws no tour content.
- Module-level scratch boxes and matrices: not re-entrant, fine for a
  single-thread frame loop.

## Examples

```ts
const model = await loadGlbModel(blob);
model.scale.setScalar(modelScale(model, block.sizeM));
```

## Tests

`model-scale.test.ts`: the model's largest side scaled to its size (a
node transform counted), a model with no extent kept at its own size, a
size that is not finite and > 0 refused.
