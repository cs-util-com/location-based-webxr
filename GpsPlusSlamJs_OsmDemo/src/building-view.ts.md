# `src/building-view.ts`

## Purpose

The three.js view: buildings and trees built from the same merged features the
map scored.

## Public API

- `class BuildingView` — `render(features, centre): BuildingStats`,
  `clearScene()`, `resize()`, `dispose()`. Navigation is `MapControls`, attached
  internally; there is nothing to call.
- `interface BuildingStats` — `volumes`, `parts`, `triangles`,
  `guessedHeights`, `approximateRoofs`, `trees`

## Invariants & assumptions

- **Frames are scheduled ON DEMAND, never in a permanent loop.** The scene is
  static except while the camera is moving, so `requestFrame()` coalesces to one
  pending rAF and the `controls` `change` event drives it. A permanent loop was
  the first attempt and was measured to make the e2e suite ~6x slower
  (21 s -> 2.2 m) and push one test into a timeout; on a phone it is a scene
  that never stops drawing. Damping still works: `controls.update()` emits
  another `change` while the camera eases, which schedules the next frame, so
  the sequence sustains itself and then stops.
- **`dispose()` cancels the pending frame FIRST.** An orphaned frame callback
  touching a disposed WebGL context crashes rather than leaks.
- **`MapControls`, not `OrbitControls` (DEC-5).** Pan-first suits a top-down city
  view. Both ship inside the `three` package the demo already depends on, so
  neither is a new dependency.
- **`guessedHeights` counts BUILDING heights, not terrain.** The status line says
  so in as many words since 2026-07-29: read as bare "guessed heights" it was
  taken for terrain relief (finding M13), and the reasonable conclusion — "it
  knows the elevation and just is not drawing it" — is wrong twice over, because
  no elevation provider is wired and the ground is a flat plane at `y = 0`.
- **`clearScene()` clears AND repaints.** The view renders on demand, so a clear
  without a repaint would leave the last frame in the drawing buffer with
  nothing to ever overwrite it — the pane would keep showing buildings that are
  no longer anywhere in the app's state.

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
- **OPEN FOLLOW-UP: this view has NO north reference, and that is a real gap.**
  The camera is parked at `(140, 110, 140)` looking at the origin, with nothing
  in the scene naming a compass direction — so a city mirrored north/south looks
  exactly like a correct one.
  - That is not hypothetical. `gps-plus-slam-osm` emitted a left-handed mesh
    frame (ENU north at `+z`) until 2026-07-29, and this view — whose whole job
    is to make the mesh checkable by eye — could not show it. It was found in a
    code review instead, and fixed as a breaking change.
  - Adding a debug axis or a north marker closes the loop that let it through.
    Tracked in
    `GpsPlusSlamJs_Docs/docs/2026-07-29-0127-osm-perf-round-followups.md`.
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
