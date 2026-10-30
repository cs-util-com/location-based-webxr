# editor3d-editing.ts

## Purpose

Editing in the 3D view: the gizmo on the selection (`editor3d-gizmo.ts`)
and the pointer, touch and keys (`editor3d-input.ts`), wired to the
scene's camera, its ground and its tour layer. It builds the world the
pure gesture maths reads (`GestureWorld`).

## Public API

- `createSceneEditing(deps)` -> the editing, until `dispose`:
  - `deps` - the view's box and canvas, the scene, the camera and its
    `view: EditingCamera`, the tour layer, the editor terrain,
    `worldFromEcef` and `ecefFromWorld` (read live: the globe's world
    frame moves), `layerToWorld?` (the layer's frame to the world, read
    live; the identity when absent), the geoid's N, `tour()` (the tour as
    drawn), `page` (the input's page: the store's dispatch and selection,
    and the page's edits), `frame(selection)`, and the globe's optional
    `stepCamera`, `zoomTowards` and `clickPx` (passed to the input).
  - `update()` - each frame before the drawing: the input's retries, then
    the gizmo on the selection (from the tour, or from a gesture's preview
    while one runs).
  - `cancel()` - a gesture under way ends unwritten.
  - `gesture()` - the handle of the gesture under way (`"key"` for a
    held key) or null; the globe holds its frame still meanwhile.
  - `groundUnder(pointer)` - the sampled ground under a pointer, or why
    none (the globe's double-click zoom).
  - `centre()` - the place the view looks at (`view.lookAt()`) with
    the ground's ellipsoidal height there, or the centre's own height
    plus the geoid's N where no ground has loaded (the tree's "+").
  - `turn(selection, deg)` - the selection turned `deg` clockwise about
    up where it stands (`turnedGeo`), written as one gesture edit through
    the page (a locked station's is refused there); false for one with
    no pose here (a code).
  - `groundAt(place)` - the ground's ellipsoidal height at a place
    (`world.groundAt`), null where none has loaded.
  - `screenOf(selection)`, `handleScreen("middle" | "knob" | "dot")`,
    `handleSizes()` - for the page's checks: CSS px on the canvas.
  - `dispose()`.
- Types `GizmoPart`, `EditingCamera` (`lock(on)`, the optional
  `takesTwoFingers`, `twoFingerStart()`, `twoFinger(mode, last, now, world)`, `lookAt()`); `takesTwoFingers` reaches the input as
  `cameraTakesTwoFingers`.
- `orbitEditingCamera({ controls, camera, endFlight, dropMomentum })` - the
  OrbitControls view's `EditingCamera`; it turns OrbitControls' two-finger
  touch off at once. The globe view's (in `editor3d-globe.ts`) leases the
  globe's controls for a handle drag and takes two fingers itself
  (`takesTwoFingers`): the globe's controls pinch, twist and tilt.
- `SceneEditingDeps.models` - the store's selection, model focus and
  model pick, and the page's model edit (true: written).
- The selected model's parts are drawn by `editor3d-model-parts.ts`; a
  disc's click toggles its note's focus.
- While a pick waits on a selected model (`clickWaited`), a click answers
  it (`answerClick`): the ray on the drawn model gives the spot
  (`noteSpotOf` / `sectionSpotOf`), the edit is written, the wait
  cleared and the new or placed part focused; a miss says
  `MISSED_MODEL`; a refused edit keeps the wait. A click while the
  model is not drawn this moment (its file loading again after an edit
  of its pose or size) is held and answered on the first frame it is
  drawn again (`heldClickNext`): dropped when the selection or the wait
  changed, said missed after `HELD_CLICK_MS`. A model without a size is
  never drawn here, so a click on one is said missed at once.
- `modelParts()` and `modelScreenOf(id, at)` - for the page's checks.

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
  handle, two fingers) goes to `view.lock(true)`: the orbit's ends a
  running flight and drops the coast before it turns OrbitControls' input
  off; the globe's leases its controls off. Nothing moves the object under
  a pointer that holds still.
- **The world's frame may move** between frames (the globe's follows the
  camera): the ECEF matrices and `layerToWorld` are references read at
  each use, never copied. The level plane (`planeUnder`) and the pick's
  horizontal distance take the world's y as up, exact in the orbit's frame
  and close to it near the globe's frame target.
- The gizmo's sprite size reads `camera.fov`.
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
  view: orbitEditingCamera({ controls, camera, endFlight, dropMomentum }),
  layer,
  ground,
  worldFromEcef: ground.worldFromEcef,
  ecefFromWorld,
  undulationAt,
  tour,
  page,
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
waiting), the gizmo's on-screen sizes at four window sizes; on the
globe, `editor3d-globe.spec.js` drags a station's middle handle (one
edit, the camera and the world frame held still). The two-finger twist's direction
and the pan on a real tablet are not covered by any test.

The lock's parts are tested where they live (`gizmo-maths`, `gesture`, `editor3d-input`); the page's e2e (`editor3d-edit.spec.js`) checks the gizmo and the keys of a locked and an unlocked station.
