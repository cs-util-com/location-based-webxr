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
  that solar date (its first millisecond: consecutive dates TILE).
- `solarDateAt(ms, lngDeg)` → the solar date an instant falls in: it changes
  exactly where apparent solar time wraps through 00:00 ("today at the
  anchor" for the sun clock).
- `timeAtElevation(date, latDeg, lngDeg, elevationDeg, 'rising' | 'setting')`
  → the instant the sun crosses an elevation on that limb of the solar day,
  or `null` when it never does (midnight sun, polar night, white nights
  without a civil dusk). Bisection to 1 ms.
- `SolarDate` — `{ year, month (1-12), day }`, read as the local apparent
  solar day at a longitude.
- `RangeError` for a non-finite instant or place, a latitude outside ±90°,
  or a date that does not exist (31 Feb, month 13, a fractional or
  unrepresentable year). Years 0-99 are real years (not Date.UTC's
  1900-1999).

## Invariants & assumptions

- **Accuracy, measured** against astronomy-engine (VSOP87 with nutation and
  ΔT) over 67 760 samples (1900-2100, latitudes −66°...80°, every longitude
  and hour): worst angular separation **0.0183°**; the tests bound it at
  0.05° (re-measured by the M1 review over 120 000 samples at ±89.9°:
  ≤ 0.0214° from 1600 to 2200; only dates before ~1000 CE exceed it, from
  ΔT). The sun's disc is 0.53° wide. Event times differ from
  astronomy-engine's own altitude search by ≤ 12 s within ±66° of latitude;
  GRAZING crossings (a slow sun near its daily extreme, high latitudes) can
  reach ~2 min, since time error = angle error ÷ elevation rate.
- GEOMETRIC, on purpose: the sky model is geometric. An AR overlay on the
  real sun would add refraction (up to ~0.57° at the horizon).
- Azimuth is clockwise from north, the frame OsmDemo's `sunDirection`
  expects (−z north), so no conversion sits between them.
- All day and time maths is in UTC milliseconds plus a longitude offset;
  nothing reads the browser's time zone, so the answers are the same on
  every machine. A solar date runs from its `solarMidnight` to the next
  date's: [midnight(d), midnight(d + 1)), apparent solar time 00:00 to 24:00.
- `timeAtElevation` bisects each limb assuming the elevation is monotone.
  It is NEARLY so (the declination drifts): excursions ≤ 2e-4° below 80°,
  ~2e-3° near the pole. An elevation inside such an excursion can return
  `null`; irrelevant for −6° and 3.5° below ~85°.
- "Sunrise" here is GEOMETRIC (the centre at 0°), not the conventional
  refracted −0.833°: 67° N on 21 Dec has civil twilight but no geometric
  sunrise. The sun clock's polar-night rule asks for a day whose highest
  sun reaches −6°, not for a sunrise.
- Deviations from the plan, recorded: no test runs under two `TZ` values
  (nothing here reads the browser's time zone: every value is UTC ms plus a
  longitude offset), and the fixed fixtures are physical anchors rather
  than NOAA-spreadsheet values (they need no published table).
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
- **Edge cases:** `null` for midnight sun, polar night (no civil dawn) and
  Trondheim's white night (a sunset but no civil dusk); 67° N in December
  (civil twilight, no geometric sunrise).
- **Solar dates:** days tile (each starts where the previous ends, and
  `solarDateAt` agrees at both edges), and impossible dates are rejected.
- **Ordering:** dawn < noon < golden hour < dusk (property, with every run
  counted so it cannot pass vacuously).
- **Solar time and validation:** 12:00 at solar noon, solar time within
  [0, 24), and the validation errors above.
