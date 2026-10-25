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
    edits), `endFlight()`, `dropMomentum()` (the orbit's coast spent at
    once), `frame(selection)`.
  - `update()` - each frame before the drawing: the input's retries, then
    the gizmo on the selection (from the tour, or from a gesture's preview
    while one runs).
  - `cancel()` - a gesture under way ends unwritten.
  - `centre()` - the place the view looks at (the orbit's centre) with
    the ground's ellipsoidal height there, or the centre's own height
    plus the geoid's N where no ground has loaded (the tree's "+").
  - `turn(selection, deg)` - the selection turned `deg` clockwise about
    up where it stands (`turnedGeo`), written as one gesture edit through
    the page (a locked station's is refused there); false for one with
    no pose here (a code).
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
- **A locked camera stands still:** `lockCamera(true)` (a press on a
  handle, two fingers) ends a running flight and drops the orbit's coast
  before it turns OrbitControls' input off, so nothing moves the object
  under a pointer that holds still.
- **Two fingers are the editing's:** OrbitControls' two-finger touch is
  turned off (`touches.TWO = null`); one finger and the mouse stay
  OrbitControls'. Tilt changes the polar angle; a pinch scales the
  distance, a twist turns the azimuth, a pan keeps the ground under the
  fingers' midpoint (on the level plane at the orbit's centre); every
  step within the orbit's limits (`clampedPose`).
- `stationLocked(stationId)` (a dependency, the page's view state): a station's target carries `locked`, its layout is not posable, and `handleAt` is asked with `posable`, so a locked station's gizmo is its radius dots alone.

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
saved and undone, every key, a second finger's cancel, the camera held
still from a press during a flight until the release (T and Home
waiting), the gizmo's on-screen sizes at four window sizes. The two-finger twist's direction
and the pan on a real tablet are not covered by any test.

The lock's parts are tested where they live (`gizmo-maths`, `gesture`, `editor3d-input`); the page's e2e (`editor3d-edit.spec.js`) checks the gizmo and the keys of a locked and an unlocked station.
