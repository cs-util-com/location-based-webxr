# look-driver.ts

## Purpose

The time-of-day blend's rule: which look weights the sun's elevation shows.
Pure and free of three.js; the store's `selectLookWeights` (`osm-store.ts`)
is its only production caller.

## Public API

- `LOOK_KEYFRAMES` - the shipped points, `{ evening, morning }`, each a frozen
  list of `{ elevationDeg, look }` from high to low (`look` indexes
  `TIME_OF_DAY_LOOKS`):
  - evening: day at 9 degrees and above; day to golden hour 9 to 6; golden
    plateau 6 to 2; golden to dusk 2 to 0; dusk plateau 0 to -2; dusk to blue
    hour -2 to -3.5; blue hour below.
  - morning: the same without dusk, so blue hour blends to golden over -3.5
    to 2.
- `lookWeightsAt(elevationDeg, isMorning, keyframes?)` - a frozen list of
  one weight per look: piecewise linear between neighbouring points, the
  first look above the first point, the last below the last. `RangeError`
  for an elevation that is not finite or points `validateKeyframes` refuses.
- `validateKeyframes(points)` - at least one point, finite elevations, looks
  that are indices, elevations from high to low (equal neighbours are a hard
  step); `RangeError` otherwise.
- `isMorningAt(ms, lngDeg)` - apparent solar time before 12:00 at the
  longitude (`apparentSolarTimeHours`).
- `agreementBounds(keyframes?)` - `{ above, below }`: strictly above `above`
  and strictly below `below` the two limbs give the same weights. Shipped:
  `{ above: 2, below: -3.5 }`, and the limbs agree at both edges too.

## Invariants & assumptions

- Weights sum to 1, each in [0, 1], at most two non-zero; the morning never
  shows dusk.
- Each limb is continuous in the elevation (no hard steps in the shipped
  points), so a moving sun never changes the look in one frame.
- The limb flips on solar time, exactly twice a day, never on an elevation
  difference. It is continuous when the noon sun is at least 2 degrees high
  and the midnight sun at most -3.5 degrees low: all year below about
  63 degrees of latitude (90 - 23.44 - 3.5). Across the swept rule (any
  one point of one limb moved by 2 degrees, any blend width halved or
  doubled) that edge lies between 55.56 and 63.06 degrees; the low end comes
  from moving one limb's day point without the other's. Above the edge the
  weights jump at the flip; no place this app targets is there.
- The elevation is the solar model's (`solarPosition`), not corrected for
  refraction; the points were chosen on that scale.

## Examples

```ts
lookWeightsAt(7.5, false); // [0.5, 0.5, 0, 0]: day to golden hour
lookWeightsAt(-0.75, true); // [0, 0.5, 0, 0.5]: a morning, blue to golden
const w = lookWeightsAt(elevationDeg, isMorningAt(ms, lng));
```

## Tests

`look-driver.test.ts`: the shipped points at every edge and blend middle;
refusals; validation; property tests (sum, range, at most two weights,
continuity bounded by the steepest blend) over the swept rule (about 25
variants); the morning never shows dusk; the agreement bounds; the flip
latitude edge across the sweep (shipped 63.06, range 55.56-63.06); the real
solar model at 60 degrees north and south through a year of noons and
midnights without a jump; `isMorningAt` at four longitudes.
