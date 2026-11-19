# `veil-blend.ts`

## Purpose

The horizon veil of the time-of-day blend: the veils of several colour looks
mixed into the one premultiplied veil the atmosphere draws (`AtmosphereRig`'s
`setVeilBlend` / `setLight`).

## Public API

- `VeilBlend` - `{colour, display, strength, riseDeg}`:
  - `colour` - scene-linear RGB, PREMULTIPLIED by `strength` (what
    `haze.setVeil` and `sky.setHorizonVeil` take);
  - `display` - the same colour as display-linear RGB, premultiplied, for the
    fallback fog;
  - `strength` - in (0, 1]: how much of the veil is drawn;
  - `riseDeg` - how far above the horizon the veil fades out.
- `veilBlendOf(veil, exposure) -> VeilBlend | null` - one look's veil at
  strength 1; `null` for a look without one.
- `blendVeils(veils, weights) -> VeilBlend | null` - the mix: colour
  `sum(w_i * s_i * c_i)`, strength `sum(w_i * s_i)` (capped at 1), rise the
  strength-weighted mean; `null` when the strength is 0 (no look with a veil
  carries weight).

## Invariants & assumptions

- PREMULTIPLIED, not normalised: a half mix of a veiled and an unveiled look is
  half the veil, so the sky fades the veil in rather than snapping it on.
- `weights` are look weights (non-negative, normally summing to 1): a
  `RangeError` on a length mismatch or a non-finite or negative weight, before
  anything is computed.
- Every output is finite at every weight, the zero plateaus included.

## Examples

```ts
const veil = blendVeils(
  looks.map((l) => veilBlendOf(l.veil, TONE_MAPPING_EXPOSURE)),
  [0.5, 0.5, 0, 0],
);
atmosphere.setVeilBlend(veil);
```

## Tests

`veil-blend.property.test.ts`: finite outputs, strength and rise ranges over
all normalised weights (zero plateaus included), weight 1 gives the look's own
veil, a half mix premultiplies, the refusals.
