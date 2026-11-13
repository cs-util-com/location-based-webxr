# editor3d-lens.ts

## Purpose

The lens "Look from the viewpoint" lends the editor's camera. While it holds,
the camera sees through the viewpoint's horizontal field of view, so the view
frames what the picture's camera framed (the Window's frame, the finder's
corners); released, the camera has its own field of view back.

## Public API

- `verticalFovDeg(hfovDeg, aspect)`: `2 atan(tan(h / 2) / aspect)` in degrees,
  the vertical field three's `PerspectiveCamera.fov` takes. Null for a lens
  outside (0, 180) or an aspect that is not a positive finite number.
- `createLensHold(camera, ownFovDeg)`: a hold over a `LensCamera` (`fov`,
  `aspect`, `updateProjectionMatrix`). Throws `RangeError` for an own field of
  view outside (0, 180).
  - `lookThrough(selection, hfovDeg)`: the lens for the picture `selection`;
    false, and the hold released, for a lens `verticalFovDeg` refuses.
  - `release()`: the own field of view back; a no-op when nothing holds.
  - `selection()`: the picture whose lens holds, or null.
  - `apply()`: each frame, the lens again at the aspect now.

## Invariants

- The horizontal lens is what is kept; the vertical field follows the aspect
  (a resize, the bottom panel opening).
- `release` with nothing held never writes the camera: the globe view's
  arrival eases its own field of view, and a stray release would snap it.
- The camera's projection is updated only when the field changes.

## Who releases it

- The scene view (`editor3d-scene.ts`): the orbit's own gesture (`start`),
  every flight (`fly`, so Frame, Fly to, zoom, Top view, north up), tilt,
  heading and distance, and a selection other than the picture.
- The globe view (`editor3d-globe.ts`): the controls' gesture (`onTake`),
  every aim and pose change, zoom and distance, and a selection other than
  the picture.

## Example

```ts
const lens = createLensHold(camera, EDITOR_CAMERA.fovDeg);
lens.lookThrough("photo-1", 56); // camera.fov = 2 atan(tan 28 deg / aspect)
lens.release(); // camera.fov = 50 again
```

## Tests

`editor3d-lens.test.ts`: the conversion (with a round-trip property), refused
inputs, both directions of the hold, the aspect followed per frame, no write
without a hold. The page check in `playwright-tests/editor3d-pictures.spec.js`
reads `stats().fovDeg` before, during and after looking from a viewpoint.
