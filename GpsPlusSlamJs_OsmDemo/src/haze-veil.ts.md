# haze-veil.ts

## Purpose

The haze veil of the city look: a fixed colour the distance haze fades toward
in place of the sky's own colour in that direction, so the far city can read
bright and bluish while the sky model stays as it is. The veil is stated as
the colour a fully hazed distance SHOWS on screen, CIE L\* and b\* (a\* 0),
and converted here to the scene-linear colour that the renderer's tone
mapping turns into exactly that, because the haze blends before tone mapping.

## Public API

- `HazeVeil` - `{ lightness, tint }`: L\* (above 0) and b\* on screen.
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
  an exposure that is not positive and finite, or a colour whose brightest
  channel reaches the knee.

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
  inverse, so such a veil is refused; the light settings cap the lightness
  at 80, the brightest value every tint can show (at b\* -12 the last is 81).
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
- every slider value (L\* 3 and up, every tint) shows its L\*, a\* and b\* on
  screen within 0.8, through 8-bit sRGB;
- the round trip holds at any exposure (property test, fixed seed);
- brighter for more lightness, bluer for a lower tint;
- the refusals.
