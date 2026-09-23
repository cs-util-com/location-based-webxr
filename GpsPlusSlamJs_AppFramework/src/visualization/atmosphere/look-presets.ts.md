# look-presets.ts

## Purpose

Named looks for the atmosphere (dawn, noon, golden hour, blue hour, hazy):
sun angles, visibility, cloud cover and exposure compensation, as validated
data. The set was accepted by the owner in the 2026-09-23 interview.

## Public API

- `LookPreset` — `id`, `label`, `sunElevationDeg`, `sunAzimuthDeg`
  (clockwise from north), `visibilityKm`, `cloudCover` (0…1), `exposureEv`.
- `LOOK_PRESETS` — the five presets, in display order.
- `validateLookPreset(preset)` → a list of problems, each naming its field;
  empty means valid.

## Invariants & assumptions

- Angles use the demos' compass convention (OsmDemo `sun-position.ts`);
  converting them to a direction is the caller's job, so the convention has
  one implementation.
- `exposureEv` is compensation on top of the auto-exposure, within ±8 EV.
- Each preset's numbers keep its name true (blue hour's sun is below the
  horizon, golden hour's is 0–10° up, noon's above 45°, dawn in the east,
  hazy less visible than noon); a test holds them to it.
- Values are starting points chosen by eye; taste rounds are expected to
  move them.

## Examples

```ts
const golden = LOOK_PRESETS.find((p) => p.id === 'golden')!;
atmosphere.setVisibilityKm(golden.visibilityKm);
atmosphere.setExposureCompensation(golden.exposureEv);
```

## Tests

`look-presets.test.ts` — ids, validity, names kept true, each invalid field
named.
