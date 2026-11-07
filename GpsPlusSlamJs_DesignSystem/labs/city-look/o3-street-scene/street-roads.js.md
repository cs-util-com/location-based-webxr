# street-roads.js

Purpose: O3's road ribbons. The library's shape (a quad per segment, an 8-segment round disc at the joins, DEC-R2-13) with the disc dropped only at near-straight interior points, a vertical order by class, and per-vertex data for the kerb-edge shading. Pure: no three.js, no DOM.

## Public API

- `ROAD_PARAMS`: disc segments 8, `straightDeg` 10, rank step 2 cm, disc drop 1 cm, tie lift up to 8 mm, edge widths 0.22 m (car) and 0.08 m (path).
- `SIDEWALK_RGB` (0xc6b49c) and `streetColour(tags, base)`: a `footway=sidewalk` way is lighter than a path but stays warm (the class wins, DEC-R7b-4); everything else keeps `base`.
- `rankOf(tags)`: paths 0, track and service 1, residential, living_street and unclassified 2, everything else 3.
- `isStreetWay(feature)`: `roads.ts`'s `isRoad` for ways (no tunnels, covered or areas).
- `turnDegrees(a, b, c)`, `wedgeGapM(half, deg)` (the outer chord `2 h sin(t/2)`), `junctionKeys(ways)`.
- `pushTriangle(out, rgb, a, b, c)`: winds every triangle to face up; a vertex is `[x, y, height, offset, half, edge]` in ENU metres.
- `rgbOf(packed)`: raw /255, as the library's chunk meshes.
- `buildRibbons(ways, { widthOf, colourOf, straightDeg, maxGapM })` returns `{ positions, colours, street, stats }`. `stats` holds ways, points, discs kept and dropped, quad and disc triangles, the widest notch and the total notch area.

## Invariants

- `straightDeg: 0` reproduces today's triangle count exactly (checked against Heidelberg: 8,884 both ways).
- Ends and junctions (points shared by two ways, or visited twice) always keep their disc.
- `maxGapM` keeps a disc whose dropping would open a chord wider than it, so wide roads keep their joins at angles where narrow paths lose them.
- Deterministic: the tie lift comes from a hash of the OSM key.
- Consecutive duplicate points are dropped before building.

## Example

```js
const built = buildRibbons(ways, {
  widthOf: roadWidthM,
  colourOf: roadColour,
  straightDeg: 10,
  maxGapM: 0.1,
});
```

## Tests

`street-roads.test.mjs` (`node --test`): today's count at 0, straight ways, bends, junctions, winding, determinism, sidewalk colour, ranks, the chord formula, the gap limit.
