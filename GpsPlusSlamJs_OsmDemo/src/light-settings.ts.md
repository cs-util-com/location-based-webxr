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
exposureAdaptation, exposureEv, hazeVisibilityKm, hazeStartRatio }`.
- `DEFAULT_LIGHT_SETTINGS`: built from `NOON_SURFACE_GAIN`,
  `BUILDING_SKY_LIGHT`, `NATURAL_LIGHT_ADAPTATION` and
  `NATURAL_LIGHT_COMPENSATION_EV` (`atmosphere-rig.ts`), so it cannot drift
  from the shipped constants. Since 2026-09-25 they are the owner's pick
  (DEC-LIGHT-9/10). A link keeps the values it states; a field it leaves out
  means today's default.
- `LIGHT_SETTING_RANGES`: each field's slider min, max and step.
- `parseLightSettings(search)`: from `?light=v1:gain=1.8,ev=-2.5` (keyed,
  versioned pairs; the keys are gain, from, full, sky, adapt, ev, vis,
  haze). Never
  throws. A missing, unknown, non-numeric or out-of-range field falls back to
  its default, a ramp that does not rise falls back to the default ramp, and
  another version or a bare list is ignored.
- `serializeLightSettings(settings)`: the `?light=` value with only the
  fields that differ from the defaults, or `null` for the defaults (the URL
  stays clean). Keyed, so an old link keeps every value it states after a new
  field or new defaults (plan §7); what it leaves out follows the defaults.
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
const settings = parseLightSettings(location.search);
const gain = surfaceGainAt(sunElevationRad, gainOf(settings));
// null at the defaults removes the key; every other key is kept.
writeLight(browserPlaceUrl(window), serializeLightSettings(settings));
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
- the Copy line names every value.
