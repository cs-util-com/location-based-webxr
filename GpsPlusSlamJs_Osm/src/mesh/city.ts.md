# `city.ts`

## Purpose

The city a renderer draws, from OSM features and a ground: buildings (parts in
place of their outlines, with the barriers drawn among them), coloured per
feature, merged per chunk for culling and carrying the shell attributes; and
the trees. It was assembled inline in OsmDemo's worker until the globe lab
became this package's second consumer (globe city plan 2026-10-05-0040 §14
L3, the owner's D-K5: the globe uses the library's public API only). Plates,
roads, region slabs, POI markers and the cell grid stay with OsmDemo, which
builds them around this on the same ground.

## Public API

- `cityGround(frame, field?) → CityGround` - `{ frame, groundHeightM? }`:
  the field's `heightAt` at a position's ENU metres, or flat (no sampler)
  without a field. One derivation, so every layer stands on one surface.
- `buildCity(features, ground) → City` - `{ volumes, barriers, buildings,
trees }`. `volumes` and `barriers` are the builders' own results (a caller
  that needs them, OsmDemo for its POI hosts and counters, does not build
  twice); `buildings` are `MeshChunk`s with per-vertex `colors`,
  `featureRand` and `height01`; `trees` are `TreePlacement`s.
- `buildCity(features, ground, { withinM })` keeps only volumes, barriers
  and trees whose own position (a mesh's centroid, a tree's placement) lies
  within `withinM` metres of the origin in both directions: a height field
  covers a window and clamps its edge heights outward beyond it, so a
  building outside would stand on made-up ground (globe city plan
  2026-10-05-0040 §12.4 R12). RangeError for a `withinM` that is not a
  positive number.
- No other error modes: a feature that cannot be built is skipped, as in
  every builder.

## Invariants & assumptions

- **A `building:part` takes its parent's colour** (its tags: `building:colour`,
  then material, then class), because the parts of one building are one
  building. A part without its parent in the set keeps its own.
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

`city.test.ts` - volumes, barriers and trees built; a part coloured exactly
as its parent (and differently under another parent); the ground under every
building; the shell phase stable and in [0, 1); empty in, empty out;
`cityGround` flat without a field and reading the field at the position's ENU
metres; `withinM` dropping what lies outside, keeping all without it, and
refusing a non-positive window. OsmDemo's worker tests and browser suite cover the same assembly in
use.
