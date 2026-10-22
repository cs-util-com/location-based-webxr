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
- `createCodeSquare(sizeM)` -> `THREE.Object3D` named `code`: a white face
  with a dark frame and three finder squares on +z, a plain grey back.

## Invariants & assumptions

- With `sizeAttenuation` off a sprite's scale is its size at 1 m, where
  the view is `2 tan(fov / 2)` tall; the billboard's scale is set from
  that for 34 px.
- The code face's texture is drawn once and shared by every square; it is
  marked `userData.sharedMap`, so freeing a square leaves it.
- A browser without a 2D canvas context still gets a sprite (an empty
  texture), never an error.

## Examples

```ts
const tag = createBillboard(2, "The old gate", true, {
  viewportPx: 900,
  fovDeg: 50,
});
const square = createCodeSquare(0.2);
```

## Tests

No unit test (a canvas is needed; the stations layer's tests hand in
stand-ins). Drawn in `playwright-tests/editor3d.spec.js`, and compared by
eye with the chosen prototype at 1440 x 900 and 1024 x 768.
