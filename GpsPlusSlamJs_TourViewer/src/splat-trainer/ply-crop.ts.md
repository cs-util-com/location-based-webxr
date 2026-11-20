# ply-crop.ts

## Purpose

Reads the positions and opacities of a splat PLY as Splat.js exports it
(binary little-endian, float properties) and writes a copy holding only
the splats a mask keeps: the shell crop's last step.

## Public API

- `PlyView` - `{ count, stride, headerBytes, header, positions, opacities }`;
  `opacities` are the stored logits passed through a sigmoid (0..1).
- `readPly(bytes) -> PlyView` - throws for a file that is not a splat
  file, not binary little-endian, has a property that is not a float, has
  no `z`, or is shorter than its header says.
- `cropPly(bytes, keep, view = readPly(bytes)) -> ArrayBuffer` - the
  same header with `element vertex` rewritten to the kept count, then the
  kept rows unchanged; `view` lets a caller that read the file already
  skip the second parse. RangeError when `keep` does not have one entry
  per splat; an Error when the count is written in a form the reader
  accepts but the rewrite cannot match (such as `2e0`), which would
  otherwise leave the old count over fewer rows.
- `opacities` are not read by the crop; the GPU acceptance measure reads
  them.

## Invariants

- Rows are copied byte for byte: every property the trainer does not read
  (scales, rotation, colour terms) survives untouched.

## Tests

`ply-crop.test.ts`: positions and opacities read back, a crop keeping a
subset with its count rewritten, a crop with a given reading, and the
refusals (an unrewritable count among them).
