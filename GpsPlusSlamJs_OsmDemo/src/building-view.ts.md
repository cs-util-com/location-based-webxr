# `src/building-view.ts`

## Purpose

The three.js view: buildings and trees built from the same merged features the
map scored.

## Public API

- `class BuildingView` — `render(mesh: TransferableMesh, layers?: MeshLayers): BuildingStats`
  (the geometry is built in the WORKER now; this file only turns typed arrays
  into three.js objects, which is what its header always claimed it was for),
  `renderCells(mesh)`, `setTerrain(field | undefined)`,
  `setGroundDebug(enabled)`, `clearScene()`, `resize()`, `dispose()`.
  Navigation is `MapControls`, attached internally; there is nothing to call.
- `TERRAIN_EXTENT_M` — half-width of the ground plane and of the terrain sampled
  under it. **1400 m, i.e. a 2.8 km plane (DEC-R2-8, which overrides DEC-15's
  600 m).**
- `TERRAIN_SPACING_M` — 12 m, the Terrarium z13 pixel pitch at this latitude.
- `MeshLayers` and `BuildingStats` — **re-exported from `mesh-layers.ts`**, which
  owns them because it owns what they describe. `BuildingStats` is `volumes`,
  `parts`, `triangles`, `guessedHeights`, `approximateRoofs`, `trees`, `plates`,
  `plateTriangles`.
- `treeConePosition(placement): [x, y, z]` — also re-exported from
  `mesh-layers.ts`. The scene position of one tree's cone, from its ENU
  placement; kept separate because it is the only arithmetic in the draw loop and
  therefore the only part of it provable without a GPU.

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
  changes the canvas size must schedule a frame**; the callers are the container
  `ResizeObserver`, the mobile sheet drag and the header collapse, and the sheet
  drag is the harsh one because it calls `resize()` on every pointer move
  (coalescing in `requestFrame` is what keeps that to one frame per animation
  frame).
- **The CANVAS is sized by CSS and the DRAWING BUFFER by `setSize` (W1, finding
  R3-2), and the two must not both be driven from three.** `setSize(w, h, false)`
  writes the width/height attributes — `size x devicePixelRatio`, the buffer —
  and skips `canvas.style`; `index.html`'s `#scene canvas { width: 100%; height:
100% }` supplies the layout box. With neither, the element laid out at its
  attribute size: 2-3x its container on a phone, which puts the projection centre
  (and every orbit pivot) outside the visible box while every pixel assertion
  stays green. Passing `updateStyle: true` as well would write an inline style
  that beats the stylesheet, so the rule would silently stop being the mechanism.
- **The size trigger is a `ResizeObserver` on the CONTAINER, not a `window`
  listener.** The container is the `1fr` row of a `auto 1fr` grid, so it shrinks
  when the header grows — and the header grows with no window resize at all, as
  soon as the status line fills in and wraps. Measured at 1280x800: the drawing
  buffer sat **109 px taller than its container** for the whole session, on a
  stale camera aspect. The observer covers window resize, rotation, the sheet
  drag and the header collapse in one place.
- **The sky texture is a BACKGROUND only. Never assign it to
  `scene.environment`.** W20 did, and it took the entire scene down: three.js
  routes any environment map through its CubeUV path, which expects a
  PMREM-processed texture. Given a raw equirect `DataTexture` it emits integer
  `CUBEUV_*` defines into float assignments, and every `MeshStandardMaterial`
  fragment shader fails to compile with
  `'assign' : cannot convert from 'const int' to 'highp float'`.
  - **three.js does not throw for that** — it logs and silently does not draw
    the material. Buildings, trees, plates and the ground plane all vanished
    while the status line still reported "21 volumes" and the whole suite stayed
    green, because every pixel assertion was satisfied by the one surviving
    `MeshBasicMaterial`, the affordance grid. This is also the real cause of what
    W11 recorded as the plates "known gap".
  - PMREM-processing the gradient does **not** rescue it: the texture is one
    pixel wide, which is degenerate for the equirect-to-cube-UV projection.
  - Three other comments in the tree repeated the same wrong claim and were
    corrected with it: `sky-gradient.ts`'s header, the `sky` field docstring, and
    the constructor comment. All three told the next reader to re-add it.
  - The sky-tinted fill the environment map was contributing now comes from a
    `HemisphereLight` whose colours match the gradient's horizon and the ground —
    a light rather than a texture the PBR shader has to sample, so there is no
    shader-compilation surface at all. DEC-R2-1's moving facet edges come from
    the directional light's specular highlight and low roughness, not from an
    environment map.

- **It draws geometry the WORKER built; it no longer builds any.** `render()` used
  to take the merged features and call `buildBuildings`/`buildTrees` itself. Both
  moved into `worker/demo-worker.ts`, because the features are 28–68 MB and must
  not cross the boundary to produce geometry that crosses back — the package's
  mesh output is `Float32Array` precisely so the BUFFERS transfer instead. The ENU
  frame anchoring and the terrain sampling moved with them.
  - The invariant that mattered is unchanged: the geometry is still built from
    exactly the features the 2D view scored, because one pipeline still produces
    both. Two fetch paths would let a discrepancy be the data rather than the
    geometry.
- **The package produces buffers; this file makes meshes.** `gps-plus-slam-osm`
  must not depend on `three` (plan §4.2), so it stops at `Float32Array` /
  `Uint32Array` and the consumer does the three lines that follow. That split is
  what made moving the build into a worker a small change rather than a rewrite.
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
- **The `ResizeObserver` is held in a field and disconnected in `dispose()`.** An
  observer that outlives disposal calls `setSize()` /
  `updateProjectionMatrix()` on a renderer whose GL context has been released.
  Harmless while nothing calls `dispose()`, but the method exists to be called.

## Examples

```ts
const view = new BuildingView({ container });
const stats = view.render(meshFromWorker);
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

## The terrain height ramp (W24, DEC-R2-25)

`setGroundDebug(enabled)` swaps the ground plane between its normal reflective
material and a height ramp. `height-ramp.ts` owns the colour arithmetic; this
file owns the material swap and when the colours are refreshed.

- **The ramp material is UNLIT (`MeshBasicMaterial`), and that is why it is a
  second material rather than `vertexColors` on the existing one.** A lit
  material multiplies the vertex colour by the incoming light, so the ramp would
  be modulated by exactly the shading it exists to see past — ground in shadow
  would read as low, the precise misreading the layer is here to eliminate.
- **The heights are read back out of the POSITION buffer**, not kept alongside
  it, so the colours cannot disagree with the surface they describe. There is one
  source of truth and it is the geometry actually being drawn. The plane is built
  in its own XY space, so height lives in `z`.
- **`setTerrain` recolours while the ramp is showing.** The ramp is normalised
  over the field's own range, so a new field is a new range; leaving the old
  colours would show the previous position's relief over this position's ground —
  the half-swapped scene this demo has twice had to engineer away.
- **It has no entry in the `layer-order.ts` ladder (returns 0).** It re-colours
  the ground plane in place rather than adding a surface above it, so there is
  nothing to lift; a lifted copy would z-fight with the plane it replaces.
- **`main.ts` applies it unconditionally, ahead of the mesh layers.** It
  describes the ground plane, which exists whether or not any mesh layer is on —
  behind `wantsMeshLayers` it would vanish when the user switched everything else
  off, which is when a diagnostic is most likely to be wanted.
- **DEC-R2-1 is not violated.** That decision rejected a hypsometric ramp as the
  _primary_ look and said nothing about a debug view; the layer defaults to off
  and the e2e asserts it can be switched back off again.
