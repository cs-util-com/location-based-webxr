# editor3d-editing.ts

## Purpose

Editing in the 3D view: the gizmo on the selection (`editor3d-gizmo.ts`)
and the pointer, touch and keys (`editor3d-input.ts`), wired to the
scene's camera, its ground and its tour layer. It builds the world the
pure gesture maths reads (`GestureWorld`).

## Public API

- `createSceneEditing(deps)` -> the editing, until `dispose`:
  - `deps` - the view's box and canvas, the scene, the camera and its
    OrbitControls, the tour layer, the editor terrain and the world's
    ECEF frame, the geoid's N, `tour()` (the tour as drawn), `page` (the
    input's page: the store's dispatch and selection, and the page's
    edits), `endFlight()`, `frame(selection)`.
  - `update()` - each frame before the drawing: the input's retries, then
    the gizmo on the selection (from the tour, or from a gesture's preview
    while one runs).
  - `cancel()` - a gesture under way ends unwritten.
  - `screenOf(selection)`, `handleScreen("middle" | "knob" | "dot")`,
    `handleSizes()` - for the page's checks: CSS px on the canvas.
  - `dispose()`.
- Type `GizmoPart`.

## Invariants & assumptions

- **Heights.** The relief's heights are drawn as if ellipsoidal and every
  tour pose is drawn N lower than its file's ellipsoidal height, so the
  ground at a place in the tour's terms is the drawn ground plus N
  (`world.groundAt`), and a pose's world point is its height less N.
- **The ground under a pointer** is the globe's `groundHit` over the
  SAMPLED heights (not the drawn mesh), its misses passed on as they are
  (`not-loaded` is what the gesture waits on).
- A click on nothing the layer picks selects the station whose found
  radius holds the ground under the pointer (the nearest), else nothing.
- An item's gizmo centre is the ground under it (where loaded, else its
  own height); a station's is its point.
- **Two fingers are the editing's:** OrbitControls' two-finger touch is
  turned off (`touches.TWO = null`); one finger and the mouse stay
  OrbitControls'. Tilt changes the polar angle; a pinch scales the
  distance, a twist turns the azimuth, a pan keeps the ground under the
  fingers' midpoint (on the level plane at the orbit's centre); every
  step within the orbit's limits (`clampedPose`).

## Examples

```ts
const editing = createSceneEditing({
  container,
  canvas,
  scene,
  camera,
  controls,
  layer,
  ground,
  ecefFromWorld,
  undulationAt,
  tour,
  page,
  endFlight,
  frame,
});
// in the frame loop, before layer.update and the render:
editing.update();
```

## Tests

No unit test of its own (it needs WebGL, the relief and a canvas): its
parts are tested pure (`gizmo-maths`, `gesture`, `pose-edits`,
`two-finger`, `editor3d-input`, `editor3d-gizmo`, the layer's preview and
pick), and the whole in a browser by
`playwright-tests/editor3d-edit.spec.js` - a mouse drag over the ground
saved and undone, every key, a second finger's cancel, the gizmo's
on-screen sizes at four window sizes. The two-finger twist's direction
and the pan on a real tablet are not covered by any test.
