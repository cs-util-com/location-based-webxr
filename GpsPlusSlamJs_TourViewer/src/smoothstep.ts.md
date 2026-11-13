# `smoothstep.ts` - the package's smooth step

## Purpose

The GLSL `smoothstep(edge0, edge1, x)`: 0 at `edge0`, 1 at `edge1`,
`3t^2 - 2t^3` between, clamped outside. The package's one copy.

## Public API

- `smoothstep(edge0, edge1, x) -> number` in [0, 1]. Falling edges
  (`edge0 > edge1`) give a falling step. Equal edges divide by zero:
  callers pass distinct edges.

## Invariants and assumptions

- Lives outside the editor's folders (`editor/`, `editor3d/`) so the
  visitor's pages (the picture cut-out's facing fade) may import it
  without reaching an editor-only module.

## Tests

Through its users: `editor3d/editor3d-visibility` tests (the morph) and
`kinds/picture/world.test.ts` (`cutoutFacingFade`).
