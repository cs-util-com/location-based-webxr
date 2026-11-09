# `city.ts`

## Purpose

The city a renderer draws, from OSM features and a ground: buildings (parts in
place of their outlines, with the barriers drawn among them), coloured per
feature, merged per chunk for culling and carrying the shell attributes; and
the trees. It was assembled inline in OsmDemo's worker until the globe lab
became this package's second consumer (globe city plan 2026-10-05-0040 §14
L3, the owner's D-K5: the globe uses the library's public API only). On
request it builds the roads and paths too (round-4 plan 2026-10-11-0122
DEC-R4-7: the globe draws what OsmDemo draws). Plates, region slabs, POI
markers and the cell grid stay with OsmDemo, which builds them around this on
the same ground.

## Public API

- `cityGround(frame, field?) → CityGround` - `{ frame, groundHeightM? }`:
  the field's `heightAt` at a position's ENU metres, or flat (no sampler)
  without a field. One derivation, so every layer stands on one surface.
- `buildCity(features, ground, { window }) → City` - `{ volumes, barriers,
buildings, trees, cosmeticTrees, roads, roadCount }`. `window` (a lat/lng
  `Bbox`) is REQUIRED (city objects plan 2026-11-07-2315 section 4): the
  bounding box of the data the caller fetched; everything invented from a
  relation (the cosmetic trees today) stays inside it. RangeError without it.
  `cosmeticTrees` are `buildCosmeticTrees`' placements (woods, orchards,
  tree rows; rank order, `cosmetic: true`), excluded from every built
  building footprint (also those outside `withinM`) and from road half
  widths, kept within `withinM`; never in `trees`.
- `buildCity(features, ground, { window, cosmeticTrees: false })` builds no
  cosmetic trees (default true, the owner's choice). `volumes` and `barriers` are the builders' own results (a caller
  that needs them, OsmDemo for its POI hosts and counters, does not build
  twice); `buildings` are `MeshChunk`s with per-vertex `colors` (LINEAR light,
  `linearChunkColours`; `roads` stay raw sRGB),
  `featureRand` and `height01`; `trees` are `TreePlacement`s.
- `buildCity(features, ground, { withinM })` keeps only volumes, barriers
  and trees whose own position (a mesh's centroid, a tree's placement) lies
  within `withinM` metres of the origin in both directions. **A building is
  kept or dropped WHOLE** (2026-11-07, bug 10): its parts share one verdict,
  taken at the mean of their mesh centroids, so the window's edge no longer cuts
  a modelled cathedral in half. The reason for the window: a height field
  covers a window and clamps its edge heights outward beyond it, so a
  building outside would stand on made-up ground (globe city plan
  2026-10-05-0040 §12.4 R12). RangeError for a `withinM` that is not a
  positive number.
- `buildCity(features, ground, { roads: true })` also returns `roads`: the
  `buildRoads` ribbons (draped per vertex on the ground; tunnels, covered
  ways and highway areas left out; paths included) within the window, merged
  per chunk with a colour per vertex (`roadColour`: class and surface), and
  `roadCount`. Without it `roads` is empty and `roadCount` 0: a consumer
  that draws no roads builds none. OsmDemo chunked and coloured them inline
  in its worker until 2026-10-11.
- `roads` may instead be a `CityRoadOptions` object, `{ rankStepM?,
mitreLimit? }` (city objects plan 2026-11-07-2315 M4a, review MINOR 4):
  roads are built, with `buildRoads`'s look options passed through, so an
  audit or a before/after page can switch the class lift off (`rankStepM:
0`) or bevel every turn (`mitreLimit: 1`). `{}` and `true` take the
  builder's defaults; only those two keys are passed on, and an invalid value
  throws the builder's `RangeError`. The defaults themselves are not on the
  package entry: `roads.ts.md`.
- `buildCity(features, ground, { palette })` picks the colours of a
  building without colour tags (city objects plan 2026-11-07-2315 M7):
  `"seeded"` (default) the warm palette of `building-palette.ts`, picked from
  the building's key (a part: its outline's), the roof from the clay and
  slate tones when the ladder DREW a sloped roof and the greys when it drew
  a flat lid (`BuildingVolume.roofMethods`: "flat" or "prism", also for a
  pitched tag the ladder could not build; M7 review MINOR 4);
  `"class"` the class colours (`buildingColour`, `roofColour`) as before M7.
  RangeError for any other value.
- No other error modes: a feature that cannot be built is skipped, as in
  every builder.

## Invariants & assumptions

- **Under the default seeded palette** colour tags still win (the part's,
  then the outline's), `building:material` is not read (owner Q3), and every
  volume's roof block gets a roof colour, tagged or seeded. The paragraphs
  below describe the `"class"` palette, and the tag precedence both share.
- **A `building:part` is coloured by its own `building:colour` or
  `building:material` first, and by its parent's colour when it has neither**
  (bug 8, `buildingColour(tags, outline)`), so a mapped copper spire is copper
  and an untagged cathedral is still one colour. A part without its parent in
  the set keeps its own. **Roofs take `roof:colour`** (the part's, then the
  parent's) through `chunkMeshes`'s `roofOf`, on each volume's `roofVertexRanges` (the
  roof block, not the upward faces; review finding 3). A barrier has no roof
  block.
- **A barrier takes `barrierColour`**, its kind's muted colour, a tagged
  material's, and a tagged colour mixed in at half (city objects plan
  2026-11-07-2315 M1); a building takes `buildingColour`.
- **Building chunk colours are linear, road chunk colours raw** (that plan's
  section 7): three.js shades in linear light, and the labs the owner chose
  built building and barrier colours through `THREE.Color` while O3 drew
  roads raw. The conversion wraps the whole `chunkMeshes` call, so roof
  colours are converted with the walls (skeleton roof plan 2026-11-07-2130
  section 9 item 3). The AR shell reads the vertex colour inside its own
  shader, so the conversion also moves its cyan mix slightly.
- **The shell phase is stable across rebuilds** (`shellRandFor`, from each
  feature's first vertex), so the AR shell does not re-randomise when a tile
  loads.
- Heights come from `ground.groundHeightM` exactly as the builders read it;
  with an absolute field (`absoluteDatumFor`) they are heights above the
  ellipsoid, with a relative one above the window's centre.

## Examples

```ts
const frame = enuFrameAt(origin);
const city = buildCity(features, cityGround(frame, heightfieldFrom(data)));
for (const chunk of city.buildings) draw(chunk);
```

## Tests

`city.test.ts` - volumes, barriers and trees built; an untagged part coloured
exactly as its parent (and differently under another parent), in linear light;
a barrier coloured by its kind; a mid-grey `roof:colour` reaching the roof
vertices in linear light; a part's own colour and the roof colours in
`s3db-parts.test.ts`; the ground under every
building; the shell phase stable and in [0, 1); empty in, empty out;
`cityGround` flat without a field and reading the field at the position's ENU
metres; `withinM` dropping what lies outside, keeping all without it, keeping a
building's parts together (`s3db-parts.test.ts`), and
refusing a non-positive window; the cosmetic trees on by default, in their
own field, none when switched off, none inside a built house, within
`withinM`, and the build refused without a window; roads only when asked, the roads and paths
coloured by class and surface and never a tunnel, draped on the ground, kept
within the window; the seeded palette by default (walls and flat or pitched
roofs from the key, a pitched tag drawn as a prism in a flat grey, a part
from its outline, material ignored, `"class"`
reaching the class colours, an unknown palette refused), and Heidelberg's
corpus extract (every untagged pitched roof takes its palette tone on its own
roof vertices: 150 pitched volumes, 81 roof-coloured, 69 seeded, 3 of them
drawn as flat lids and so grey; no stray
colour anywhere). OsmDemo's worker tests and browser suite cover the same assembly in
use.
