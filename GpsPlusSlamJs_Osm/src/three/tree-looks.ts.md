# `three/tree-looks.ts`

## Purpose

The CPU mix of tree crown colours over a city's colour looks, shared by the
crown form (`city-objects.ts`) and the trunk form (`trunk-trees.ts`).
Reached through `setTreeLookWeights(objects, lookWeights)` in
`city-objects.ts`.

## Public API

- `linearTreeLooks(looks)`: each look's sRGB 0-1 channels
  (`TreeInstances.lookColours`) converted to three's linear working space
  (as `setColorAt` stores them); undefined for none.
- `checkedTreeLookWeights(weights, looks)`: the weights when one finite
  value >= 0 per look, else `RangeError`.
- `mixTreeLooks(looks, weights, out)`: `out = sum(weights[k] * looks[k])`
  item by item, over the shorter of `out` and a look.

## Invariants & assumptions

- **The normalised look weights, not the trim-folded ones:** the brightness
  trim reaches buildings and roads only (the app's `neutralSurface`
  materials), never trees.
- **Mixed in linear space**, so weight 1 on look k gives exactly the
  instance colour a fixed build of look k sets.
- **Why the CPU and not the GPU:** the tree material is shared by every
  city, and a uniform cannot reach one colour per instance without a shader
  patch on it; the mix is K multiply-adds per channel per instance.
- **Cost** (`tree-looks.bench.ts`, desktop Node, 23 077 crowns in four
  looks, three quiet runs, 2026-11-19): crown form p50 0.50-0.55 ms, p90
  0.63-0.81 ms; trunk form (with its slot rewrite) p50 0.74-0.78 ms, p90
  0.82-0.93 ms. Runs while other processes loaded the machine read p90 up
  to 5 ms (crown) and 17.6 ms (trunk): contention, not the mix. The budget
  is 4 ms per step on the phone; a phone p90 over it moves the mix to the
  GPU.

## Examples

```ts
setTreeLookWeights(objects, [0.5, 0.5, 0, 0]); // returns the trees recoloured
```

## Tests

`tree-looks.test.ts`: `packInstances` with looks (look 0 equals
`colours`, none when a variant's trees disagree); the crown form's linear
mix at weight 1 and at a half mix; the trunk form's rewrite of the sorted
slots and the mix surviving the next sort; the refusals, and trees without
looks left alone. `tree-looks.bench.ts` measures the cost above.
