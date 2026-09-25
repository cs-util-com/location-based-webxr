# edge-bands.ts

## Purpose

The `?qrperf` code-size bands (QR near-frontal pose plan 2026-09-23-2314,
§34 R2). Every pixel threshold in the QR pipeline (the motion detector's
3 px turn threshold, the fused window's 1.5 px fit gate, the single-frame
4 px reprojection gate) is absolute; before any becomes size-relative, a
field test must show how each pixel signal grows with the code's size on
screen. This splits the size (the framework's `meanEdgePx`: the corners'
mean edge length) into three bands and keeps percentiles of a signal per
band.

## Public API

- `edgeBand(edgePx)` -> `'small' | 'medium' | 'large' | null`: below 150 px
  small, from 300 px large (lower edge inclusive); null without a finite
  size (the limits are the module's internal `EDGE_BAND_LIMITS_PX`).
- `createBandedPercentiles(window?)` -> `{ add(edgePx, value), summary() }`:
  percentiles per band, `{ n, p50, p95 }` with nulls where a band is empty;
  a null size or a non-finite value is ignored; `window` keeps only the last
  values of each band (the raw pose series' 240), unbounded when omitted.
- `perBand(make)` - one value per band key; `bandsLine(summary)` - the
  report fragment `small p50/p95 (n) | medium ... | large ...`.
- Types: `EdgeBand`, `BandPercentiles`, `Banded<T>`.

## Invariants & assumptions

- The band limits are for reading field data, not thresholds: about 110 px
  is a 16 cm code at 1.2 m, about 375 px the same code at 35 cm on the
  demo's capture (fy ~ 819).
- Percentiles are nearest-rank (`pipeline-timings.ts`), like the rest of
  `?qrperf`.

## Tests

`edge-bands.test.ts`: the band edges (inclusive lower edge), no band without
a finite size, per-band percentiles with an empty band, the per-band window
cap, non-finite values ignored.
