# v3-model-rules.js

## Purpose

V3's pure decisions: which building gets an inferred pitched roof, how tall its
storeys are in real metres, and what tone and finish its tags earn. No three.js,
no DOM.

## Public API

- `ROOF_TOLERANCE`: 0.05, the share of its bounding rectangle a footprint may
  miss and still get a roof.
- `fitRectangle(ring)`: minimum-area rectangle on an edge direction,
  `{ centre, axis, cross, halfLength, halfWidth, fill }`; null below 3 points.
- `footprintArea(ring)`: square metres.
- `roofPlanFor(feature, ring, { random, tolerance? })`: `{ shape, box, riseM }`
  or null. `shape` is `gabled` or `hipped`.
- `tagsForMesh(tags, footprintM2)`: the tags the mesh is built from.
- `storeyFor(tags, { minHeightM, eaveHeightM })`: `{ storeyM }`, 0 for no lines.
- `lookFor(tags, parentTags?)`: `{ wall, roof, wallFinish, roofFinish }`, tones
  in linear RGB, finishes in 0..1.
- `parseColour(raw)`: sRGB `[r, g, b]` from hex or a name in the data, else null.

## Invariants and assumptions

- A tagged building is never changed: any of `roof:shape` (including `flat`),
  `roof:height`, `roof:levels`, `height`, `min_height`, `building:min_level`,
  `building:part`, a relation, or a class outside the roofed list gives no plan,
  and `tagsForMesh` returns the same object when it changes nothing.
- `random` must be seeded from the OSM id. Two runs give identical plans.
- Roofs only on rectangles at most 18 m wide and 4 levels high. Rises are
  clamped to 1.2..5.5 m. A near-square gets a hip.
- Tones are tints: a tag's colour loses 40 % chroma, then mixes 28 % (wall) or
  42 % (roof) into the paper. The heat ramp stays the loudest colour.
- Neither fixture carries a `glass` or `metal` tag. The shiny end of the finish
  reaches the page only through the class fallback (office, retail, hotel,
  greenhouse, industrial, warehouse).

## Example

```js
const plan = roofPlanFor(feature, ring, { random: seededRandom(key) });
const { storeyM } = storeyFor(tags, volume.heights);
const look = lookFor(tags, parentTags);
```

## Tests

`v3-model-rules.test.mjs`: `node --test labs/city-look/v3-architects-model/v3-model-rules.test.mjs`
from `GpsPlusSlamJs_DesignSystem`.
