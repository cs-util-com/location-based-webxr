# decode-picture.ts

**Purpose:** decodes a picture file into RGBA pixels for the cut, with no DOM (works in a Worker).

## Public API

- `notAPicture(file)` (module-internal): null for an `image/*` type, or a PNG, JPEG or WebP name when the type is missing; otherwise a `CutError` "This file is not a picture.".
- `decodePicture(file, s)`: `createImageBitmap` with `premultiplyAlpha: "none"` and `colorSpaceConversion: "none"`, the size check (`checkPictureSize`), then an `OffscreenCanvas` read.

## Invariants

- Colours are read as stored, so a transparent PNG's alpha and the cut's thresholds see the file's own values.
- A file that does not decode is refused with words ("PNG, JPEG and WebP work"); the bitmap is always closed.
- The size is checked before the pixels are read into memory.

## Tests

`decodePicture` is the device seam and is not unit-tested (Node has no `createImageBitmap`); it is exercised by the maker page's browser tests. `notAPicture` is pure and reached through `decodePicture`.
