# light-settings.ts

## Purpose

The light settings the owner tunes in OsmDemo's light dialog (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-2140-osm-demo-light-settings-dialog-plan.md`):

- the noon surface gain's ramp (maximum, start and full elevation);
- the sky light on buildings;
- the sky's auto-exposure adaptation;
- the EV compensation;
- the haze: the air's visibility and where the haze's boundary fade starts.

The defaults ARE the shipped look, and the values travel in the URL so a
tuned look can be shared and pasted back.

## Public API

- `LightSettings`: `{ gainMax, gainFromDeg, gainFullDeg, buildingSkyLight,
exposureAdaptation, exposureEv, hazeVisibilityKm, hazeStartRatio,
hazeVeilLightness, hazeVeilTint, hazeVeilTintA, hazeVeilRiseDeg }`.
- `DEFAULT_LIGHT_SETTINGS`: built from `NOON_SURFACE_GAIN`,
  `BUILDING_SKY_LIGHT`, `NATURAL_LIGHT_ADAPTATION`,
  `NATURAL_LIGHT_COMPENSATION_EV`, `HAZE_VISIBILITY_KM` and
  `HAZE_START_RATIO` (`atmosphere-rig.ts`), so it cannot drift
  from the shipped constants. Since 2026-09-25 they are the owner's pick
  (DEC-LIGHT-9/10). A link keeps the values it states; a field it leaves out
  means today's default.
- `LIGHT_SETTING_RANGES`: each field's slider min, max and step.
- `parseLightSettings(search, defaults = DEFAULT_LIGHT_SETTINGS)`: from
  `?light=v1:gain=1.8,ev=-2.5` (keyed, versioned pairs; the keys are gain,
  from, full, sky, adapt, ev, vis, haze, veil, tint, tinta, rise, and the
  read-only `vcol` shorthand). Never
  throws. A missing, unknown, non-numeric or out-of-range field falls back to
  its value in `defaults`, a ramp that does not rise falls back to their
  ramp, and another version or a bare list is ignored.
- `serializeLightSettings(settings, defaults = DEFAULT_LIGHT_SETTINGS)`: the
  `?light=` value with only the fields that differ from `defaults`, or
  `null` at them (the URL stays clean). Keyed, so an old link keeps every
  value it states after a new field or new defaults (plan §7); what it
  leaves out follows the defaults.
- **A colour scheme's own light.** `lightDefaultsFor(scheme)` gives the
  defaults a link is read and written against under that scheme: the
  shipped look with the scheme's own values over it, or
  `DEFAULT_LIGHT_SETTINGS` itself for a scheme without any (every scheme
  but urban) and for an unknown name. Urban's are the veil at L* 72 (tint
  -4) and EV -2: its walls were chosen under that light, and it brings the
  far field toward the reference city's haze, at the price of paler far
  accents and a few points less near contrast. 72 is a notch below the
  78 first chosen, which read as foggy weather; measured on the Midtown
  south view at the shipped haze, 72 keeps near contrast 50.9 and far b*
  -4.0, against 49.3 and -4.4 at 78 and 53.1 and -3.2 at 60, with the far
  black level at L* 25.0 (28.2 at 78). So an urban link without
  `veil` or `ev` opens in that light, `veil=0` switches the veil off, and a
  stated `ev` wins. Other schemes, and AR (its own renderer and lighting;
  the veil never reaches its fog), are unchanged.
- `rebaseLightSettings(settings, from, to, touched?)`: the settings moved
  onto another scheme's defaults. A field still at `from`'s value takes
  `to`'s; a field that differs keeps its value, so what a link states it
  still states. A value alone cannot tell a veil switched off on urban (0)
  from `today`'s default of 0, so the light dialog passes the fields the
  viewer set as `touched`, and those keep their value whatever it is.
  The gain ramp stays rising, as in the parser and the dialog: when a kept
  end and a followed end cross, the kept end wins and the followed one
  moves to 1 degree past it; a ramp that crosses with both ends kept (no
  writer produces one) falls back to `to`'s ramp.
- The adaptation's range is 0.5-1: measured, lowering it barely changes
  noon and mostly darkens dawn and dusk (plan §8).
- `describeLightSettings(settings)`: the Copy line, e.g.
  `light: gain 1.8 (20° to 45°), sky light 1.3, adaptation 0.6, EV -2.5,
haze 45 km from 0.66 of the draw distance`.
- **The haze (city look, haze inside the city).** `vis`, the meteorological
  visibility in km (default `HAZE_VISIBILITY_KM` 45, range 9-60 step 1: 9 is
  the hazy end of the reference city's estimate of 9-21 km, 60 the look-dev
  noon preset), and `haze`, where the boundary fade starts as a share of the
  draw distance (default `HAZE_START_RATIO` 0.66, range 0-0.9 step 0.01). A
  link without them keeps today's haze; the shipped look is unchanged.
  `hazeOf(settings)` gives `{ visibilityKm, startRatio }` for
  `AtmosphereRig.setHaze`. What the two mean in the haze shader is in
  `atmosphere-rig.ts.md`.
- **The haze veil (city look, a bright bluish veil).** `veil`, the veil's
  lightness as CIE L* on screen (default 0 = no veil, range 0-90 step 1),
  `tint`, its CIE b* (default `HAZE_VEIL_TINT` -4, range -24..40 step 0.5:
  below 0 bluer, above 0 yellower), and `tinta`, its CIE a* (default 0,
  range -10..10 step 0.5: below 0 greener, above 0 redder; an old link
  without it keeps a* 0, its colour unchanged). At lightness 0 the haze
  keeps the sky's colour exactly, so the shipped default, an old link and a
  link with only a tint all render today's look, except under urban, whose
  own default is a veil (above). Not every colour can be shown at every
  lightness (`haze-veil.ts.md`, "The cap rule"): the settings keep the
  lightness a link states, so it round-trips, and `veilOf(settings)` gives
  `{ lightness, tint, tintA, riseDeg }` for `AtmosphereRig.setHazeVeil`
  with the lightness held at the colour's bound (`clampHazeVeil`), or
  `null` at lightness 0. 90 is neutral's bound (L* 89.7).
  `vcol=rrggbb` or `vcol=rgb` (each digit doubled, as in CSS: `fec` is
  `ffeecc`), a read-only shorthand for a low-resolution colour: an sRGB
  hex read as L*, a* and b*. A stated `veil`, `tint` or `tinta` wins
  over it, a malformed hex (another length, a `#`, a non-hex digit) is
  ignored, and it is never written (the three keys are, so Copy and Reset
  behave as for a slider link). **When the asked colour exceeds the cap**,
  three things hold it, each visible: (1) each of L*, a* and b* is snapped
  to its slider's step and held in its range, so a lightness above 90
  reads as 90 and an a* or b* past its range end is held at that end,
  which changes the hue of a very saturated colour (pure yellow's b* of
  about 93 reads as 40, pure red's a* of about 80 as 10); (2) the drawn
  lightness is held at that colour's bound (the cap rule), so `vcol=fec`
  (L* 94.6, b* 18.6) is kept as L* 90 and drawn at its bound, 84.4;
  (3) the light dialog's note and the Copy line's ` (shown at ...)` say
  so. A colour is never drawn other than the dialog states.
  `rise`, how far up the sky the veil reaches in
  degrees above the horizon (default `HAZE_VEIL_RISE_DEG` 10, range 0-20
  step 0.5, 0 = the sky keeps its own colour; 10 read better at the horizon
  than the 4 first shipped); it matters only while a veil is
  set. Why L* and b* rather than a mix factor toward a colour:
  `haze-veil.ts.md`. The Copy line adds `, veil L* 78 b* -5 up to 10° of sky` only
  when a veil is set, with ` a* 2` when a* is not 0 and ` (shown at 80.7)`
  after the lightness when it is held.
- `gainOf(settings)`: the ramp for `surfaceGainAt(elevationRad, ramp)` in
  `atmosphere-rig.ts`.

## Invariants & assumptions

- A tuning tool: in AR the road materials keep the tuned surface gain (the
  AR shell replaces only the buildings'), so AR is unchanged only at the
  defaults.
- The URL's fields are keyed, so their order does not matter; a new field
  or new defaults leave every value an old link states as it was, with one
  exception in the parser: a stated ramp end that no longer rises against
  a changed default at the other end falls back to the default ramp.
- **Old links (r1158, the #905 review).** A field a link leaves out means
  TODAY's default, not the default of the day the link was copied. The one
  default raised since the light dialog's defaults shipped (2026-09-25,
  four of them at once) is the sky light on buildings, 1.4 -> 3 (r1158), so
  an old link without `sky` now opens at 3. A link copied on the dialog's
  first day (2026-09-24), before those four shipped, reads today's values
  for every field it leaves out in the same way. That is the honest
  reading rather than a slip: r1158 also made the building colours linear,
  so 1.4 no longer renders what it rendered when such a link was copied, and
  pinning old links to 1.4 would only make them darker than either the old
  or the new look. Keeping them would have needed a version per default
  change (`v2:`), machinery with no look left to preserve. A link that set
  `sky` keeps its value (`light-settings.test.ts`).
- Values are rounded to three decimals on the way in and out, so a round
  trip through the URL is exact for any value a slider can produce.

## Example

```ts
const defaults = lightDefaultsFor("urban");
const settings = parseLightSettings(location.search, defaults);
const gain = surfaceGainAt(sunElevationRad, gainOf(settings));
// null at the defaults removes the key; every other key is kept.
writeLight(browserPlaceUrl(window), serializeLightSettings(settings, defaults));
```

## Tests

`light-settings.test.ts`:

- the defaults equal the shipped constants;
- at the defaults the ramp equals today's `surfaceGainAt` at every sun, and
  a changed ramp is followed (a ramp that does not rise throws);
- any valid setting round-trips through the URL (a property test);
- the defaults write nothing and read from nothing;
- bad fields fall back one by one;
- the haze keys are read and written inside their bounds, and any haze
  alone round-trips writing only `vis` and `haze` (a property test);
- the veil keys: read and written inside their bounds (`tinta` too, an old
  link without it at a* 0), out-of-range and non-numeric values ignored,
  `veilOf` null at lightness 0 whatever the tints, a stated lightness kept
  while the drawn one is held at the colour's bound, `vcol` read, overridden
  by a stated key, held in range and never written, and any veil alone
  round-trips writing only `veil` and `tint` (a property test, fixed seed);
- a rebase keeps the gain ramp rising: a kept start or end wins, and any
  rebase of rising ramps rises (a property test, fixed seed);
- the Copy line names every value, and the veil only when one is set.
- a scheme's own light: urban's veil and EV inside the ranges and every
  other scheme at the shipped look; an urban link without the keys read in
  urban's light, a stated value and `veil=0` winning; nothing written at
  urban's defaults; any setting round-tripping against them, and any
  rebase keeping every set field and moving every other (property tests,
  fixed seed); the known limit of a veil switched off and switched back.

`playwright-tests/boot-and-shell.spec.js`, "an urban link without light
keys ...", boots the page: urban's veil and EV from a link that states
nothing (and no `light` key written), `veil=0` switching it off, and a
switch to `today` keeping the set veil and visibility while the EV follows.
