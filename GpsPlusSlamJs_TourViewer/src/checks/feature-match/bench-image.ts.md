# bench-image.ts

## Purpose

The benchmark's image type and the resizing helpers every method shares.

## Public API

- `Frame { width, height, rgba }`; `makeFrame(w, h, rgba)` validates size and buffer length.
- `sizeForLongEdge(w, h, longEdge, multiple = 1)`: the size with that long edge, aspect kept, both sides rounded to the nearest `multiple` (at least one). Throws `RangeError` on a non-positive or non-finite argument.
- `fitInside(w, h, maxW, maxH)`: the largest same-aspect size inside the box, never enlarged, with its `scale`.
- `toFramePoint(v, fromSize, toSize)`: a coordinate mapped between two sizes of one image, pixel centres at integers.
- `resizeFrame(frame, w, h)`: 2 x 2 box halving while the target is under half the size, then bilinear.
- `toGray(frame)`: Rec. 601 luma as Float32 in 0..1.

## Invariants

- Pure functions; no DOM.

## Example

```ts
sizeForLongEdge(640, 480, 320, 32); // { width: 320, height: 256 }
```

## Tests

`bench-image.test.ts`.
