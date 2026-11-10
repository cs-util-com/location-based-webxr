# `ground-slope-colours.ts`

## Purpose

The slope treatment's four colours (cool and warm aspect ends, isoclines,
grazing rim) as plain LINEAR rgb data, so the colour-scheme table can carry
them without importing three.js (the worker reads that table too). The shader
patch that consumes them is `ground-slope-shader.ts`.

## Public API

- `LinearRgb` - `readonly [r, g, b]`, each in [0, 1].
- `GroundSlopeColours` - `{cool, warm, isoline, rim}`.
- `DEFAULT_GROUND_SLOPE_COLOURS` - the GLSL literals the shader carried before
  the colour schemes (colour schemes plan 2026-11-10-0841 section 4.4), frozen.
- `slopeColourList(colours)` - the four in a fixed order.
- `validateGroundSlopeColours(colours)` - `RangeError` for a triple that is
  not three finite numbers in [0, 1]; returns its input.

## Invariants & assumptions

- Linear, not sRGB hex: the default reproduces the old literals exactly.
- No three.js import, deliberately (worker bundle).

## Examples

```ts
setGroundSlopeColours(
  uniforms,
  validateGroundSlopeColours(scheme.ground.slope),
);
```

## Tests

`ground-slope-shader.test.ts` pins the defaults against the shader's old
literals and the validation through `setGroundSlopeColours`;
`colour-schemes.test.ts` validates every scheme's slope colours.
