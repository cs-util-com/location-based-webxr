# `elevation/geoid.ts`

## Purpose

Orthometric to ellipsoidal height conversion — and the seam for the geoid
undulation model that makes it possible.

## Public API

- `interface GeoidModel` — `id`, `undulationMetres(position)`
- `ZERO_GEOID` — the identity, and the default
- `constantGeoid(n): GeoidModel`
- `gridGeoid(grid: UndulationGrid): GeoidModel`
- `toEllipsoidal(orthometric, position, geoid)`,
  `toOrthometric(ellipsoidal, position, geoid)`
- `describeGeoid(geoid): string`

## Invariants & assumptions

- **`ellipsoidal = orthometric + N`.** DEMs are orthometric; GNSS and the AR
  session are ellipsoidal. `N` is ~+45 m in central Europe and reaches ±100 m
  globally. Getting the sign backwards is a ~90 m error that looks like a fusion
  bug, not like a bug here — which is why it is in `lessons-learned.md`.
- **NO undulation data ships with this package, deliberately.** The C# reference
  evaluates the EGM96 series to degree 360 from a **5 MB** coefficient table
  (`Algorithms/AltitudeCalculation/Coef.cs`) — reasonable in Unity, unreasonable
  in a browser package with a one-peer dependency budget. Shipping a coarse grid
  we cannot verify would produce exactly this file's worst failure: a smooth,
  confident, entirely wrong offset that no test could catch. An honest seam
  beats fabricated data.
  - **This is the one part of the plan's §7 not built as written**, and the
    reason is recorded here rather than only in a summary doc.
- **`ZERO_GEOID` is the default and is wrong everywhere on Earth.** It is chosen
  only because a library must not silently apply an unverifiable correction.
  `describeGeoid` exists so an app can SHOW which model is active — the
  dangerous state (`ZERO_GEOID` in a build rendering absolute heights) is
  otherwise invisible.
- **`constantGeoid` is the right answer for most apps here.** `N` varies ~1 m per
  100 km in mid-latitudes, so one value is accurate to centimetres across a city
  — two orders of magnitude below the DEM's own ~30 m posting.
- **`gridGeoid` validates shape at construction**, because a values/rows x cols
  mismatch would read zeros off the end and produce a smoothly wrong field.
  Longitude wraps, latitude clamps.

## Examples

```ts
// Look N up once for your area (NGA's EGM96 calculator, or the C#
// GeoidHeights.undulation) and pass it.
const geoid = constantGeoid(47); // central Germany
const ellipsoidal = toEllipsoidal(demHeight, position, geoid);
console.log(describeGeoid(geoid));
```

## Tests

`geoid.test.ts` — conversion direction and round trip, the default applying no
correction and saying so, `constantGeoid` validation, and `gridGeoid`'s corner
values, bilinear interior, shape rejection, degenerate rejection and clamp/wrap
behaviour. There is deliberately no "N at Cologne is 47 m" test: the package
ships no undulation data, so such a test would only assert a number the test
itself supplied.
