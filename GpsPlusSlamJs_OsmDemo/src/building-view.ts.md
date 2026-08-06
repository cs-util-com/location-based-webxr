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
- `TERRAIN_SPACING_M` — 12 m, the Terrarium z13 pixel pitch at this latitude.
- `MeshLayers` and `BuildingStats` — **re-exported from `mesh-layers.ts`**, which
  owns them because it owns what they describe. `BuildingStats` is `volumes`,
  `parts`, `triangles`, `guessedHeights`, `approximateRoofs`, `trees`, `plates`,
  `plateTriangles`.
  (`treeConePosition` was removed in W6: trees are instanced now, and the ENU→
  scene reflection comes from the package's `packInstances`, which is tested where
  it lives.)

## Invariants & assumptions

- **`TERRAIN_EXTENT_M` is imported from `heightfield.ts`, not owned here.** It
  moved on 2026-07-31 because the worker needs the same number (to clip ground
  plates before triangulating) and must not import three. This file uses it for
  the ground plane's size and the terrain grid; there is no re-export, so other
  consumers import it from `heightfield.js` directly.
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
  - **PMREM was ruled out for a reason that has since expired (N1).** The note
    here read _"PMREM-processing the gradient does not rescue it: the texture is
    one pixel wide, which is degenerate for the equirect-to-cube-UV
    projection"_ — and **W14 widened the sky to 256 × 64 the same day**, so it is
    no longer degenerate. A `PMREMGenerator` pass is available again.
    - **Not taken, deferred (DEC-R5-8).** The round-5 notes ask for a
      better-looking ground and the answer is being searched for by prompt rather
      than guessed at; doing the lighting twice is what is being avoided.
    - **If it is picked up, it needs a draws-anything test** — a difference count
      against a materials-off frame, not an assertion that the field was set. The
      outage was invisible to property assertions.
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
  placement rather than a buffer and stays ENU (`+y` north). Since W6 the
  reflection is applied by the package's `packInstances`, the same one
  `cell-mesh.ts` applies by hand.
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

There is no `building-view.test.ts`: its only subject was `treeConePosition`,
and W6 replaced that with assertions over the real instance matrices in
`mesh-layers.test.ts` — a stronger claim, because they go through the draw path
rather than through a helper it happened to call. The class itself needs a
`WebGLRenderer` and
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
- **The heights are SAMPLED FROM THE FIELD, not read back out of the position
  buffer.** This bullet said the opposite until W10; the code's own comment at
  `applyGroundRamp` has been explicit about it for longer. Reading the buffer
  back would only work on the CPU path, since GPU-mode positions stay flat.
- **The colour attribute is WRITTEN INTO, never replaced.** three keys its
  `WebGLBuffer`s off the attribute object and only frees the attributes a
  geometry still holds at dispose time, so replacing it every terrain load
  abandons ~1.9 MB of VRAM per position change — and since the ramp became the
  default (DEC-R5-4) that would be every user, not only someone who opted into a
  diagnostic.
- **`setTerrain` recolours while the ramp is showing.** The ramp is normalised
  over the field's own range, so a new field is a new range; leaving the old
  colours would show the previous position's relief over this position's ground —
  the half-swapped scene this demo has twice had to engineer away.
- **The ground plane FOLLOWS the sampled window, and that is what keeps the GLSL
  offset-free.** `setTerrain` positions the plane at the field's `centreEnu`
  (`groundPositionFor`, exported so `far-field.test.ts` can assert the
  relationship rather than restate it). Two consequences, and both are the
  reason it is done this way:
  - **A plane-local vertex is exactly grid-local**, which is the space the
    height texture is indexed in — so the vertex shader needs no origin-offset
    uniform, and `terrain-texture.ts`'s CPU mirror needs no matching one. The
    plan expected a `uOriginOffsetM` in three places at once; positioning the
    plane removes the question instead of answering it three times.
  - **`heightAt` still speaks the SCENE's frame**, so `setTerrain` and
    `applyGroundRamp` add `centreEnu` back before querying it. Feeding
    plane-local coordinates straight in is precisely the desynchronisation that
    made this worth threading through, and it is silent: each surface stays
    internally smooth while the two part company by the walked distance.
  - **A failed load moves the plane too, and the earlier reasoning for not doing
    so was wrong.** It said moving a flat plane is invisible — true, and beside
    the point: the plane is FINITE. It reaches `TERRAIN_EXTENT_M` from its centre
    and stops, so one left behind during a DEM outage stops covering the user as
    soon as they walk past that, leaving them off the edge of the world with no
    ground at all — and the 5 km re-anchor threshold puts that well inside a
    single anchor. `setTerrain` therefore takes the window centre SEPARATELY from
    the field, because the field is `undefined` in exactly that case. Raised in
    review on #269.
- **It is a GROUND MODE, not a layer (W6, DEC-R5-4).** It used to be
  `terrainDebug` in `ALL_LAYERS`, applied from the layer set in `main.ts`, with a
  bespoke `layer-order.ts` entry returning 0 and a bespoke "greyed out under No
  ground" rule — four special cases for one entry, which is what finally said it
  did not belong there. `ground-mode.ts` owns it now, and `main.ts` drives it
  from `groundShowsRamp(mode)`.
- **DEC-R2-1 is not violated, and the argument changed.** That decision rejected
  a hypsometric ramp as the _primary_ look. It **is** the default appearance now
  (DEC-R5-4, which overrides DEC-R4-5), so what keeps the decision intact is that
  the plain reflective ground stays one click away and the e2e asserts the
  round-trip — not that the ramp is off.

## The underground layer

`renderUnderground(outlines)` draws the excluded features as line segments below
the terrain. The outlines arrive **already in ENU**, packed x,y per point by the
worker.

**The geometry and material are built in [`underground-lines.ts`](./underground-lines.ts.md)**,
not here. This view needs a WebGL context to construct, so anything assembled
inside it can only be checked by an e2e — and an e2e can see that lines appeared
without being able to say whether they are transparent, at the right depth, or
whether a node became a tick rather than nothing. Each of those broke once.

**Cleanup is shared by three callers** — `renderUnderground`, `clearScene` and
`dispose` — through one private helper. These lines live outside `this.group`,
so they escape the group teardown; three copies of the same four lines is how
one of them ends up missing, which is what review on #256 found.

**Why the worker converts.** The ENU frame lives there, as it does for every
other piece of scene geometry, and `recentre` invalidates every ENU coordinate —
so a page-side copy of the frame would go stale exactly when the user moves.

**A FIXED DEPTH, not the feature's real one.** OSM's `layer` is an ordering and
`level` is a storey index; neither is a distance, so deriving metres from them
would be a fabricated elevation. `UNDERGROUND_DEPTH_M` is an honest "this is
underneath".

**Nodes get a vertical tick.** A node has no outline, and "a segment needs two
ends" silently dropped them — from the one view meant to reveal what was
dropped. The corpus fixture's only below-surface feature is exactly such a node,
which is how the gap was found.

**Depth testing is off and `RENDER_ORDER.underground` is above both affordance
layers**, because the lines are drawn below the terrain and would otherwise be
occluded by the very ground they exist to be seen under. The material is also
**transparent**, and that is load-bearing: three draws the opaque list first and
`renderOrder` only sorts within a list, so an opaque line outranked the
affordance slabs in the table while losing to them on screen.
