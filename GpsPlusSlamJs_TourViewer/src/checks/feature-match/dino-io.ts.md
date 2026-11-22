# dino-io.ts

## Purpose

The pure input and output handling of DINOv2-S/14 for the speed test: the ImageNet preprocessing, the CLS token as the global descriptor, and the cosine of two descriptors.

## Public API

- `DINO_CROP` (224; the shortest edge is first resized to 256), `DINO_MEAN`, `DINO_STD` (ImageNet).
- `dinoInput(frame)`: shortest edge to 256, centre crop 224x224, RGB normalized with the mean and std, channels first: always 3 x 224 x 224 floats.
- `clsVector(data, dims)`: token 0 of `[1, tokens, dim]`; throws when the shape and the data disagree.
- `cosine(a, b)`: in [-1, 1], NaN for a zero vector; `RangeError` for different lengths.
- `floatValues(data)`: float32 as is, raw float16 bits (a `Uint16Array`, as q4f16 outputs arrive) widened with `halfToFloat` from `xfeat-decode.ts`; throws for anything else.

## Invariants and assumptions

- The preprocessing follows the model card's processor config (resize to shortest edge 256, crop 224); a different crop would still run but measure a different input size.

## Example

```ts
const x = dinoInput(frame);
const cls = clsVector(floatValues(out.data), out.dims);
```

## Tests

`dino-io.test.ts`: the normalization and the centre crop, a property that any frame size gives the fixed input, the CLS token and a bad shape, the cosine (with a range and symmetry property) and the float16 widening.
