# `sun-clock.ts`

## Purpose

Where the REAL sun is for the map's place and a date, and how the time
control moves it (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2149-osm-demo-real-sun-and-twilight-plan.md`,
M2; owner decisions DEC-SUN-1..8). It replaces the "plausible day" of
`sun-position.ts`'s retired `sunAt` (a fixed 55° noon, no date or place).
Positions come from the framework's `geo/solar-position` (NOAA, geometric).

## Public API

- `SUN_CLOCK` — the rules:
  - `minElevationDeg` −6 (civil twilight, DEC-SUN-1);
  - `bootElevationDeg` 3.5 (the evening golden hour, DEC-SUN-4);
  - `fineStepDeg` 1.5 below `fineBelowDeg` 12 (DEC-SUN-7);
  - `coarseStepMs` 30 min above that;
  - `mergeMs` 60 s;
  - `maxDaySearch` 200 days;
  - `minStepMs` 1 s: a step skips stops closer than this;
  - `minYear` 1800 / `maxYear` 2200: the dates accepted.
- `SunPlace` — `{ lat, lng }` (the scene anchor).
- `stopsFor(date, place)` → the ascending stops of one solar date:
  - the elevation-grid crossings on both limbs (−6°, −4.5°, … 12°);
  - the golden hour, solar noon, and the 30-min clock grid above 12°;
  - the day's first instant (the lowest sun, under a midnight sun).
  - The day's start and noon are kept only when ≥ −6°; the CROSSINGS are
    kept unfiltered, since they lie on the grid by construction (M2 review
    finding 1: a filter dropped civil dusk on a third of the days). The
    list is empty in polar night.
- `stepSun(ms, place, ±1)` → the next or previous stop at least
  `minStepMs` away, walking over days without one (the night, DEC-SUN-5;
  polar night).
- `bootInstant(date, place, direction?)` → the evening golden hour. Else:
  - the highest sun (it never reaches 3.5°);
  - else the lowest stop (a midnight sun that never drops to 3.5°);
  - in polar night, the nearest day with a showable sun, searched in
    `direction` (0: forward first, then back).
- `moveToDate(ms, place, date)` / `relocate(ms, from, to)` → the same phase
  (the same elevation on the same limb) on another date or at another
  place. Where the phase does not exist: the date's NOON if the sun never
  climbs that high (so noon stays noon as autumn days lower it; M2 review
  finding 3, a changed interpretation), else the boot (the lowest sun under
  a midnight sun), snapping through polar night in the direction of travel.
- `sunDateOf(ms, place)` → the solar date at the place.
- `instantAt(date, place, hours)` → the instant the apparent solar clock
  reads `hours`.
- `parseSunDate("YYYY-MM-DD")` / `parseSolarTime("HH:MM")` → the read-only
  `?date=` / `?time=` test pins (and the date input's value), or `null` for
  anything else: 31 Feb, and years outside 1800-2200 (a year typed digit by
  digit passes through 0002).
- `formatSunReadout(ms, place)` → `"17:36 solar time, 23 Sep"` (DEC-SUN-8:
  labelled apparent solar time, never the wall clock). The minute is
  floored with a 1e-6-minute epsilon, so an instant booted at HH:MM reads
  back as HH:MM, not the minute before (M2 review finding 6).

## Invariants & assumptions

- **Forward-then-back is the identity** from every stop, by construction:
  a step is the adjacent stop, and the stop list of a date is deterministic.
  `minStepMs` (1 s) is far below `mergeMs` (60 s), so it never skips an
  adjacent stop.
- **A step always moves**: after a date move or a relocation the instant is
  a fresh bisection that can sit within a millisecond of a stop, and the
  step skips it.
- **Never below −6°**, to the bisection's precision (~4e-6°, the 1 ms
  bisection at ≤ 15°/h): crossings sit on the grid, the other candidates
  are filtered, and days without a stop are walked over.
- **The boot moment is a stop**: the golden hour is kept exactly when
  merging would have replaced it.
- **"Today" is the solar date at the anchor**: nothing reads the browser's
  time zone.
- **Polar night** (DEC-SUN-6, interpreted in plan §8) means a day whose
  highest sun stays below −6°; it is skipped, never shown.
- **Cost** (measured by the M2 review): one `stopsFor` is ~30 bisections
  plus 48 clock samples, about 1.1 ms. A walk through a polar night
  evaluates up to 200 days, ~0.2 s, once per key press.

## Examples

```ts
const place = { lat: 50.92, lng: 6.94 };
let t = bootInstant({ year: 2026, month: 9, day: 23 }, place); // golden hour
t = stepSun(t, place, 1); // the next stop toward dusk
formatSunReadout(t, place); // "17:39 solar time, 23 Sep" (3.0°)
```

## Tests

`sun-clock.test.ts`:

- **Boot:** the golden hour, west of south; noon at 67° N in December;
  the nearest showable day in polar night; the lowest sun under the
  midnight sun.
- **The stop list:** sorted, ≥ −6°, the right date, and fine near the
  horizon (tolerance from the 1-ms bisection) at six places and dates;
  civil dawn and civil dusk on EVERY day of a year at Cologne and Tokyo;
  white nights at Trondheim (no skip, straight into the next day); civil
  dawn to civil dusk, with the boot a stop.
- **Stepping:** forward-then-back is the identity everywhere; a step from
  within a millisecond of a stop skips it; the night skip lands on civil
  dawn and back on civil dusk; a random walk (property) never goes below
  −6°.
- **Keep phase:** across dates; noon stays noon when the new day's sun is
  lower; the lowest sun when it never drops that low; a forward snap
  through polar night; a relocation.
- **Parsing and the readout:** the pins, the year range, and every minute
  of a day read back as itself.
