# globe-camera-controls.ts - the camera's controls

- Purpose: the library's `GlobeControls` on the canvas with the clip planes
  fitted from the drawn ground or, in first person, the nearest item
  (globe plan §7.5, F2 plan F2a M4, G1 5), moved out of the globe lab. The
  camera has one owner at a time (the intro, the controls, or nobody after
  `release`); the controls stay enabled throughout.
- Public API: `createGlobeCameraControls(scene, camera, canvas, globe,
{ onTake, reliefPlanes?, eyeItems?, createControls? })` returns:
  - `fitPlanes()`: near and far from `clipPlanes` (with `reliefPlanes()`) or
    `eyeClipPlanes` (nearest of `eyeItems()`), the projection updated only
    when they change;
  - `followIntro()`: the planes and the controls' up direction, while the
    intro drives;
  - `update()`: the controls, then the planes;
  - `pickFrom(object)`: the controls' scene, swapped only on a change;
  - `limit`, `setAdjustHeight(on)`, `busy()` (pointers, a state, inertia or
    a pending inertia update) and `release()` (drops momentum and zoom).
  - TypeError without `onTake`. `createControls` is the test seam.
- Invariants: the library internals it reads (0.5.3) are typed once, in
  `ControlsInternals`. First person sets the eye's camera radius at once.
- Tests: `globe-camera-controls.test.ts` (setup and `onTake`, the planes and
  the projection count, the globe's frame, first person, the intro, the
  update order, `pickFrom`, `busy`/`release`, the height switch).
