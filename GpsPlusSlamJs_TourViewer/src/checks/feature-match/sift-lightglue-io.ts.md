# sift-lightglue-io.ts

## Purpose

The pure conversion between sift.js results and the inputs of COLMAP's `sift-lightglue.onnx` (LightGlue trained on SIFT), so the model sees exactly what it was exported for.

## Public API

- `SiftKeypoints`: the sift.js result fields read here (count, positions, scales, orientations, uint8 descriptors).
- `LIGHTGLUE_SIFT_INPUTS`: the model's ten input names in order (keypoints, descriptors, scales and orientations of each image, plus the image sizes).
- `rootSiftFloat(desc, n)`: sift.js already outputs RootSIFT scaled by 512 as uint8; this undoes the quantization with an L2 normalization only (no second square root). An all-zero row stays zero. `RangeError` for a buffer shorter than `n` rows.
- `wrapAngle(a)`: an angle into (-pi, pi], as the model's training data had it; `RangeError` for a non-finite angle.
- `LightGlueSiftFrame` and `lightGlueSiftFrame(r, max, width, height)`: one frame's inputs, cut to the first `max` keypoints (sift.js orders them strongest first), positions kept as they are (pixel centres at integers). Throws naming the field for a missing or short buffer, `RangeError` for a bad `max`.
- `FloatFeed` and `lightGlueSiftFeeds(a, b)`: the ten feeds with batch-1 shapes.

## Invariants and assumptions

- Descriptors are 128 floats per keypoint, every non-zero row unit length and non-negative.
- Every feed's data length is exactly the product of its dims.

## Example

```ts
const fa = lightGlueSiftFrame(siftResultA, 512, w, h);
const fb = lightGlueSiftFrame(siftResultB, 512, w, h);
const feeds = lightGlueSiftFeeds(fa, fb);
```

## Tests

`sift-lightglue-io.test.ts`: the RootSIFT round trip and zero rows, angle wrapping (with properties), positions and the keypoint cut, malformed results, the feed order and shapes (with a property on the data lengths). A known-shift probe in Node (WASM, one thread) matched 139 of 139 correctly for a shift of (13, 7) and 104 of 104 for a 29 deg rotation; raw uint8 descriptors gave 4 matches and shuffled descriptors 0 correct, which is why the normalization matters.
