# house-shell.js

## Purpose

A planned house as plain triangles in render axes (east, up, -north): walls
from just below the ground to the eave, the eave's underside, slopes, gables
and flat tops, every face wound outwards for one-sided materials.

## Public API

- `appendHouse(plan, sink, { triangulate, rgb })`: appends to
  `sink = { positions, colours }` (flat arrays, three floats per corner, no
  index). `plan`: `{ rings, roofRings, roof, eaveM, tan, colours }` from
  `roofscape-rules.js`; `rgb(colour)` returns `[r, g, b]` in the renderer's
  linear space.

## Invariants and assumptions

- Winding is set per triangle from the wanted normal (slopes up, walls and
  gables out, soffits down), so the skeleton's point order does not matter.
- One house is stitched before it is appended: corners within 6 mm are welded
  and an edge with another corner on it is split there, so no T-junction leaves
  a pinhole. The only open edges are the wall feet at -0.2 m, under the ground.
- Pure, no three.js; the page builds one non-indexed `BufferGeometry` from it.

## Example

```js
const sink = { positions: [], colours: [] };
for (const plan of plans) appendHouse(plan, sink, tools);
```

## Tests

`house-shell.test.mjs` (normals, a closed shell with and without an eave, a
gable from the ground to the ridge, the flat lid) and the real-fixture crack
check in `roofscape-rules.test.mjs`.
