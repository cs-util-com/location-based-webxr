# cloud-seam.ts - the cloud map's date-line seam

- Purpose: round-3 plan 2026-10-08-2345 §16 and §18. NASA's
  `cloud_combined_8192.tif` does not wrap: its left and right edge columns
  were never made to match (measured: the wrap pair differs by 11.0 grey
  levels on average and 197 at most, against 6.4 and 100 for a typical
  neighbouring pair), so the globe drew a line down the date line.
  `scripts/fetch-globe-assets.mjs` eases the seam before it cuts the map,
  and `globe-sources.test.ts` judges the committed pieces with the same
  measure.
- Public API:
  - `blendWrapSeam(grey, width, height, columns)` - a copy of a one-channel
    row-major map whose two edge columns become their per-row average; the
    `columns` next to each edge move by the same per-row offset, eased by a
    half cosine to nothing at `columns` in. Values are rounded and clamped
    to 0-255 (a `Uint8Array` would wrap). The input is not changed.
    `RangeError` for sizes that do not match `grey`, a width under 2, or a
    band that is not 1 to `width / 2` whole columns.
  - `columnJump(grey, width, height, left)` - `{ mean, max }`, the mean and
    largest absolute difference between column `left` and the next, over
    every row; the last column is paired with the first (the wrap).
    `RangeError` for a column outside the map.
  - `typicalColumnJump(grey, width, height, away, quantile = 0.5)` - the
    `quantile` of every pair's mean and of every pair's largest jump, over
    the pairs at least `away` columns from both edges (so the seam and its
    bands do not count). `RangeError` when no pair is left or the quantile
    is outside 0-1.
  - `ColumnJump` - the `{ mean, max }` shape.
- Invariants & assumptions: one channel, 8-bit, row-major. The blend keeps
  each row's own detail (it adds an offset ramp, it does not average the
  two sides' content), so the clouds next to the date line stay as sharp
  as elsewhere; the band's rows move independently, which is why a pair of
  ROWS inside the band can differ a little more than before (measured: the
  band's mean vertical jump 10.7 against the source edges' 10.6).
- Measured (2026-10-09, the 8,192 map, encoded as the fetch script does,
  WebP quality 75, and decoded), the blend width swept:
  - none: the wrap 12.4 mean, 189 largest (fails the committed-pieces test);
  - 1 column: the wrap 4.6 / 32, but the next pair carries half the jump
    (8.3 mean, about the map's 99th percentile, 8.7);
  - 2, 4, 8, 16, 32 columns: the wrap 4.2-4.3 / 24-30; the band's worst
    pair 7.5-7.8, a natural pair 7 columns in, present at every width;
    the pieces' bytes within 0.2 % of each other. 16 (the brief's) is kept.
- Examples:

  ```ts
  const eased = blendWrapSeam(grey, 8192, 4096, 16);
  const wrap = columnJump(eased, 8192, 4096, 8191); // { mean: 0, max: 0 }
  const typical = typicalColumnJump(eased, 8192, 4096, 64);
  ```

- Tests: `cloud-seam.test.ts` (the wrap closed at the per-row average, the
  band eased strictly back to the source and nothing outside it touched,
  clamping instead of wrapping, the refusals, a property that no pair
  jumps more than its ramp allows and the wrap always closes, the
  measure's mean, largest, wrap pair, median and quantiles);
  `globe-sources.test.ts` (the committed pieces and preview by this
  measure).
