# travelling-box-quad.ts

## Purpose

The flight quad of the travelling box: the surface's texture drawn in
screen space while it flies between its plate and the dock, or sits
docked. Each of the 4 corners carries a clip-space position, so a corner
flying from the plate's projected corner to the dock's keeps the texture
mapped in perspective all the way (the quad stays a trapezoid, not a
flattened rectangle). One ordinary mesh of the scene, drawn last over
everything; no second render pass. The clip-space shader ignores the
camera's matrices, so it works for the XR eye's camera too.

## Public API

- `TRAVELLING_BOX_QUAD_ORDER` = 1000: the mesh's `renderOrder`. Module-private.
- `createTravellingBoxQuad(writeCorners)` returns `{ mesh, setMap,
setOpacity, dispose }`.
  - `writeCorners(camera, out)` is called from the mesh's
    `onBeforeRender` with the camera of that render; it fills `out` (16
    floats) with the corners' clip positions (x, y, z, w each) in the
    order top-left, top-right, bottom-left, bottom-right.
  - `setMap(texture | null)`, `setOpacity(opacity)`: the shader's
    uniforms.
  - `dispose()` takes the mesh out of its parent and frees its geometry
    and material.

## Invariants and assumptions

- The mesh is named `travelling-box-quad`, starts invisible, is never
  frustum culled (its corners are written in clip space) and never hit by
  a raycast (`raycast` is a no-op: the controller does its own hit test).
- The material is transparent, with no depth test and no depth write, so
  it lies over the world.
- The fragment shader ends with three.js's colour space chunk, so the
  texture looks the same as on the plate's ordinary material.
- The uvs map the canvas upright: top-left corner to uv (0, 1).

## Examples

```ts
const quad = createTravellingBoxQuad((camera, out) => {
  flightClip(plateClip, dockNdc, easeInOutCubic(u), out);
});
scene.add(quad.mesh);
quad.setMap(texture);
quad.mesh.visible = true;
```

## Tests

- `travelling-box-quad.test.ts`: the corner order, uv and index; drawn
  last, over the world, never culled and never picked; the corners written
  for the render's camera before each draw; the texture, the opacity and
  `dispose`.
- The perspective of the drawn quad is pinned in a browser by
  `playwright-tests/travelling-box-check.spec.js` (non-parallel edges in
  mid-flight).
