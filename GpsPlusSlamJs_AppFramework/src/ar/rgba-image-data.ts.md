# rgba-image-data

## Purpose

The single implementation (DEC-H3) of "wrap an RGBA frame in `ImageData`, adopting the array when possible and copying only when necessary". Used by the JPEG encoder (`camera-blit-capture.ts` `rgbaImageToJpegBlob`) and the QR front end's default conversion (`qr/qr-frontend.ts`).

## Public API

- **`rgbaToImageData({ data, width, height }): ImageData`** - adopts `data` when it is plain-`ArrayBuffer`-backed; copies it into a fresh plain buffer otherwise (a `SharedArrayBuffer` view, which `ImageData` rejects).
- **`RgbaPixels`** - the structural input type (`RgbaImage` and `RgbaFrame` both satisfy it).

## Invariants & assumptions

- **Adopting means sharing:** the returned `ImageData` and the frame share memory; callers must not mutate the frame afterwards. Frames from `captureToRgba` are fresh owned copies per capture, and neither consumer mutates them.
- A wrong length is not checked here: `ImageData` throws on it, and `rgbaImageToJpegBlob` checks first to give a clearer message.
- No imports, so the lightweight QR front end does not pull in three.js.

## Tests

`rgba-image-data.test.ts` (adopt vs copy, with an `ImageData` stub - Node has none); behaviour through its callers in `qr/qr-frontend.test.ts` and `camera-blit-capture.test.ts`.
