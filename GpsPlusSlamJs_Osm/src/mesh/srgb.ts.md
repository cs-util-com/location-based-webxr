# `mesh/srgb.ts`

## Purpose

The sRGB transfer curve per channel, both directions, for the library's
colours on their way to a renderer that shades in linear light.

## Public API

- `srgbToLinear(v): number` - an sRGB channel (0 to 1) to linear light.
- `linearToSrgb(v): number` - linear light (0 to 1) to an sRGB channel.

## Invariants & assumptions

- The standard piecewise curve (knees at 0.04045 and 0.0031308, exponent
  2.4), the same values `THREE.Color` produces, so the library and three.js
  agree without the package depending on three.
- Inputs are clamped to 0..1; NaN and infinities read as 0, so a bad value
  never reaches a vertex buffer as NaN.
- Used by `barrierColour` (mixing in linear light) and `linearChunkColours`
  (converting building chunks), city objects plan 2026-11-07-2315 section 7.

## Examples

```ts
srgbToLinear(128 / 255); // 0.2158605
linearToSrgb(0.2158605); // 0.50196 (128 / 255)
```

## Tests

`srgb.test.ts` - known values on both sides of the knee, clamping and
non-finite input, and a round-trip and monotonicity property.
