# xfeat-decode.ts

## Purpose

Host-side pre- and post-processing of the XFeat LiteRT model: the grey input, and keypoints with descriptors from its three dense output maps.

## Public API

- `xfeatInputSize(shape)`: the input size of a `[1, H, W, 1]` or `[1, 1, H, W]` shape; throws `unexpected XFeat input shape` otherwise.
- `xfeatInput(gray, fw, fh, W, H)`: the frame fitted (never enlarged) into the top-left of a `W x H` image, normalized to zero mean and unit variance over the frame, padding 0; returns `{ data, validWidth, validHeight, scale }`.
- `DenseMap` and `denseMap(data, shape, channels)`: a map with its layout (NCHW or NHWC) found by where `channels` sits; throws when no axis has that count.
- `halfToFloat(bits)`: an IEEE 754 half as a number.
- `decodeXFeat(feats, logits, reliability, { topK, threshold, validWidth, validHeight })`: per 8 x 8 cell a softmax over 65 logits with the last (no keypoint) dropped, channel c at offset (c >> 3, c & 7); 5 x 5 non-maximum suppression; threshold on the heat; score = heat x reliability; the best `topK`; descriptors sampled bilinearly from the 64-channel map and L2-normalized. Keypoints in the padding are dropped.

## Invariants

- The model's input is fixed (640 x 480 for the pinned export): frame size changes the work of pre- and post-processing, not of the model.

## Tests

`xfeat-decode.test.ts`.
