# bench-dom.ts

## Purpose

The canvas helpers of the feature matching page, shared by the photo pairs (`feature-match-check.ts`) and the flat target capture (`flat-capture.ts`).

## Public API

- `captureFrame(video, maxLongEdge)`: the current video frame as a `Frame`, shrunk (never enlarged) to at most `maxLongEdge` on its long side. Throws `camera: no 2D canvas`.
- `frameCanvas(frame, canvas?)`: the frame's pixels drawn on `canvas` (a new one when none is given), resized to the frame.
- `blobFrame(blob)`: a stored image (a photo's PNG) decoded back into a `Frame` through `createImageBitmap` with no colour space conversion and no premultiplied alpha, so a PNG of `framePng` gives back its frame. Rejects when the image cannot be decoded or there is no 2D canvas.
- `framePng(frame, label)`: the frame as PNG bytes from the canvas encoder; throws `<label>: PNG encoding failed` on a null blob, and `assertPlainPng` refuses any chunk other than pixel data (no EXIF, text or time).

## Invariants and assumptions

- Browser only (canvas, `ImageData`); no unit test.
- The PNG holds exactly the frame's pixels.

## Example

```ts
const f = captureFrame(video, 1280);
const png = await framePng(f, "frame A");
```

## Tests

Through `playwright-tests/feature-match-check.spec.js`: the run zip's PNGs are read back for their size and chunk list, the reload draws the stored photos again through `blobFrame`, and the flat target zip is read for its entries.
