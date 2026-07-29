# `src/building-view.ts`

## Purpose

The three.js view: buildings and trees built from the same merged features the
map scored.

## Public API

- `class BuildingView` — `render(features, centre, terrain?): BuildingStats`,
  `renderCells(mesh)`, `setTerrain(field | undefined)`, `clearScene()`,
  `resize()`, `dispose()`. Navigation is `MapControls`, attached internally;
  there is nothing to call.
- `TERRAIN_EXTENT_M` — half-width of the ground plane and of the terrain sampled
  under it (300 m, i.e. a 600 m plane — DEC-15).
- `interface BuildingStats` — `volumes`, `parts`, `triangles`,
  `guessedHeights`, `approximateRoofs`, `trees`
- `treeConePosition(placement): [x, y, z]` — the scene position of one tree's
  cone, from its ENU placement. Exported because it is the only arithmetic in
  the draw loop and therefore the only part of it provable without a GPU.

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
- **`guessedHeights` counts BUILDING heights, not terrain**, and the word
  BUILDING in the status line is now MORE load-bearing than when finding M13 was
  raised, not less. It was originally ambiguous because there was no terrain at
  all to confuse it with; since W11 there is, and the status line carries a
  second height (`terrain ±N m`) right next to it. The two numbers answer
  different questions: how many footprints had no `height` tag, and how much
  relief the DEM found.
- **`clearScene()` clears AND repaints.** The view renders on demand, so a clear
  without a repaint would leave the last frame in the drawing buffer with
  nothing to ever overwrite it — the pane would keep showing buildings that are
  no longer anywhere in the app's state.
- **`resize()` repaints too, for the same reason (finding R2-3).** `setSize`
  reallocates the drawing buffer, which CLEARS it, so on an on-demand renderer a
  resize leaves the pane blank until something else schedules a frame. The next
  thing that did was the user dragging the camera — which is how the bug was
  reported: the picture returns the moment you touch it. **Any new caller that
  changes the canvas size must schedule a frame**; the two that exist are the
  `window` resize listener and the mobile sheet drag, and the sheet drag is the
  harsh one because it calls `resize()` on every pointer move (coalescing in
  `requestFrame` is what keeps that to one frame per animation frame).

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
- **Trees arrive in ENU and must be reflected here.** `mergeMeshes` output is
  already in the render frame (`-z` north), but `TreePlacement.position` is a
  placement rather than a buffer and stays ENU (`+y` north). `treeConePosition`
  applies the `z -> -z` reflection, the same one `cell-mesh.ts` applies by hand.
  Skipping it — which this file did until 2026-07-29 — put every tree on the
  wrong side of the origin, 100 m from the building it belongs next to, while
  the forest stayed self-consistent and so read as a data problem.
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

`building-view.test.ts` covers `treeConePosition` only — the frame reflection
and the cone's half-height offset. The class itself needs a `WebGLRenderer` and
so cannot be constructed under vitest; the e2e suite exercises it instead. The
geometry it renders is tested in `gps-plus-slam-osm`'s `mesh/buildings.test.ts`
(including the differential triangulation harness against `earcut`) and
`mesh/mesh-orientation.test.ts` (the frame).

The **repaint-on-resize** invariant has two e2e tests, one per caller:
_"repaints after a viewport resize, without waiting for a camera drag"_ and
_"keeps the 3D view painted while the sheet is dragged"_. Both read the drawing
buffer and count non-background pixels, and **neither may touch the camera** —
any pointer interaction repairs the symptom and makes a broken build pass.

The first one also has to **wait for the scene to go quiescent before
resizing**, by polling `toDataURL()` for two identical reads. Without that it is
flaky in the direction that hides the bug: `waitForRefresh` returns when the
status line says "N cells", but the startup terrain load schedules its own frame
through `setTerrain`, and that frame can land after the resize and repaint for a
reason unrelated to `resize()`. This was observed — the test passed once against
unfixed code before the wait was added.
