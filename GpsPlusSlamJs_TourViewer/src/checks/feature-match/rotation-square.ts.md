# rotation-square.ts

## Purpose

The frames of the synthetic rotation pairs (`F1-T0`, `F1-T90`, `F1-T180` in `scenes.ts`): a photo cut to its centre square and turned clockwise by an exact quarter or half turn. The turn is a pixel copy with no resampling, so the only change between the control and a turned pair is the turn itself. A square is never turned again by the XFeat input rule (`quarterTurnFits` in `bench-image.ts` is false for a square), so every method sees the same turn.

The run zip carries the full F1 and F2 and names the crop and turn in the frames JSON (`run-zip.ts`); the PC side and the on-phone measuring of a later milestone cut the same squares with these functions.

## Public API

- `TurnDegrees`: `0 | 90 | 180`.
- `SquareCrop`: `{ x, y, side }` in the source frame's pixels.
- `centreCrop(width, height)` -> `SquareCrop`: side = the short edge, centred (an odd remainder leaves the extra pixel on the right or bottom). Throws `RangeError` for a size that is not two positive integers.
- `rotationSquare(frame, degrees)` -> `{ frame, crop }`: the centre square of `frame`, turned `degrees` clockwise; pixel (x, y) of the n x n square lands at (n-1-y, x) per quarter turn (`turnQuarter` from `bench-image.ts`). Throws `RangeError` on an empty frame, an RGBA length that does not match the size, or a turn other than 0, 90 or 180.

## Invariants and assumptions

- The output is always square, `crop.side` on each edge, and holds exactly the crop's pixels (a permutation of them).
- Four quarter turns are the identity; a half turn is two quarters.
- Pure: the input frame is never changed.

## Example

```ts
const { frame: b90, crop } = rotationSquare(f2, 90);
// crop: { x: 160, y: 0, side: 480 } for a 640 x 480 frame
```

## Tests

`rotation-square.test.ts`: the centred square, a quarter turn pixel by pixel, a half turn as two quarters and four as the identity, the refused inputs, and two property tests: a square is never turned again by the XFeat input rule at any size, and the crop's pixels are kept for any size and turn.
