# `src/building-view.ts`

## Purpose

The three.js view: buildings and trees built from the same merged features the
map scored.

## Public API

- `class BuildingView` — `render(features, centre): BuildingStats`, `resize()`,
  `dispose()`
- `interface BuildingStats` — `volumes`, `parts`, `triangles`,
  `guessedHeights`, `approximateRoofs`, `trees`

## Invariants & assumptions

- **It shares the pipeline rather than fetching its own data.** This view exists
  to verify the MESH code, and it can only do that if it is looking at exactly
  the features the 2D view scored — two fetch paths would let a discrepancy be
  the data rather than the geometry.
- **The package produces buffers; this file makes meshes.** `gps-plus-slam-osm`
  must not depend on `three` (plan §4.2), so it stops at `Float32Array` /
  `Uint32Array` and the consumer does the three lines that follow.
- **Materials are DOUBLE-SIDED on purpose.** A wrongly-wound wall should show up
  as a shading oddity rather than disappear; backface culling would hide exactly
  the class of bug this view is here to find.
- **The ENU frame is anchored at the user, not the tile**, so mesh coordinates
  stay small and float32 vertex buffers stay precise where it matters.
- **One merged batch is right HERE and wrong in general.** The package's guidance
  is to batch per res-8/res-9 cell, because a batch spanning a 2.81 km fetch tile
  defeats frustum culling. This view shows one working set and is always wholly
  on screen.
- **`guessedHeights` and `approximateRoofs` are surfaced.** They are the mesh
  layer's two honesty flags and this is the only place they become visible —
  which is how the census figures (16 % with `height`, 12 % non-flat roofs) get
  confirmed on real data rather than quoted.
- **The resize listener is held in a field and removed in `dispose()`.** An
  anonymous inline listener outlives disposal and then calls `setSize()` /
  `updateProjectionMatrix()` on a renderer whose GL context has been released.
  Harmless while nothing calls `dispose()`, but the method exists to be called.

## Examples

```ts
const view = new BuildingView({ container });
const stats = view.render(pipeline.features().values(), position);
```

## Tests

None directly (WebGL needs a browser); the geometry it renders is tested in
`gps-plus-slam-osm`'s `mesh/buildings.test.ts`, including the differential
triangulation harness against `earcut`.
