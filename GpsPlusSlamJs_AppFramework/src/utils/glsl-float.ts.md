# glsl-float.ts

## Purpose

The framework package's one formatter for TypeScript numbers interpolated
into shader source as GLSL float literals (the occluder depth shade, the
atmosphere).

## Public API

- `glslFloat(value)` → a string with a `.` or an exponent, nine significant
  digits. Throws `RangeError` for NaN or ±Infinity.

## Invariants & assumptions

- GLSL ES has no implicit int → float conversion: `6360` in a float
  expression is a compile error, which three.js only logs while the material
  silently stops drawing.
- Nine significant digits keep small coefficients (5.8e-3/km, 1e-9).
- Unified 2026-09-23 (DEC-H3): `occlusion-mesh.ts` had a private
  `toFixed(4)` copy that rounded anything below 5e-5 to zero and passed NaN
  through. Its constants are all ≥ 1e-2, so its output only changed in
  digits, not value.

## Examples

```ts
`const float ATM_GROUND_RADIUS = ${glslFloat(6360)};`; // "6360.00000"
```

## Tests

`glsl-float.test.ts` — integers, decimals, small values with exponents,
non-finite rejection.
