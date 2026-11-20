# globe-full-screen.ts

- Purpose: the scaffolding every full-screen pass of the Globe needs, in
  one place: a triangle covering the viewport in its own scene and camera,
  a half-float colour target and its resize.
- Public API:
  - `fullScreenPass(material)` -> `{ scene, camera, render(renderer), dispose() }`.
    `render` draws into whatever target the renderer has bound; `dispose`
    frees the geometry only, the material belongs to the caller.
  - `halfFloatTarget()` -> a 1 x 1 `HalfFloatType` render target without a
    depth buffer; the caller sizes it with `fitTarget` each frame.
  - `fitTarget(target, w, h)` -> calls `setSize` only when the size
    differs, so an unchanged size never reallocates.
- Invariants:
  - The triangle's corners are (-1, -1), (3, -1), (-1, 3) in clip space:
    one primitive covers the viewport, so there is no diagonal seam where
    two triangles would meet. The vertex shaders read `position` as clip
    coordinates and ignore the camera's matrices, so the camera only has
    to keep three from culling the mesh (`frustumCulled` is off too).
  - Each pass gets its own scene and camera; nothing is shared between
    passes, so disposing one never touches another.
- Users: `globe-atmosphere.ts` (the space pass) and `globe-ground-sky.ts`
  (the ground sky's composite and its sky target).
- Tests: `globe-full-screen.test.ts` (geometry, culling, camera, resize,
  disposal); `globe-pass-shaders.test.ts` pins the users' shader programs.
