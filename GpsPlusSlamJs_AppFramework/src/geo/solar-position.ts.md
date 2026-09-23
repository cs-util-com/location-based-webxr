# solar-position.ts

## Purpose

The real sun for a place and an instant (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2149-osm-demo-real-sun-and-twilight-plan.md`,
M1; DEC-SUN-2): the NOAA solar-calculator algorithm (Meeus, "Astronomical
Algorithms", ch. 25, low-precision form). Dependency-free, a few dozen
trigonometric operations per call.

## Public API

- `solarPosition(ms, latDeg, lngDeg)` → `{ elevationRad, azimuthRad }`:
  GEOMETRIC elevation (no refraction) and azimuth clockwise from north,
  [0, 2π).
- `apparentSolarTimeHours(ms, lngDeg)` → local APPARENT solar time, hours in
  [0, 24): 12:00 at solar noon (the clock readout, DEC-SUN-8).
- `solarNoon(date, lngDeg)` / `solarMidnight(date, lngDeg)` → the instants
  of the sun on the meridian, and of the apparent solar midnight that starts
  that solar date.
- `timeAtElevation(date, latDeg, lngDeg, elevationDeg, 'rising' | 'setting')`
  → the instant the sun crosses an elevation on that limb of the solar day,
  or `null` when it never does (midnight sun, polar night, white nights
  without a civil dusk). Bisection to 1 ms.
- `SolarDate` — `{ year, month (1-12), day }`, read as the local apparent
  solar day at a longitude.
- `RangeError` for a non-finite instant or place, a latitude outside ±90°,
  or a non-calendar date.

## Invariants & assumptions

- **Accuracy, measured** against astronomy-engine (VSOP87 with nutation and
  ΔT) over 67 760 samples (1900-2100, latitudes −66°...80°, every longitude
  and hour): worst angular separation **0.0183°**; the tests bound it at
  0.05°. The sun's disc is 0.53° wide. Event times differ from
  astronomy-engine's own altitude search by at most **8.5 s** (bound 60 s).
- GEOMETRIC, on purpose: the sky model is geometric. An AR overlay on the
  real sun would add refraction (up to ~0.57° at the horizon).
- Azimuth is clockwise from north, the frame OsmDemo's `sunDirection`
  expects (−z north), so no conversion sits between them.
- All day and time maths is in UTC milliseconds plus a longitude offset;
  nothing reads the browser's time zone, so the answers are the same on
  every machine. A solar date is centred on its solar noon: [noon − 12 h,
  noon + 12 h].
- Within a solar day the elevation is monotone on each limb (midnight →
  noon, noon → midnight), which is what makes the bisection exact.
- Not in `geo/index.ts` (that barrel feeds the package root's `export *`);
  consumers deep-import `geo/solar-position`.

## Examples

```ts
const date = { year: 2026, month: 9, day: 23 };
const golden = timeAtElevation(date, 50.94, 6.96, 3.5, 'setting'); // ms or null
const { elevationRad, azimuthRad } = solarPosition(golden!, 50.94, 6.96);
const clock = apparentSolarTimeHours(golden!, 6.96); // ≈ 17.6
```

## Tests

`solar-position.test.ts`:

- **Physical anchors** (no library): 90° − latitude at an equinox noon, +23.44°
  at the June solstice, due south at noon, rising in the east and setting
  in the west.
- **Against astronomy-engine:**
  - positions within 0.05° of angular separation (property, 1900-2100);
  - event times within 1 min of its `SearchAltitude` at four places and
    dates.
- **Edge cases:** `null` for midnight sun, polar night and Trondheim's white
  night (a sunset but no civil dusk).
- **Ordering:** dawn < noon < golden hour < dusk (property).
- **Solar time and validation:** 12:00 at solar noon, solar time within
  [0, 24), and the validation errors above.
