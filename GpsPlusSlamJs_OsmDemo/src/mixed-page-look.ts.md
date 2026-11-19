# `mixed-page-look.ts`

## Purpose

The page-side colours of the time-of-day blend at given look weights: the
ground, the slope colours, the plates and the trim weights the mesh shader
mixes by. Page only (imports three); the worker uses `look-choice.ts`.

## Public API

`mixedPageLook(lookWeights) -> MixedPageLook`

- `ground` / `plates` - packed `0xrrggbb` sRGB, mixed in linear light;
- `slope` - the cool, warm, isoline and rim colours, mixed component-wise;
- `trimWeights` - `lookWeights[i] * brightnessTrim_i`, for `setTrimWeights`
  (the material's own trim is then 1).
- `RangeError` unless exactly four finite non-negative weights.

## Invariants & assumptions

- At a weight of 1 on one look every value is EXACTLY that look's (no round
  trip through linear), so the blend at that weight draws the fixed build.
- sRGB values are never added; mixes are in linear light, as the trees and the
  mesh shader mix.

## Examples

```ts
const mixed = mixedPageLook([0.5, 0.5, 0, 0]);
setTrimWeights(mix, mixed.trimWeights);
view.setGroundColours(mixed.ground, mixed.slope);
```

## Tests

`mixed-page-look.test.ts`: exact at weight 1, linear-light mixing, the
refusals.
