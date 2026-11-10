# decode-picture.ts

**Purpose:** decodes a picture file into RGBA pixels for the cut, with no DOM (works in a Worker).

## Public API

- `notAPicture(file)` (module-internal): null for an `image/*` type, or a PNG, JPEG or WebP name when the type is missing; otherwise a `CutError` "This file is not a picture.".
- `decodePicture(file, s)`: the size its header states checked first (`imageInfoOfBlob` from the framework, then `checkPictureSize`), then `createImageBitmap` with `premultiplyAlpha: "none"` and `colorSpaceConversion: "none"`, the size check again on the decoded bitmap (for a header this does not read), then an `OffscreenCanvas` read.

## Invariants

- Colours are read as stored, so a transparent PNG's alpha and the cut's thresholds see the file's own values.
- A file that does not decode is refused with words ("PNG, JPEG and WebP work"); the bitmap is always closed.
- The size is checked before the picture is decoded: a header stating more than `maxPixels` is refused without a decode, which would allocate the whole bitmap (4 bytes a pixel) on the strength of that number.

## Tests

`decode-picture.test.ts` stubs `createImageBitmap` and checks that a header over the cap is refused before any decode, swept over caps of 12 to 40 MP, and the cut's own cap (24 MP refused, 4096 x 4096 decoded). The decode itself is exercised by the maker page's browser tests. `notAPicture` is pure and reached through `decodePicture`.
