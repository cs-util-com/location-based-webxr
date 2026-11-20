# aliked-io.ts

## Purpose

Tensor plumbing of the split ALIKED extractor and LightGlue matcher ONNX models, kept apart from the runtime so it can be unit-tested.

## Public API

- `chwInput(frame)`: RGB in 0..1, channels first (`1 x 3 x H x W`).
- `pickName(names, preferred, index)`: the input or output name to use; the preferred name if present, else the one at `index`; throws when neither exists.
- `stackPair(a, b)`: A then B, the matcher's pair batch; throws `RangeError` for halves of different size.
- `pairsFromMatches(matches0, countB)`: the matcher's per-keypoint index into B (or -1) as flat pairs; works on int32 and int64 output.
- `floatData(data, what)`: float32 data or an error naming the output.

## Tests

`aliked-io.test.ts`.
