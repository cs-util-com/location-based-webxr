# v3-roof-shell.js

## Purpose

An inferred roof as a thin sheet with an overhang, in the mesh frame (east, up,
minus north). The overhang and the sheet's edge are the detail a box lacks.

## Public API

- `roofShell({ box, shape, eaveY, riseM, overhangM, thicknessM })`: buffers
  shaped like the library's `MeshData` plus `roofFlags`, 1 per vertex of the
  sheet and 0 per vertex of a gable wall. `box` comes from `fitRectangle`,
  `shape` is `gabled` or `hipped`.

## Invariants and assumptions

- The sheet's top is exactly `eaveY + riseM`. Its underside meets the wall line
  at `eaveY`, so the walls end inside the sheet.
- Every face is wound along its stored normal; the sheet has real undersides.
- A gabled roof closes its ends with gable walls set back at the wall line, so
  the sheet overhangs them. A hip has no gable.
- A square hip closes to a pyramid without degenerate faces.

## Example

```js
const sheet = roofShell({ ...plan, eaveY, overhangM: 0.45, thicknessM: 0.22 });
```

## Tests

`v3-roof-shell.test.mjs`.
