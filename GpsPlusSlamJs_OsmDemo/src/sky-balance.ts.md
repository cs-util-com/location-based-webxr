# sky-balance.ts

## Purpose

The sky balance: a colour cast on the sky's own light, named in the units
the look is measured in. After sunset the physical sky model reads mauve
(sky band about L* 62, a* +13, b* -3 at the sun 1 degree down), where a
dusk reference shows slate blue (about 63, -3, -16). No exposure, veil or
tint reaches the upper sky; a per-channel gain on its radiance does.

## Public API

- `skyBalanceGain(a, b): Rgb | null`: the linear per-channel gain that casts
  a mid grey toward Lab(50, a, b), scaled to luminance 1 so only the colour
  moves (the auto-exposure and the surfaces' sky light keep their level).
  `null` for (0, 0), no balance. Throws `RangeError` for a non-finite a* or
  b*.

## Invariants & assumptions

- Built on `veilDisplayLinear` (`haze-veil.ts`), so the Lab-to-linear path
  is the veil's own: sRGB D65, 8-bit quantised (a gain step of about 0.5 %,
  far below what shows).
- Every gain the sliders reach (a* -20..20, b* -30..30) has channels of at
  least 0 (tested at the corners in `light-settings.test.ts`), which the
  framework requires.
- The framework applies it before the horizon veil and the half-float
  clamp, in the visible sky AND the environment bake, and the haze takes
  the same gain (`AtmosphereRig.setSkyBalance`).

## Example

```ts
const gain = skyBalanceGain(-12, -8); // about [0.50, 1.12, 1.25]
rig.setSkyBalance(gain);
```

## Tests

`sky-balance.test.ts`: null for (0, 0); luminance 1 and channels at least 0
over the sliders' range (property test); a mid grey through the gain shows
about the a* and b* asked for; non-finite input refused.
