# v4-facade.js

## Purpose

V4's pure decisions: wall and roof colour from tags, metres per storey, bays per wall, and the per-vertex numbers the shader reads.

## Public API

- `parseLook(search)`: the look's link values (`foot`, `footh`, `line`, `win`, `eave`); junk takes the default, the rest clamps.
- `wallRgb(tags, key)`, `roofRgb(tags, key)`: packed colour. Tagged colour, then tagged material, then an inferred class tone moved a little by `key`.
- `storeyHeightM(tags, ownTags, spanM, perimeterM)`: metres per storey, 0 for none.
- `perimeterOf(mesh)`: length of a volume's wall quads.
- `bayWidthM(key)`, `bayCount(lengthM, bayM)`: the window rhythm.
- `facadeFor(mesh, spec)`: `{ facade, colours }` per vertex. `facade` is metres above the ground, metres per storey, bay coordinate, wall top; top 0 means a roof. `colours` are linear.

## Invariants and assumptions

- A tagged colour or material is never moved by the seed. Named colours are read too, the library's hex-only reader misses them.
- Everything inferred is seeded from the OSM id, never an index.
- Geometry is never changed, so triangles equal V0.
- Colours are display colours converted to linear, unlike the library (hex over 255 taken as linear), so colours keep their depth instead of washing out; what is shown still depends on the light and the grade.
- Wall quads are recognised by the library's vertex order; a face that fails the test and is near vertical is a gable: wall colour, no windows.
- A bare `building=yes` gets storeys only with an address, levels, an amenity other than a shelter, or a perimeter of 28 m or more.

## Example

```js
const { facade, colours } = facadeFor(mesh, {
  baseY: 0,
  storeyM: 3,
  bayM: 3,
  wall: wallRgb(tags, "way/1"),
  roof: roofRgb(tags, "way/1"),
});
```

## Tests

`v4-facade.test.mjs` (`node --test`).
