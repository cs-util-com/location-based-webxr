# editor3d-marks.ts

## Purpose

The 3D editor's drawn marks, browser only (each draws on a canvas): a
station's billboard and a printed code's square.

## Public API

- `createBillboard(number, title, selected, { viewportPx, fovDeg })` ->
  `THREE.Sprite`: a dark pill with the station's number in a blue box
  (amber with an amber edge when selected) and its name (cut at 26
  characters with an ellipsis), drawn over the scene (no depth test),
  anchored at its bottom middle, named `billboard <number>`, about 34 px
  tall on screen at any distance (`sizeAttenuation` off).
- `resizeBillboard(sprite, view)` - the scale again for a new viewport.
- `createCodeFace()` -> `THREE.CanvasTexture`: the code face (a white
  square, a dark frame, three finder squares), drawn once per 3D view and
  disposed by that view.
- `createCodeSquare(sizeM, faceTexture)` -> `THREE.Object3D` named `code`:
  `faceTexture` on +z, a plain grey back.

## Invariants & assumptions

- With `sizeAttenuation` off a sprite's scale is its size at 1 m, where
  the view is `2 tan(fov / 2)` tall; the billboard's scale is set from
  that for 34 px.
- The code face's texture is shared by every square of one view; it is
  marked `userData.sharedMap`, so freeing a square leaves it, and the view
  that made it disposes it. It is never module-wide: a texture kept across
  views holds on to every renderer that drew it, and with each renderer
  its WebGL context, so switching to 3D and back a dozen times ran out of
  contexts.
- A browser without a 2D canvas context still gets a sprite (an empty
  texture), never an error.

## Examples

```ts
const tag = createBillboard(2, "The old gate", true, {
  viewportPx: 900,
  fovDeg: 50,
});
const face = createCodeFace();
const square = createCodeSquare(0.2, face);
// with the view
face.dispose();
```

## Tests

No unit test (a canvas is needed; the stations layer's tests hand in
stand-ins). Drawn in `playwright-tests/editor3d.spec.js`, and compared by
eye with the chosen prototype at 1440 x 900 and 1024 x 768.
