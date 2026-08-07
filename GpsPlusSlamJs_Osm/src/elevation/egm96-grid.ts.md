# `src/elevation/egm96-grid.ts`

## Purpose

EGM96 geoid undulation as a 1-degree global grid — the table
`geoid.ts`'s `toEllipsoidal` reads to convert orthometric DEM heights into the
ellipsoidal frame a GNSS altitude lives in.

**GENERATED. Do not hand-edit.** Regenerate with `pnpm run import:geoid-grid`
(needs the C# repo and dotnet).

## Public API

- `EGM96_GRID_STEP_DEG` (1), `EGM96_GRID_ROWS` (181), `EGM96_GRID_COLS` (360) —
  the grid's shape, exported so a reader never has to infer it from the payload.
- `EGM96_GRID_BASE64` — the samples, base64-encoded.

## Invariants & assumptions

- **Consumers go through `egm96.ts`, not through these constants.** It owns the
  base64 decode and builds the `UndulationGrid` that `gridGeoid` takes; the
  constants exist so that decode never has to infer the shape.
- **The provenance is the reason it is trustworthy.** The values come from
  evaluating the EGM96 spherical harmonic series to degree 360 with the
  reference implementation already in this project
  (`GpsPlusSlamCs/.../GeoidHeights.cs`, MIT). They are not hand-assembled, not
  interpolated from a coarser source, and not recalled — which matters because a
  plausible-looking wrong geoid is indistinguishable from a correct one until
  someone measures a building in the field.
- **Accuracy is measured, not claimed: mean 0.25 m, max 5.0 m** against 600
  exact evaluations at random positions. The DEM being corrected has ~30 m
  posting and the correction itself is ~45 m in central Europe, so the residual
  is an order of magnitude below the thing it fixes. A 2-degree grid was measured
  (0.50 m mean, 8.4 m max, a quarter of the size) and rejected.
- **Rows run from +90 to -90 and columns from 0 to 359 degrees east.** The
  reader owns the wrap; `geoid.ts` gates longitude wrapping on the grid genuinely
  covering 360 degrees, so a future regional grid cannot silently wrap.
- **It is inert unless a consumer asks for it.** `ElevationProvider` defaults to
  `ZERO_GEOID`, which is correct for a relief-only view and a ~45 m trap for the
  first absolute-height consumer — carried as follow-up F14.

## Examples

// Read through `egm96.ts`, never directly: it owns the base64 decode and the
// `UndulationGrid` shape `gridGeoid` expects.

```ts
const geoid = egm96Geoid();
const ellipsoidal = toEllipsoidal(orthometricM, position, geoid);
```

## Tests

`egm96.test.ts` pins the decode, the grid shape and the sampled values against
the C# evaluator's own output — so the grid is checked against its SOURCE rather
than against itself, which is the only check worth having for generated data.
`geoid.test.ts` covers `gridGeoid`'s interpolation and the longitude wrap it
feeds.

**No sidecar existed until #233's review asked whether the omission was
deliberate.** It was not: the repo's rule has two named exemptions — test files
and pure re-export barrels — and a generated data file is neither.
