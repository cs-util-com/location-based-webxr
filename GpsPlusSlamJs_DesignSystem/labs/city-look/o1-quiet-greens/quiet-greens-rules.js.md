# quiet-greens-rules.js

## Purpose

The pure decisions of the O1 "quiet greens" look prototype. It answers these questions:

- what a tree is from its tags;
- how big it is;
- what muted colour it gets;
- how a hedge, wall or fence looks;
- where invented ("cosmetic") trees stand in a mapped wood, an orchard or a tree row.

It uses no three.js and no DOM, so `node --test` covers all of it.

## Public API

- `PARAMS`: every number the page rests on.
  - The default heights to toggle: 8, 10 and 12 m.
  - The untagged-tree jitter and the crown ratio. These are the library's own.
  - The LOD near distance, 120 m.
  - The wood density and cap: 0.02 per m² (twice OSM2World's 0.01, which read as a park), a cap of 3000.
  - The forest height factor, 1.5.
  - The orchard spacing and height: 6 m apart, 4.5 m tall.
  - The row spacing and clearance: 8 m apart, 4 m clear.
  - The colour jitter.
- `parseLengthM(value)` reads `12`, `12 m` and `25'` and returns metres. For anything else, or a value not above zero, it returns `undefined`.
- `treeClass(tags)` returns `{ leafType, leafCycle, source }`.
  - The leaf type comes from the first of these that answers: `leaf_type`, then the older `wood`, then the first word of `genus`/`species`/`taxon`, checked against a short list of genera.
  - A mixed area stays `mixed`.
  - Larch, Metasequoia and Taxodium are deciduous.
  - An untagged tree stays `unknown`, with `source: "none"`. Nothing is guessed.
- `treeSize(tags, key, { defaultHeightM })` returns `{ heightM, crownM, trunkRadiusM, heightTagged }`.
  - Tagged `height`, `diameter_crown` and `circumference` win.
  - An untagged tree is the default height times a seeded factor from 0.75 to 1.25. The default toggle therefore moves untagged trees only.
  - Tags beyond 60 m in height or 40 m of crown are refused.
- `chroma(hex)` is the max minus the min sRGB channel. It is DEC-R4-5's metric.
- `treeColour(class, key, { tint, jitter })` returns a muted sRGB colour per class, with chroma 20 to 35. Today's tree colour is 62.
  - A seeded lightness spread is applied per key.
  - `tint` scales the chroma; 0 gives grey.
- `formOf(leafType, { untagged })` returns `broad`, `needle` or `neutral`. An untagged tree is `neutral` (DEC-R4-10), or `broad` with `{ untagged: "broad" }`.
- `trunkLayout(form, heightM)` returns `{ crownBaseM, crownHeightM }`, which sum to the height.
- `barrierStyle(tags)` returns `{ kind, colour, heightM, thicknessM, heightTagged, taggedColour }`.
  - Default sizes:
    - hedge and wall: 2 m. This is the owner's, DEC-R11-2.
    - city wall: 6 m.
    - retaining wall: 1 m.
    - fence: 1.2 m.
    - thickness: 0.8 m for a hedge, 0.4 m for a wall, 0.12 m for a fence.
  - A tagged `height` or `width` wins.
  - A `material`, `fence_type` or `wall` tag picks a material colour. A hedge is always green.
  - `taggedColour` is the raw `colour` tag, handed to the renderer to parse.
- `pointInRings(point, rings)`: even-odd test over all rings, so holes count.
- `scatterInArea(rings, key, { densityPerM2, clip, exclude, taken })` places one tree per cell of a world-aligned grid, jittered from the cell, inside the rings, the clip and the exclusion.
  - Every point is `{ x, y, key, cosmetic: true }`.
  - A shared `taken` set keeps overlapping woods from planting a cell twice.
- `orchardInArea(rings, key, { spacingM, clip, exclude })` lays out rows along the outline's longest edge.
- `alongLine(points, key, { spacingM, avoid, clearM, clip })` places trees along a tree row, starting half a step in. It skips any spot within `clearM` of a mapped tree.
- `capByRank(points, cap)` returns at most `cap` points, those with the lowest seeded rank, so the wood thins evenly. They come back in key order.
- `makeExclusion({ rings, segments, cellM })` returns `(x, y) => boolean`. It is true inside a building ring, or within `halfWidthM` of a road segment. The test is bucketed on a grid.
- `lodOf(distanceM, nearM)` returns `"near"` or `"far"`.

## Invariants and assumptions

- Coordinates are local ENU metres, `x` east and `y` north.
- Every random choice is `seededRandom` of an OSM key, or of a grid cell. The same data gives the same trees on every reload and every device.
- Every point these functions invent carries `cosmetic: true` and a key `<osm key>#<cell>`. That is what keeps it out of navigation and scoring later.
- Bad input:
  - An unparseable length is `undefined`, never NaN.
  - An empty area gives no points.
  - A density, spacing or cap that is not positive gives none.

## Examples

```js
const cls = treeClass({ genus: "Larix" }); // needleleaved, deciduous
const size = treeSize({}, "node/1", { defaultHeightM: 10 }); // 7.5 to 12.5 m
const pts = scatterInArea(rings, "way/5", {
  densityPerM2: 0.01,
  taken: new Set(),
});
```

## Tests

`quiet-greens-rules.test.mjs`: run it with `node --test labs/city-look/o1-quiet-greens/quiet-greens-rules.test.mjs` from `GpsPlusSlamJs_DesignSystem`.
