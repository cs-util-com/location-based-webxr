# `kinds/picture/picture-alpha.ts` - does a picture have see-through parts

## Purpose

Tells the editor whether a picture can stand as a cut-out's shape. The
picture panel warns when the answer for a cut-out is no; the reader never
asks.

## Public API

- `hasSeeThrough(rgba)` - at least `SEE_THROUGH_SHARE` (1 %) of the
  pixels with an alpha below `SEE_THROUGH_BELOW` (250 of 255). Pure.
- `pictureSeeThrough(blob) -> Promise<boolean | null>` - reads the header
  (`imageInfoOfBlob`): a JPEG is no without a decode; over
  `TOUR_MAX_IMAGE_PIXELS`, unreadable, or a page without
  `createImageBitmap` / `OffscreenCanvas` is null. Otherwise decodes at
  most 128 px on its long side and asks `hasSeeThrough`.

## Invariants and assumptions

- The thresholds keep an encoder's soft edge on an opaque picture and a
  few stray pixels from counting.
- Never decodes before the size check (a decode bomb).

## Tests

`picture-alpha.test.ts` (the pure rule, including a property at the
share's edge); the device seam is not unit-tested.
