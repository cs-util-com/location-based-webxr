# sheet-align.ts

**Purpose:** turns the four found poses into four frames of one size (`cellW` x `cellH`), standing on one baseline at one scale, and lays frames out as one sheet.

## Public API

- `alignFrames(cut, w, h, runs, s): { frames, scale }`.
  - Each pose is centred on its leg anchor: the median figure column in its bottom quarter, so a raised arm does not shift the body.
  - One common scale for all four: the largest that fits the tallest pose in 92 % of the cell height and the widest half-extent in 47 % of the cell width.
  - The feet stand at 96 % of the cell height.
- `composeSheet(frames)`: the frames side by side as one image; throws on no frames or frames of different sizes.

## Invariants

- The four frames share one scale, so poses keep their relative sizes (a smaller pose stays smaller and is warned about by the check).
- Uses `drawScaled` from `rgba-image.ts`; pure.

## Tests

`sheet-align.test.ts` (four frames of the cell size, a common baseline, the fit limit reached in height or width, `composeSheet` layout and refusals).
