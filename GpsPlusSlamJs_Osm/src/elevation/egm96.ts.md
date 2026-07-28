# `elevation/egm96.ts`

## Purpose

The real geoid model — EGM96 from a vendored 1° global grid — as an **opt-in**
import.

## Public API

- `egm96Geoid(): GeoidModel` — decoded on first call, cached thereafter.
- `egm96-grid.ts` (generated): `EGM96_GRID_BASE64`, `EGM96_GRID_STEP_DEG`,
  `EGM96_GRID_ROWS`, `EGM96_GRID_COLS`.

## Invariants & assumptions

- **NOT re-exported from `elevation/index.ts`.** The grid is ~170 KB of base64,
  so it has its own entry point (`gps-plus-slam-osm/elevation/egm96`) and an app
  that never needs absolute heights never pays for it.
- **Provenance is what makes it trustworthy.** The values come from evaluating
  the EGM96 spherical harmonic series to degree 360 with the reference
  implementation already in this project (`GeoidHeights.cs`, MIT) — not
  hand-assembled, not remembered, not interpolated from something coarser.
  `geoid.ts` originally shipped no data precisely because unverifiable numbers
  are worse than none; that objection is answered here rather than waived.
- **Measured accuracy: mean 0.25 m, max 5.0 m** against 600 exact evaluations at
  random positions. The DEM being corrected has ~30 m posting and the correction
  itself is ~45 m in central Europe, so the residual is an order of magnitude
  below the error it removes. A 2° grid (0.50 m mean, 8.4 m max, a quarter of
  the size) was measured and rejected.
- **A truncated payload throws rather than degrading.** Interpolating smoothly
  over zeros is the silent failure this whole area exists to prevent.
- **`atob` rather than `Buffer`**, so it works unchanged in the browser, in a
  Worker and in Node 16+. The intermediate `Uint8Array` copy is deliberate: the
  string's backing store is not guaranteed to be aligned for an `Int16Array`
  view, and a misaligned view throws.
- Decimetres quantisation is 0.1 m — 40× finer than the interpolation error it
  sits inside, so it costs nothing.

## Examples

```ts
import { egm96Geoid } from "gps-plus-slam-osm/elevation/egm96";
import { toEllipsoidal } from "gps-plus-slam-osm/elevation";

const geoid = egm96Geoid();
const ellipsoidal = toEllipsoidal(demHeightM, position, geoid);
```

## Tests

`egm96.test.ts` — 26 pointwise checks against **exact reference evaluations**
spanning the European high, the North American and Indian Ocean lows, Everest,
Reykjavík, the four equatorial cardinal points and both poles; plus a mean-error
bound (a constant offset would pass every pointwise check and break every
absolute height), a global-range check, antimeridian wrapping, and the
difference from `ZERO_GEOID` at Cologne.

Regenerate the grid with `pnpm run import:geoid-grid --cs <path-to-cs-repo>`
(needs dotnet). The test is the only thing that makes a regenerated grid
trustworthy — run it after.
