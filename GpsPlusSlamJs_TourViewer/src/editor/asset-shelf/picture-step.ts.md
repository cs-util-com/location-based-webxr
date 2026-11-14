# picture-step.ts

**Purpose:** the picture step of the asset optimizer's Worker: a dropped picture decoded, shrunk so its longest side fits the settings' limit, and written as WebP.

## Public API

- `GIF_KEPT`: the words a GIF is kept with (a canvas keeps only an animation's first frame).
- `DecodedPicture`: `{ width, height, close() }`.
- `PictureDevice<P>`: `decode(blob)` and `encode(picture, width, height, quality)`; injected so the step's rules are unit-tested.
- `fitWithin(width, height, maxSide)`: the size that fits `maxSide` with the proportions kept; never larger than the picture, no side under 1. Throws for sizes that are no positive whole numbers.
- `optimizePicture(payload, settings, control, device)`: `{ type: "done", blob, extension: "webp", width, height }` or `{ type: "kept", reason: GIF_KEPT }`.
- `PICTURE_DEVICE`: the browser's: `createImageBitmap` with `imageOrientation: "from-image"` (a phone photo stands the way it was taken), a resize with `resizeQuality: "high"`, `OffscreenCanvas.convertToBlob` as `image/webp` at `settings.picture.quality`.

## Invariants

- A GIF (sniffed by its "GIF8" bytes, not its name) is kept without being decoded.
- A picture already within the limit is still re-encoded at its own size; the runner (`asset-shelf.ts`) judges whether the result is smaller enough.
- A browser that writes another format when asked for WebP fails the job ("this browser cannot write WebP pictures"), so no PNG named `.webp` reaches the tour.
- The decoded picture is closed on every path (done, failure, stop); a stop after decoding throws before encoding.
- Bytes that are no picture fail with words ("it could not be read as a picture").

## Tests

- `picture-step.test.ts`: the size and quality asked of the device, never enlarging, GIF kept, the WebP check, unreadable bytes, a payload that is no file, a stop.
- `picture-step.property.test.ts`: `fitWithin` over random sizes and limits.
- The real device runs in the shelf's optimizer e2e (`playwright-tests/editor-asset-optimizers.spec.js`).
