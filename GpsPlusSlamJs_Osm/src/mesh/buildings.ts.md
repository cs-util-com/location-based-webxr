# `mesh/buildings.ts`

## Purpose

OSM features to building volumes, honouring `building:part`.

## Public API

- `buildBuildings(features, { frame, groundHeightM? }): BuildingVolume[]`
- `interface BuildingVolume` — `feature`, `parentFeature?`, `heights`, `mesh`

## Invariants & assumptions

- **Landmark detail is FREE if you honour `building:part` and `min_height`.**
  Cologne Cathedral is not a model file and not a special case — it is many
  `building:part` polygons, each with its own height and `min_height`. A naive
  one-polygon extrusion gives a box; the same extruder applied per part gives
  something recognisably cathedral-shaped, with no landmark database anywhere.
  That is why parts are first in the plan's ordering (§8, 24 % of buildings in
  the census) rather than an advanced feature.
- **A building WITH parts is not extruded itself** — the parts replace it.
  Drawing both is the single most visible S3DB mistake: every detailed building
  gets a box drawn straight through it. Taken from OSM2World's `Building.java`,
  the most complete implementation of the schema anywhere.
- **A part with no containing outline is still extruded.** A tile boundary can
  deliver a part without its parent, and dropping it would erase the building.
- **Containment is tested on a representative point, not on every vertex.** Parts
  routinely share an edge with their outline, so an all-vertices test would
  reject the common case on a floating-point tie. A concave part whose centroid
  falls outside is extruded standalone — visible, and not wrong.
- **A multipolygon contributes only its first polygon.** A building mapped as
  several disjoint polygons is a data error rather than a shape, and extruding
  all of them under one set of heights would be inventing buildings.
- Non-buildings are ignored; a feature whose geometry cannot be built is skipped
  rather than throwing, matching the rest of the package.

## Examples

```ts
const frame = enuFrameAt(userPosition);
const volumes = buildBuildings(index.mergedFeatures().values(), {
  frame,
  groundHeightM: (p) => terrain.at(p) ?? 0,
});
const batch = mergeMeshes(volumes.map((v) => v.mesh));
```

## Tests

`buildings.test.ts` — the outline-with-parts suppression, an outline with no
parts, a part with no parent, the part carrying its own height, and non-building
features being ignored.
