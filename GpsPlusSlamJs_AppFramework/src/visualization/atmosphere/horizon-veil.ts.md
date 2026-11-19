# horizon-veil.ts

## Purpose

The weight with which a haze veil colour covers the sky at a given view
direction: full at and below the horizon, falling off exponentially above it.
It lets the sky near the horizon meet the veiled far ground without a hard
step, while the sky higher up keeps its own colour.

## Public API

- `horizonVeilRise(riseDeg: number): number`
  - The shader's `rise` parameter, `sin(riseDeg)`: the direction's y
    component at which the weight has fallen to 1/e.
  - Throws a `RangeError` when `riseDeg` is not finite or outside 0..90.
- `horizonVeilWeight(dirY: number, rise: number): number`
  - `exp(-max(dirY, 0) / rise)`; 0 when `rise <= 0` (the veil is off).
  - Throws a `RangeError` when either argument is not finite.
  - The CPU twin of the GLSL below; the tests hold the two to one formula.
- `checkedVeilStrength(strength: number, what: string): number`
  - The strength `SkyAtmosphere.setHorizonVeil`, `AtmosphereHaze.setVeil`
    and `AtmosphereHaze.setRim` take: returns it when finite and in
    [0, 1], otherwise throws a `RangeError` naming `what`. Covered through
    those setters' tests.
- `HORIZON_VEIL_GLSL: string`
  - Defines `float atmHorizonVeilWeight(float dirY, float rise)`, the same
    formula, for inclusion in a fragment shader.

## Invariants and assumptions

- `dirY` is the y component of a normalised view direction (y up).
- The weight is in [0, 1], is 1 for every direction at or below the horizon,
  and never rises with the elevation (property test).
- A rise of 0 means "no veil up the sky": the weight is 0 everywhere, so the
  sky looks exactly as it does without this module.

## Examples

```ts
const rise = horizonVeilRise(4); // about 0.07
horizonVeilWeight(0, rise); // 1, at the horizon
horizonVeilWeight(Math.sin((8 * Math.PI) / 180), rise); // about 0.14, at 8 degrees
```

Used by `sky-atmosphere.ts` (`setHorizonVeil`) through `atmosphere-glsl.ts`,
which mixes the visible sky toward the veil colour by this weight before tone
mapping.

## Tests

- `horizon-veil.test.ts`: the formula at fixed points, the refusals, and a
  property test (fixed seed) that the weight is bounded, monotone in the
  elevation and 1 below the horizon.
