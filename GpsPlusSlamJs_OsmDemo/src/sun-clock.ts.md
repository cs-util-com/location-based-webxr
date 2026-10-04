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
  - `bootElevationDeg` 20 (the afternoon boot, DEC-SUN-13, which replaced
    DEC-SUN-4's 3.5° evening golden hour: the scene opened nearly dark);
  - `fineStepDeg` 1.5 below `fineBelowDeg` 12 (DEC-SUN-7);
  - `coarseStepMs` 30 min above that;
  - `mergeMs` 60 s;
  - `maxDaySearch` 200 days;
  - `minStepMs` 1 s: a step skips stops closer than this;
  - `minYear` 1800 / `maxYear` 2200: the dates accepted.
- `SunPlace` — `{ lat, lng }` (the scene anchor).
- `stopsFor(date, place)` → the ascending stops of one solar date:
  - the elevation-grid crossings on both limbs (−6°, −4.5°, … 12°);
  - the boot crossing (20°), solar noon, and the 30-min clock grid above
    12°;
  - the day's first instant (the lowest sun, under a midnight sun).
  - The day's start and noon are kept only when ≥ −6°; the CROSSINGS are
    kept unfiltered, since they lie on the grid by construction (M2 review
    finding 1: a filter dropped civil dusk on a third of the days). The
    list is empty in polar night.
- `stepSun(ms, place, ±1)` → the next or previous stop at least
  `minStepMs` away, walking over days without one (the night, DEC-SUN-5;
  polar night).
- `bootInstant(date, place, direction?)` → the afternoon sun at 20°
  (DEC-SUN-13). Else:
  - the noon sun (the day never reaches 20°: Cologne in December, 15.6°);
  - else the lowest stop (a sun that never drops to 20°: near the pole in
    June);
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
- `formatSunReadout(ms, place)` → `"15:47 solar time"` (DEC-SUN-8:
  labelled apparent solar time, never the wall clock; no date, which the
  date field beside it shows, plan 2026-09-24-0706).
- `formatSolarClock(ms, place)` → `"15:47"`, the clock alone, in the form
  `parseSolarTime` reads: the light dialog pins it into its Copy link as
  `?time=`. Every minute of a day round-trips through the pin (tested).
- `viewerToday(now: Date)` → the viewer's own calendar date (DEC-SUN-14):
  "today" follows the device, the sun follows the map's place.
- `daySpan(date, place)` → `{ startMs, endMs }`, the time slider's span
  (DEC-SUN-15): civil dawn to civil dusk (the day's first to last stop), the
  whole day under a midnight sun, `null` in polar night.
- `sliderToInstant(fraction, date, place)` / `instantToSlider(ms, place)` →
  the slider's linear-in-time mapping; positions are clamped to [0, 1];
  `RangeError` for a non-finite position. The minute is
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
- **The boot moment is a stop**: the 20° crossing is kept exactly when
  merging would have replaced it.
- **"Today" is the viewer's calendar date** (DEC-SUN-14; it was the solar
  date at the anchor, which showed New York's 23 Sep at 02:00 on the 24th in
  Germany). Everything after that choice is UTC milliseconds plus the
  place's longitude.
- **Polar night** (DEC-SUN-6, interpreted in plan §8) means a day whose
  highest sun stays below −6°; it is skipped, never shown.
- **Cost** (measured by the M2 review): one `stopsFor` is ~30 bisections
  plus 48 clock samples, about 1.1 ms. A walk through a polar night
  evaluates up to 200 days, ~0.2 s, once per key press.

## Examples

```ts
const place = { lat: 50.92, lng: 6.94 };
let t = bootInstant({ year: 2026, month: 9, day: 23 }, place); // 20° afternoon
formatSunReadout(t, place); // "15:47 solar time"
t = sliderToInstant(0.25, { year: 2026, month: 9, day: 23 }, place); // a morning
```

## Tests

`sun-clock.test.ts`:

- **Boot:** the 20° afternoon; noon where the day never reaches 20°
  (Cologne and 67° N in December); the nearest showable day in polar
  night; the lowest sun where it never drops to 20° (89° N in June).
- **Today and the slider:** the viewer's calendar date; the span from
  civil dawn to civil dusk, the whole day under a midnight sun, none in
  polar night; a position round trip and clamping.
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
