# `kinds/picture/framed.ts` - a framed print's look

## Purpose

Builds the `framed` view's look from the chosen picture prototype's
numbers: a dark bevelled frame (extruded with a hole), a dark back, a
painted cream mat, the print, and under the frame a plate with the year,
three lines of the caption and the credit (`picture-paint.ts`, words cut
by `plate.ts`).

## Public API

- `PICTURE_REFERENCE_WIDTH_M = 1.6` - the print width the look is built
  at; the caller scales the root by `widthM / 1.6`.
- `framedSizes(widthM, aspect)` - print, mat, frame, inner and outer sizes
  (m): mat `max(0.05, 0.07 w)`, frame `clamp(0.034 w, 0.03, 0.12)`.
- `buildFramedLook(picture, aspect, words, painters) -> { root, tapTarget }`
  - origin at the print's centre, facing local +Z; the plate hangs 5 cm
    under the frame's foot.

## Invariants and assumptions

- Scaled as one object: the mat, frame and plate text grow with the
  print. The prototype kept them at fixed sizes beyond about 0.9 to 3.5 m;
  uniform scale is what the placement contract asks (a size extent
  doubles the drawing), and at 1.6 m the two are identical.
- No ground shadow (the ground's height under a hanging print is not
  known here) and no arrival animation, unlike the prototype.

## Tests

`world.test.ts` (parts, layout, scale) and the placement contract test.
