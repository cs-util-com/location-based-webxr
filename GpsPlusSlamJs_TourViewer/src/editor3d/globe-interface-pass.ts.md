# globe-interface-pass.ts

## Purpose

Draws the editor's interface on the globe (the stations' billboards,
found-radius rings and poles, the gizmo, the arrival's marks, the model's
section planes) after the air, so the clouds' ground shadow and the haze,
which are composited over the whole frame after the scene, do not darken
it. The ground and the tour's 3D models stay in the scene's own pass and
take the shadow.

## Public API

- `GLOBE_INTERFACE` - `{ layer: 1, names }`: the layer the interface is
  drawn on, and the object names whose whole subtree is the interface
  (`"found-radius"`, `"pole"`, `"code"`, `"approach-marks"`,
  `"model-sections"`).
- `interfaceOverAir(cameraAltitudeM, deckM)` -> boolean: whether the
  interface is drawn over the air this frame, true only while the camera
  is below the cloud deck (false for a non-finite altitude). The cloud and
  haze composites write no depth, so from above the deck an interface
  drawn after them would show through clouds that hide it in the scene's
  pass; there it stays in the scene's pass, under the clouds. The editor
  passes the clouds' shell height (`GLOBE_VIEW_CLOUDS.cloudShellKm`).
- `isInterfacePart(object)` -> boolean: a sprite, or a mesh or line whose
  materials (each of a list, a non-empty list) are all drawn without a
  depth test. A depth-tested or lit mesh (a model, the ground) is not.
- `createGlobeInterfacePass({ renderer, scene, camera, roots, lights })`
  -> `{ lift(active?), draw(), lifted() }`:
  - `lift(active = true)` - before the scene draws: every visible interface object
    under `roots()` (a named root with everything visible under it) is
    moved onto `GLOBE_INTERFACE.layer` alone, its own mask saved, so the
    scene's pass (camera on layer 0) skips it. With `active` false the
    previous frame's objects are put back, nothing is lifted, `lifted()`
    reads 0 and `draw()` draws nothing.
  - `draw()` - after the air: the camera on the interface's layer only,
    the scene drawn again without its background and without updating its
    matrices (the scene's own pass did that this frame), then every
    lifted object's mask, the camera's mask, the background and the
    matrix flag put back, also when the renderer throws.
  - `lifted()` - how many objects the last `lift` moved (for the page's
    checks).
- `lights` are enabled on the interface's layer once, at creation, so a
  lit part (the pole) is not drawn black.

## Invariants & assumptions

- Between frames every object is on its own layers again: the hit tests
  (a click on a billboard, the gizmo's disc) raycast on layer 0.
- A frame that threw between `lift` and `draw` is recovered by the next
  `lift`, which puts the previous objects back first (else it would save
  the lifted masks as their own).
- Hidden objects are neither lifted nor walked. No allocation per frame
  (the saved objects and masks reuse two arrays).
- The renderer's `autoClear` must not clear the colour between the two
  draws: the editor's renderer draws the scene, the air and this pass into
  the same frame (the depth buffer is the scene's, so a pole still hides
  behind a hill).

## Example

```ts
const pass = createGlobeInterfacePass({
  renderer,
  scene,
  camera,
  roots: () => [tourFrame, ...editorRoots],
  lights: [hemisphere],
});
// per frame
pass.lift();
renderer.render(scene, camera);
air.afterScene();
pass.draw();
```

## Tests

- `globe-interface-pass.test.ts` - the rule (sprites and overlays, never a
  depth-tested mesh, a mixed material list is not), the lift and the draw
  seeing exactly the interface and its lights with the matrices frozen,
  every mask put back after the draw, recovery from a frame without a
  draw, hidden objects skipped, no draw when nothing is lifted, and the
  masks restored when the renderer throws; `interfaceOverAir` on both
  sides of the deck (and at it, and for NaN), and an inactive lift that
  puts back and lifts nothing.
- `playwright-tests/editor3d-globe-clouds.spec.js` - pixel probes on the
  real page: a billboard and a ring as bright with the clouds' shadow as
  without it, the ground and a model darkened by the shadow's strength.
  Headless draws no visible cloud shadow, so those ratios are asserted
  only when clouds on and off change the canvas measurably, and logged as
  readings otherwise; that the shadow darkened the interface before this
  pass is from code reading, and the phone check confirms it.
