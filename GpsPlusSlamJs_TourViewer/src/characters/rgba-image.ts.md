# rgba-image.ts

**Purpose:** the plain pixel buffer the character cut works on, and an area-averaging resampler, so the cut needs no canvas and runs the same in a Worker and in Node tests.

## Public API

- `RgbaImage { width, height, data: Uint8ClampedArray }`: row-major RGBA, 4 bytes a pixel; structurally the same as `ImageData`, so a decoded picture is used as is.
- `blankImage(w, h)`: a transparent image.
- `drawScaled(src, sx, sy, sw, sh, dst, dx, dy, dw, dh)`: draws a source rectangle into a destination rectangle, averaging the source area each destination pixel covers (premultiplied, so transparent pixels never tint an edge), and composites a partly covered pixel over what `dst` already holds.
- `scaledImage(img, k)`: the whole image scaled by `k`.

## Invariants

- Pure: no DOM, no canvas. This is a deliberate difference from the prototype, which used `drawImage` with `imageSmoothingQuality: "high"`; area averaging is close to that for downscaling (the cut's case) and deterministic across browsers.
- A rectangle partly outside either image is clipped, never written out of bounds.
- A uniform opaque source stays that colour (within rounding) at any scale.

## Tests

`rgba-image.test.ts` (halving averages, transparency does not tint, clipping, compositing); `sheet-cut.property.test.ts` (uniform colour at any scale).
