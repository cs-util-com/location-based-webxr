# picture-decode.ts

## Purpose

How the picture world parts read an image, in one place: `world.ts` (framed,
cut-out) and `viewpoint-world.ts` (the viewpoint views).

## Public API

- `decodePicture(blob)`: the tour's capped decode (`TOUR_MAX_IMAGE_PIXELS`)
  at half size, as a picture plane's, its colour space sRGB; null when the
  file cannot be shown (the part then rejects its `ready`).
- `pictureAspect(texture)`: height over width; 1 when the image states no
  size (a broken decode never gives a zero or infinite plane).
- `markDrawnAspect(object, aspect)` / `drawnAspect(object)`: the image's
  aspect kept on a drawn viewpoint picture's part object (its `userData`),
  once the image is read, for the editor's field-of-view lines
  (`editor3d-stations.ts`, `viewpoint-frustum.ts`). `drawnAspect` gives null
  before the image is read or for a value that is not a positive finite
  number.

## Tests

Through `world.test.ts` and `viewpoint-world.test.ts` (their fake decodes
give textures of known size; the aspect is checked by the built sizes, and
`viewpoint-world.test.ts` checks the drawn aspect is kept on the part).
