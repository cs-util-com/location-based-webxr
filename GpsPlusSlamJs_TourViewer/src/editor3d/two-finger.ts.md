# two-finger.ts

## Purpose

Two fingers on the 3D view move the camera only (the design's, as in map
apps): side by side, moved up or down together, they tilt it; anything
else pinches (zoom), pans and twists (turns). Pure: `editor3d-input.ts`
feeds the fingers and holds the kind decided. The globe view moves its
camera with its own controls (`EditingCamera.takesTwoFingers`).

## Public API

- `TWO_FINGER` - `{ deadPx: 10, stillPx: 4 }`.
- `twoFingerMode(start, now, deadPx = 10)` -> `"tilt"`, `"map"` or null:
  undecided inside the dead zone, or while one finger moved and the other
  has not yet (pointer events come one finger at a time); a finger that
  went 2.5 dead zones against a still one is a pinch.
- Type `FingerPair` (two fingers' points).

## Invariants & assumptions

- The kind is decided once and kept until the fingers lift (the input
  holds it), so a tilt does not turn into a zoom half way.

## Examples

```ts
twoFingerMode(start, bothUp30px); // "tilt"
twoFingerMode(start, spreadApart); // "map"
```

## Tests

`two-finger.test.ts`: the dead zone and the one-finger wait; tilt, pinch,
pan and twist read the same with a dead zone of 5, 10, 15 and 20 px; the
design's numbers.
