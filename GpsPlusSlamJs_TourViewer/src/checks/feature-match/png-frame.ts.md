# png-frame.ts

## Purpose

A stored PNG decoded back into a `Frame`, pixel for pixel: no colour space conversion and no premultiplied alpha, so the PNG of a frame gives back the frame it was made from. It uses `createImageBitmap` and `OffscreenCanvas`, so the page (previews, the speed test) and the measuring worker decode the same way.

## Public API

- `pngFrame(blob)` -> `Promise<Frame>`.

## Invariants and defensive measures

- `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })`: an opaque PNG comes back byte-equal.
- The bitmap is closed on every path.
- Throws "no 2D canvas" when the canvas has no 2D context; rejects when the Blob is not an image.

## Example

```ts
const frame = await pngFrame(await fm.readPhoto(id));
```

## Tests

No unit test: it needs a browser decoder. `playwright-tests/feature-match-check.spec.js` checks the round trip (a frame encoded to PNG and decoded in a module worker is byte-equal).
