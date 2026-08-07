# `barrier-volumes.ts` — barriers as drawn geometry

## Purpose

Turns solid OSM barriers into extruded volumes so the demo can **draw** them.
This is the half of DEC-R11-2 that had never shipped: `barriers.ts` knew how
tall a wall was and `nav/obstacles.ts` blocked agents with that answer, but
nothing put the wall on screen.

## Public API

- `buildBarriers(features, options): BarrierVolume[]`
  - `features` — any `Iterable<OsmFeature>`. Anything `isSolidBarrier` rejects
    is ignored.
  - `options.frame` — the scene's `EnuFrame`. Required; thickness is metres, so
    a metric frame is unavoidable for the footprint.
  - `options.groundHeightM?` — `(position: LatLng) => number`, sampled once per
    **segment** at the segment's midpoint. Defaults to flat zero.
  - Returns one `BarrierVolume` per feature that produced at least one quad:
    `{ feature, heightM, mesh }`.
- `BarrierVolume`, `BuildBarriersOptions` — the types above.

**Error modes: none.** Nothing here throws. A feature whose geometry cannot form
a line is skipped, matching `buildBuildings` and the rest of the package — the
planet contains relations that cannot be closed, and a degenerate barrier must
cost itself and nothing else.

## Invariants & assumptions

- **The centreline comes from `barrierCentrelines` in `barriers.ts`.** That
  function is shared with `nav/obstacles.ts` precisely so the drawn wall and the
  indexed wall cannot drift. Do not re-derive it here — the rules about which
  rings of which geometry kinds count took three review rounds (#259, #260,
  #263) to settle.
- **`heightM` on the volume is the same number the index records.** A pinned
  property, not a coincidence: both go through `resolveBarrier`.
- **One extrusion per segment, one ground sample per segment.** Falls out of
  `barrierFootprints` emitting per-segment quads, and it is what makes a wall
  follow a hillside. One sample per feature is the artefact `buildings.ts`
  records (W5, R3-1) as having torn Cologne Cathedral's spires off the model.
- **A non-finite ground sample falls back to 0** rather than propagating. `NaN`
  vertices reach three.js, which draws nothing and reports no error.
- **Roof shape is always `flat`.** A 0.5 m-wide quad has no roof form worth
  generating.
- Meshes are merged **per feature**, because the demo colours and chunks by
  feature key.

## Examples

```ts
const frame = enuFrameAt({ lat: 50.9413, lng: 6.9583 });
const volumes = buildBarriers(features, {
  frame,
  groundHeightM: (p) => field.heightAt(frame.toEnu(p)),
});
// Drawn with the buildings, no toggle and no distinct colour (DEC-R11-11):
const drawn = [...buildingVolumes, ...volumes];
```

## Tests

- `barrier-volumes.test.ts` — defaults per tag (2 m wall, 6 m city wall), a
  tagged `height` winning, terrain offset, per-segment slope following, the skip
  paths, and the carried feature key.
- `barrier-volumes.property.test.ts` — over arbitrary ways and tags: **drawn iff
  indexed**, **drawn height equals indexed height**, and every vertex inside
  `[ground, ground + heightM]`. These carry the inspectability DEC-R11-11 gave
  up by declining a separate layer.
- `barriers.test.ts` covers `barrierCentrelines` and the tag resolution it
  depends on; `barrier-shape.test.ts` and `barrier-shape.property.test.ts` cover
  the quad geometry.

No test data required — the fixtures are hand-built ways.
