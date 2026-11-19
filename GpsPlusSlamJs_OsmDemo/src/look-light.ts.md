# look-light.ts

## Purpose

The time-of-day blend's light: each look's own light (its scheme defaults,
the fields the viewer set kept), mixed by the sun's look weights into one
light for the atmosphere rig. Pure; no three.js.

## Public API

- `rigLightOf(settings): LightSetting` - the rig's light for dialog
  settings (exposure, haze, veil, sky balance), the one conversion the view
  and the blend share.
- `lookLightSettings(current, defaults, touched): readonly LightSettings[]` -
  one entry per `TIME_OF_DAY_LOOKS` look: that look's defaults
  (`lightDefaultsFor`), rebased as a scheme switch rebases them
  (`rebaseLightSettings`), so a field in `touched` keeps the viewer's value
  in every look.
- `interface BlendedLight { settings; light }` - the mixed dialog settings
  (what the view holds and the fog reads) and the rig light built from them.
- `blendLookLight(perLook, weights): BlendedLight` - mixes the per-look
  lights. `RangeError`, before any work, for a list that is not one per look,
  a weight that is not finite or is negative, or weights whose sum is not 1
  (within 1e-6).

## Invariants & assumptions

- **Exact at weight 1:** the blend at a look's unit weights is that look's
  own settings and light, so the blend and the fixed scheme agree at their
  shared ends.
- Scalar fields mix linearly, so every mixed field lies between the looks'
  values (the gain ramp stays rising, every value stays in its slider range).
- The veil mixes premultiplied (`blendVeils`, `veil-blend.ts`): a look
  without a veil fades it in by weight instead of shifting its colour.
- The sky balance mixes with a look without one counted as no cast
  `[1, 1, 1]`; it is null only when no weighted look has one. A mix of
  luminance-1 gains keeps luminance 1.
- The haze visibility is rounded to its slider step (1 km) after the mix.
  It is the one light field that rebuilds every sky table (about 31 ms on
  the measured phone against about 17 for a sun-only step); the looks'
  visibilities differ (day 45 km, golden hour 60), so a linear mix sent a
  new one with every sun step of a blend touching golden hour. The other
  fields cost no table rebuild: the exposure is a uniform, the veil a
  uniform, the sky balance a re-bake that rides the sun's own. The rounded
  value stays within the looks' range (both ends are whole kilometres).

## Examples

```ts
const perLook = lookLightSettings(
  dialog.settings,
  dialog.defaults,
  dialog.touched,
);
const { settings, light } = blendLookLight(perLook, selectLookWeights(state));
buildingView.setSunAndLight(sunAnglesAt(instantMs, place), settings, light);
```

## Tests

`look-light.test.ts`: per-look defaults and a kept field, exact at weight 1,
the linear mix, the rounded visibility (a property, and two nearby weights
of the day to golden blend sharing one value; `atmosphere-rig.test.ts` pins
that such a step reaches the sky without a visibility), the veil fade, the sky balance with a look without one, a
property over any weights (rising ramp, veil strength in (0, 1], luminance 1,
every field in the looks' range), the refusals; and source checks that the
view updates the atmosphere once per sun step (`setSunAndLight`,
`finishSunStep`) and that `main.ts` keeps the sun in the store.
