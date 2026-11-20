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
- `greyStats(frame)`: `{ mean, sd }` of the grey values in 0..255 (population standard deviation).
- `describeGrey(stats)`: `grey mean 107.3 sd 46.0 (0-255)`.
- `turnQuarter(frame)`: the frame turned a quarter turn clockwise (width and height swap): turned pixel `(xr, yr)` is source pixel `(yr, H - 1 - xr)`.
- `fromQuarterTurn(xr, yr, frameHeight)`: a point of the turned frame back in the source frame, `{ x: yr, y: H - 1 - xr }` (exact for sub-pixel points, pixel centres at integers).
- `quarterTurnFits(w, h, boxW, boxH)`: true when the frame and a fixed model input are of opposite orientation (one portrait, the other landscape); false when either is square, since a turn would gain nothing.

## Invariants

- Pure functions; no DOM.

## Example

```ts
sizeForLongEdge(640, 480, 320, 32); // { width: 320, height: 256 }
```

## Tests

`bench-image.test.ts`.
