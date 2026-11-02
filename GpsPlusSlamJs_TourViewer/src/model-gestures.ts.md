# model-gestures.ts

## Purpose

The visitor's gesture rule for a 3D model and the toy's arithmetic: a tap
opens a note or the model's card in every view; a pinch resizes and a drag
moves only a toy that is in hand. Pure functions, no three.js, no DOM.

## Public API

- `modelGestureAction(view, gesture, held)` - `"open"` for a tap in any
  view; `"scale"` for a pinch and `"move"` for a drag only when `view` is
  `"toy"` and the toy is held (its card is open); otherwise `"none"`.
- `TOY_MIN_FACTOR` (0.1), `TOY_MAX_FACTOR` (3), `TOY_MAX_SIZE_M` (50).
- `toyFactorRange(sizeM)` - `{ min, max }` of the factor on the tour's size:
  `min` 0.1, `max` = `min(3, 50 / sizeM)`, never below `min`. Throws
  `RangeError` for a size that is not a positive finite number.
- `toyStartFactor(sizeM)` - 1, or the cap when 1x would already exceed
  50 m.
- `pinchedToyFactor(factor, fromPx, toPx, sizeM)` - the factor times the
  ratio of the two finger distances, clamped to the range. A bad distance
  (zero, negative, not finite) leaves the factor as it was.
- `toyDragMetres({ dxPx, dyPx, heightPx, distanceM, fovYRad, yawRad })` -
  the ground move `[dx, dz]` (world metres) of a screen drag: one pixel is
  `2 d tan(fov/2) / h` metres at the toy's distance; screen right maps to
  the camera's right on the ground, screen up to its forward. Bad input
  gives `[0, 0]`.

## Invariants

- The toy's size is always `sizeM * factor`, within 0.1x-3x and never above
  50 m: the cap is a size, not a factor.
- Ground moves only (y never changes): a toy stays on the ground it was
  placed on.

## Example

```ts
pinchedToyFactor(1, 100, 200, 2); // 2
pinchedToyFactor(1, 100, 1000, 20); // 2.5 (the 50 m cap)
```

## Tests

- `model-gestures.test.ts` - the rule per view, the range and its errors,
  pinch clamping, the drag's direction for several yaws.
- `model-gestures.property.test.ts` - the factor stays in range and the
  toy under 50 m for any size and pinch; a drag's length scales with the
  distance.
