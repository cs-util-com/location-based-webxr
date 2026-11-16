# haze-veil.ts

## Purpose

The haze veil of the city look: a fixed colour the distance haze fades toward
in place of the sky's own colour in that direction, so the far city can read
bright and bluish while the sky model stays as it is. The veil is stated as
the colour a fully hazed distance SHOWS on screen, CIE L\*, a\* and b\*,
and converted here to the scene-linear colour that the renderer's tone
mapping turns into exactly that, because the haze blends before tone mapping.

## Public API

- `HazeVeil` - `{ lightness, tint, tintA?, riseDeg? }`: L\* (above 0), b\*
  (`tint`) and a\* (`tintA`, absent = 0) on screen, and how far up the sky
  the veil reaches (degrees above the horizon; absent or 0 = the sky keeps
  its colour).
- `veilLightnessBounds(tintA, tint)` - `{ min, max }`, the lightnesses (on
  a 0.1 grid of L\* in (0, 100]) at which the screen can show that colour,
  or `null` when it can show none. See "The cap rule" below.
- `clampHazeVeil(veil)` - the veil with its lightness held inside those
  bounds (its colour and rise kept; returned unchanged when already
  inside). Throws `RangeError` for a colour no lightness can show.
- `VEIL_DELTA_E_TOLERANCE` - 1, the CIE76 Delta E the rule allows between
  the asked colour and its 8-bit colour.
- `HAZE_VEIL_RISE_DEG` - 10, the default rise of the light settings (10
  read better at the horizon than the 4 first shipped).
- `HAZE_VEIL_TINT` - -4, the default tint (the reference's far b\* is about
  -4).
- `neutralToneMap(rgb, exposure)` - a mirror of three's
  `NeutralToneMapping` GLSL (exposure, the 0.04 offset with its toe of
  6.25 x^2 below 0.08, the compression and desaturation above 0.76).
  Display-linear out.
- `veilDisplayLinear(veil)` - the display-linear colour the veil shows: its
  L\*a\*b\* through the nearest 8-bit sRGB colour (`labToRgb` of
  `gps-plus-slam-osm`), linearised. Also the fallback's fog colour.
- `veilSceneColour(veil, exposure)` - the scene-linear colour that
  `neutralToneMap` at `exposure` turns into `veilDisplayLinear(veil)`.
  Throws `RangeError` for a lightness outside (0, 100], a non-finite tint,
  an exposure that is not positive and finite, or a colour the screen
  cannot show (above the knee, or out of gamut; the cap rule).

## The cap rule

A colour is shown when (1) its nearest 8-bit sRGB colour, out-of-gamut
channels clipped, lies within `VEIL_DELTA_E_TOLERANCE` (CIE76 Delta E 1) of
it, so a clipped colour is refused rather than drawn as another one, and
(2) that colour's brightest display-linear channel is below the tone
curve's knee (0.76), where the inverse is exact. For each (a\*, b\*),
`veilLightnessBounds` is the unbroken run of such lightnesses (0.1 grid)
that ends at the brightest one: near black, 8-bit rounding makes Delta E
hover around 1 so isolated dark values can pass, and a run keeps every
value between its ends shown as asked (tested over every slider colour).
The light settings keep the lightness a link states, and `veilOf` holds
the drawn veil at the run's ends; the light dialog says so
(`#light-veil-note`). Upper bounds: neutral 89.7, b\* -4 87.0, b\* -12
81.7, b\* -24 73.9, b\* +20 84.3, b\* +40 80.7; strong yellow cannot be
dark either (b\* +40 starts at L\* 30.2). Results are cached per colour.

What would move it: a tolerance tighter than about 0.8 starts refusing
colours for their 8-bit rounding alone (the old test's worst case was 0.8
per component), so near-black and some saturated lightnesses would leave
the run; a looser one (2 or more) would let a slightly clipped colour pass
as shown. The knee is three's constant and pinned by a test.

## Why L\* and b\*, not a mix factor

The look is tuned against a reference photo whose far field is measured in
L\* and b\*. A slider in those units says
what the screen will show, at any EV, sun and visibility: the scene colour
is derived from the renderer's fixed exposure (`TONE_MAPPING_EXPOSURE`), and
the haze's colour never passes through the sky's auto-exposure. A mix factor
between the sky's colour and a target would make the visible colour depend
on the sky and the EV, so the same number would look different at every sun
and would have to be re-tuned after every EV change. Two sliders, each in
the unit it is measured in, is the shortest path from a measurement to a
setting.

## Invariants & assumptions

- **Exact below the knee.** Neutral subtracts one offset from all three
  channels; the darkest display channel says which branch it took (at or
  above 0.04 the offset is 0.04, below it the toe's `x - 6.25 x^2` with
  `x = sqrt(y / 6.25)`). Above the compression knee (0.76) there is no such
  inverse, so such a veil is refused; the light settings hold the drawn
  lightness at the colour's bound (the cap rule above), the slider itself
  reaching 90 (neutral's bound).
- **Constant across view directions.** The sky's colour varies with the sun's
  azimuth; the veil does not. It is a daytime look tool: at dusk or night a
  bright veil would glow.
- **The sky behind it is unchanged**, so a veil brighter than the sky's
  horizon shows as a step at the skyline.
- 8-bit: below L\* 3 one 8-bit step is worth about 2 of b\*, so a near-black
  veil cannot show its tint closely (it still maps exactly).

## Example

```ts
const veil = { lightness: 76, tint: -4 };
haze.setVeil(veilSceneColour(veil, TONE_MAPPING_EXPOSURE));
```

## Tests

`haze-veil.test.ts`:

- the tone map's three regions against values worked by hand from three's
  GLSL;
- every slider colour (L\* 3 and up, a\* and b\* every second unit,
  exhaustive) is shown within Delta E 1 or held at its bound, and the same
  over the whole half-step grid (property test, fixed seed);
- every slider colour has one unbroken run of showable lightnesses, and one
  step above it is refused; neutral, strong yellow and strong blue bounds;
- the round trip holds at any exposure (property test, fixed seed);
- brighter for more lightness, bluer for a lower tint, redder for a higher
  a\*;
- the refusals, a colour no lightness can show among them.
