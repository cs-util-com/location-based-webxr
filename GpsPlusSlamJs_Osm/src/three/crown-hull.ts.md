# `three/crown-hull.ts`

## Purpose

The trees' crown geometry: a closed, low-polygon crown of revolution, the one shape behind every tree form (crown-only in `city-objects.ts`, trunk-and-crown near and far in `trunk-trees.ts`).

## Public API

- `crownHull(sides, rings)`: a non-indexed `BufferGeometry` from a pole at y 0 to a pole at y 1 through `rings` of `[y, radius]`, `sides` around, with `position`, `color` and computed normals. RangeError for no rings.

## Invariants & assumptions

- 2 x sides x rings triangles (a fan at each pole, two triangles per side per band).
- Odd rings turn half a step, so each band is a strip of alternating triangles.
- Each vertex carries a grey from 0.86 at the foot to 1.04 at the top, which the instance colour is multiplied by: a crown reads darker underneath at no cost.
- The caller picks the scale: the crown forms use a unit diameter (radius at most 0.5).

## Examples

```ts
const broad = crownHull(5, [
  [0.3, 0.45],
  [0.72, 0.43],
]); // 20 triangles
```

## Tests

Through its callers: `city-objects.test.ts` (the crown-only forms: triangle counts, vertex shade, unit bounds) and `trunk-trees.test.ts` (the near and far triangle counts).
