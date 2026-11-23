# bench-image.ts

## Purpose

The benchmark's image type and the resizing helpers every method shares.

## Public API

- `Frame { width, height, rgba }`; `makeFrame(w, h, rgba)` validates size and buffer length.
- `sizeForLongEdge(w, h, longEdge, multiple = 1)`: the size with that long edge, aspect kept, both sides rounded to the nearest `multiple` (at least one). Throws `RangeError` on a non-positive or non-finite argument.
- `fitInside(w, h, maxW, maxH)`: the largest same-aspect size inside the box, never enlarged, with its `scale`.
- `toFramePoint(v, fromSize, toSize)`: a coordinate mapped between two sizes of one image, pixel centres at integers.
- `PREVIEW_EDGE` (320) and `previewFrame(frame)`: the small copy of a photo the views draw, at most `PREVIEW_EDGE` on its long side, never enlarged, at least 1 x 1.
- `resizeFrame(frame, w, h)`: halving (rounded down) while the target is under half the size, each output pixel the average of the source area it covers, then bilinear. On an even side a halving is exactly the 2 x 2 block average, rounded half up, as before; on an odd side the footprint is a little over 2 pixels, so the last column or row is spread over the others instead of dropped. Every step keeps the frame's edges in place, so `toFramePoint` maps a point between the sizes exactly, odd sizes included.
- `toGray(frame)`: Rec. 601 luma as Float32 in 0..1.
- `greyStats(frame)`: `{ mean, sd }` of the grey values in 0..255 (population standard deviation).
- `describeGrey(stats)`: `grey mean 107.3 sd 46.0 (0-255)`.
- `turnQuarter(frame)`: the frame turned a quarter turn clockwise (width and height swap): turned pixel `(xr, yr)` is source pixel `(yr, H - 1 - xr)`.
- `fromQuarterTurn(xr, yr, frameHeight)`: a point of the turned frame back in the source frame, `{ x: yr, y: H - 1 - xr }` (exact for sub-pixel points, pixel centres at integers).
- `quarterTurnFits(w, h, boxW, boxH)`: true when the frame and a fixed model input are of opposite orientation (one portrait, the other landscape); false when either is square, since a turn would gain nothing.

## Invariants

- Pure functions; no DOM.
- `resizeFrame` and `toFramePoint` agree: the saved keypoints and the drawn lines are mapped with `toFramePoint`, so a resize that moved the image against it would move every saved point (a dropped odd column once did, by up to 1 px at the far edge).

## Example

```ts
sizeForLongEdge(640, 480, 320, 32); // { width: 320, height: 256 }
```

## Tests

`bench-image.test.ts`: among others, a bright tent's centroid, shrunk and mapped back with `toFramePoint`, lands on its peak for odd and even widths and one to three halvings (property, within 0.35 px; a dropped odd column misses by up to about 1 px), and an even size still gives the exact 2 x 2 averages; `previewFrame` shrinks 1280 x 720 to 320 x 180 and leaves a small frame as it is.
