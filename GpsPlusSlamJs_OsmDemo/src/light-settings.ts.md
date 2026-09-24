# light-settings.ts

## Purpose

The light settings the owner tunes in OsmDemo's light dialog (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-2140-osm-demo-light-settings-dialog-plan.md`):

- the noon surface gain's ramp (maximum, start and full elevation);
- the sky light on buildings;
- the sky's auto-exposure adaptation;
- the EV compensation.

The defaults ARE the shipped look, and the values travel in the URL so a
tuned look can be shared and pasted back.

## Public API

- `LightSettings`: `{ gainMax, gainFromDeg, gainFullDeg, buildingSkyLight,
exposureAdaptation, exposureEv }`.
- `DEFAULT_LIGHT_SETTINGS`: built from `NOON_SURFACE_GAIN`,
  `AUTO_EXPOSURE.adaptation` and `NATURAL_LIGHT_COMPENSATION_EV`, so it
  cannot drift from the shipped constants; the sky light default is 1.
- `LIGHT_SETTING_RANGES`: each field's slider min, max and step.
- `parseLightSettings(search)`: from `?light=v1:gain=1.8,ev=-2.5` (keyed,
  versioned pairs; the keys are gain, from, full, sky, adapt, ev). Never
  throws. A missing, unknown, non-numeric or out-of-range field falls back to
  its default, a ramp that does not rise falls back to the default ramp, and
  another version or a bare list is ignored.
- `serializeLightSettings(settings)`: the `?light=` value with only the
  fields that differ from the defaults, or `null` for the defaults (the URL
  stays clean). Keyed, so an old link keeps meaning what it said after a new
  field or new defaults (plan §7).
- The adaptation's range is 0.5-1: measured, lowering it barely changes
  noon and mostly darkens dawn and dusk (plan §8).
- `describeLightSettings(settings)`: the Copy line, e.g.
  `light: gain 1.8 (20° to 45°), sky light 1.3, adaptation 0.6, EV -2.5`.
- `gainOf(settings)`: the ramp for `surfaceGainAt(elevationRad, ramp)` in
  `atmosphere-rig.ts`.

## Invariants & assumptions

- The URL's field order is fixed; reordering breaks shared links.
- Values are rounded to three decimals on the way in and out, so a round
  trip through the URL is exact for any value a slider can produce.

## Example

```ts
const settings = parseLightSettings(location.search);
const gain = surfaceGainAt(sunElevationRad, gainOf(settings));
history.replaceState(null, "", `?light=${serializeLightSettings(settings)}`);
```

## Tests

`light-settings.test.ts`:

- the defaults equal the shipped constants;
- at the defaults the ramp equals today's `surfaceGainAt` at every sun, and
  a changed ramp is followed (a ramp that does not rise throws);
- any valid setting round-trips through the URL (a property test);
- the defaults write nothing and read from nothing;
- bad fields fall back one by one;
- the Copy line names every value.
