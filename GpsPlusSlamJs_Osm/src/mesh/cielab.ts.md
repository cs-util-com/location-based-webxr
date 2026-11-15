# `mesh/cielab.ts`

## Purpose

CIE L\*a\*b\* (D65) for the city's sRGB hex colours, both ways, so the building
palette's per-building lightness jitter (`wallJitterL`, `building-palette.ts`)
is stated in perceptual lightness, the unit a colour scheme's value ladder is
designed in.

## Public API

- `Lab` - `{ l, a, b }`: `l` 0-100, `a` and `b` roughly -128..128.
- `rgbToLab(rgb): Lab` - an sRGB hex colour (0..0xffffff) to L\*a\*b\*.
- `labToRgb(lab): Rgb` - the nearest 8-bit sRGB hex colour; channels outside
  the gamut are clamped and NaN reads as 0, so the result is always an
  integer in 0..0xffffff.

## Invariants & assumptions

- The standard conversion: the sRGB curve of `srgb.ts`, the sRGB primaries
  to XYZ (and the inverse matrix back), the CIE 1976 cube-root mapping with
  its linear segment below (6/29)^3, the D65 white (0.95047, 1, 1.08883).
- The round trip is exact on 8-bit colours: `labToRgb(rgbToLab(c)) === c`.
- Not used on any per-frame path: the palette converts once per building
  and only when its jitter is above 0.
- Internal to the package (not exported from the `mesh` barrel).

## Examples

```ts
rgbToLab(0x808080); // { l: 53.59, a: 0, b: 0 }
labToRgb({ l: 53.59, a: 0, b: 0 }); // 0x808080
```

## Tests

- `cielab.test.ts` - published L\*a\*b\* values for white, black, mid grey,
  red and blue; gamut clamping and NaN.
- `cielab.property.test.ts` - the exact round trip over 2000 sRGB colours.
