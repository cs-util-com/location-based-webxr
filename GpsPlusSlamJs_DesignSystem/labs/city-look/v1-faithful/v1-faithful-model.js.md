# v1-faithful-model.js

## Purpose

The pure decisions of the V1 faithful look: does a footprint fit a rectangle, does a tag leave a building alone, which colour, which guessed height, and the mesh of a house under an inferred roof. No three.js and no DOM, so `node --test` reaches all of it.

## Public API

- `DEFAULTS`: the look's parameters (`tolerance`, `pitchDeg`, `riseCapM`, `overhangM`, `vergeM`, `thicknessM`, `jitter`, `mute`, `heightBand`, `roofRgb`).
- `parseV1Params(search)`: `DEFAULTS` overridden by `tol`, `pitch`, `cap`, `over`, `jitter`, `mute`, `band`, `roof=warm`, `ao=off`. A bad value keeps the default.
- `leftAlone(tags)`: true when a tag says anything about the shape (`height`, `building:levels`, `roof:*` shape keys, `building:part`, `min_height`) or for `building=roof`.
- `fitRectangle(ring, tolerance)`: `{ fits, fill, box }`, the library's area test against the smallest edge-flush box. Short rings fit nothing.
- `roofPlan(tags, { ring, isPart, hasHoles }, params?)`: `{ shape, box, riseM, overhangM, vergeM, thicknessM }` or null.
- `guessedEaveM(tags, areaM2, key, params?)`: seeded height within the class's band, or null when `leftAlone`.
- `wallColour(tags, parentTags, key, params?)` and `roofColour(tags, parentTags, key, pitched, params?)`: `0xrrggbb`.
- `parseColour(raw)`: `#rrggbb`, `#rgb` or a known name; anything else undefined.
- `saturationOf(rgb)`, `linearRgb(rgb)`, `ringArea(ring)`.
- `houseMesh(ring, plan)`: `{ positions, normals, colours, indices }` in render axes (x east, y up, z = -north), per-face vertices. `plan` is `roofPlan`'s result plus `eaveM`, `baseM`, `colours { wall, roof, soffit }`.
- `paintByNormal(normals, wall, roof)`, `scaleHeights(positions, factor)`, `mergeParts(parts)`.

## Invariants and assumptions

- A roof is inferred only with no shape tag at all, not on a part, not with a hole, on a class that takes one, and with a span of at most 18 m on a box of at least 45 m².
- Untagged colours scale in tone only: no hue is added without a tag. Tagged colours are never seeded; they are only moved 12 % towards their own grey.
- Everything inferred is seeded from the OSM key, so a reload changes nothing.
- The walls follow the real footprint and climb to the roof above them. A gable is therefore the wall itself and a notch opens no gap; the roof slab sits on the box and spans the notch.
- `meshWriter` winds each triangle by a hint, so the front side faces out whatever the ring's winding.
- A bad colour tag falls through to the next source instead of painting black.

## Example

```js
const facts = { ring, isPart: false, hasHoles: false };
const plan = roofPlan(tags, facts);
if (plan) {
  const eaveM = guessedEaveM(tags, ringArea(ring), key);
  const wall = linearRgb(wallColour(tags, {}, key));
  const roof = linearRgb(roofColour(tags, {}, key, true));
  const soffit = wall;
  const mesh = houseMesh(ring, {
    ...plan,
    eaveM,
    baseM: 0,
    colours: { wall, roof, soffit },
  });
}
```

## Tests

`v1-faithful-model.test.mjs`, run with `node --test` from `GpsPlusSlamJs_DesignSystem`. It needs no fixture.
