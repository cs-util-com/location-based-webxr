# glb-lod.ts

## Purpose

The renderer's side of a model's saved levels of detail: the levels the
asset shelf wrote into `primitive.extras.lod`
(`editor/asset-shelf/model-lod.ts`, which documents the format), read back
defensively, and the level a frame draws. Pure numbers with no three.js
import; `glb-model.ts` wires it into a loaded scene.

## Public API

- `LodLevel` `{ start, count, error }`: a draw range in the chain's index
  list and its largest deviation as a share of the primitive's box
  diagonal. `SavedLod` `{ indices, levels }`: the chain's accessor and its
  levels, finest first.
- `lodOf(value)`: the levels in a geometry's `userData.lod`, or null when
  there are none or anything is malformed: a non-integer or negative
  accessor, start or count, an empty level, a count that is not a
  triangle list, a non-finite or negative error, an empty level list.
- `levelsFit(levels, indexCount)`: every level inside the loaded chain.
- `pixelsPerUnit(projection, viewportHeight, depth)`: pixels one unit
  covers at `depth` in front of the camera (column-major projection, as
  three.js keeps it; `projection[11] === -1` is a perspective one).
  Orthographic ignores depth. Infinity at or behind the camera.
- `pickLevel(levels, pixelsPerDiagonal, pixelBudget = LOD_PIXEL_BUDGET)`:
  the coarsest level whose deviation in pixels stays within the budget;
  0 (the finest) when none does or the screen size is not a finite
  positive number. It does not rely on the errors rising, so a file whose
  errors are out of order still gets a level within the budget.
- `LOD_PIXEL_BUDGET`: 1 pixel of the drawing buffer.

## Choosing the pixel budget

The three scanned models in `public/prototypes/model-lod-1/` at their
default level (0.25 % of the diagonal), seen by a phone in portrait (65
degree vertical field of view, 2 400 px tall drawing buffer); triangles
drawn at 1 / 3 / 10 / 30 / 100 m, per budget. Measured on a chain of
halvings; the saved chain is now quarters (`model-lod.ts.md`, "Choosing
the chain"), so a frame draws the nearest saved level at or above the one
listed, and the budget's verdict below does not depend on the spacing:

- rock (0.17 m across; levels 7 936, 3 968, 1 984, 992, 496):
  - 0.5 px: 7 936 / 1 984 / 496 / 496 / 496
  - 1 px: 3 968 / 1 984 / 496 / 496 / 496
  - 2 px: 1 984 / 496 / 496 / 496 / 496
  - 4 px: 496 at every distance
- boulder (2.4 m; levels 19 312, 9 656, 4 828, 2 414, 1 206):
  - 0.5 px: 19 312 to 30 m, 2 414 at 100 m
  - 1 px: 19 312 to 10 m, 4 828 at 30 m, 1 206 at 100 m
  - 2 px: 19 312 to 3 m, 9 656 at 10 m, 2 414 at 30 m, 1 206 at 100 m
  - 4 px: 19 312 to 3 m, 4 828 at 10 m, 1 206 beyond
- coast-rock (73 m; levels 8 117, 4 057, 2 029, 1 582): the finest level
  at every budget and distance, because at 100 m it still covers most of
  the screen.

One pixel is the usual screen-space error for geometry that is not
blended between levels: the change between two levels is then under a
pixel and does not read as a pop, while a far model still drops to a
tenth of its triangles. 2 and 4 px save more only at the middle
distances and let a change of level show as a step on a smooth outline.

## Invariants & assumptions

- The errors are relative to the box diagonal of the primitive's float
  positions before quantizing; a quantized file's box, as three.js
  dequantizes it, is the same box within the position budget.
- No hysteresis: a camera standing exactly at a level's threshold can
  switch level between frames, which a sub-pixel budget keeps invisible.

## Tests

`glb-lod.test.ts`: well-formed and malformed `extras.lod`, the fit check,
perspective, orthographic and behind-the-camera screen sizes, the level
by distance and by budget, errors out of order. The wiring into a loaded
model: `glb-model.test.ts`.
