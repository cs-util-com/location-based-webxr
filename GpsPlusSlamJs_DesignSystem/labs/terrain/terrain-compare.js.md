# terrain-compare.js: the colour comparison's rows, plan and statistics

- Purpose: the data and arithmetic under the comparison page
  (`compare.html`, `compare.js`; globe round-5 plan 2026-10-01-0945 §3.3
  "Judged end to end"), kept pure so `node --test` covers it.
- Public API:
  - `COMPARE_VARIANTS`: the rows, `{ id, label, hash }`: A, B, C,
    `globe-albedo` at detail 0 and 0.5, `globe-bands`. Another agent's
    styles join by appending a row (one line each).
  - `COMPARE_PLAN`: the place (`alps`), the capture altitudes (300, 100, 30,
    10 km), the hand-over altitude (150 km, the globe's `handOverKm`), the
    suns (day `2026-06-21T11:00:00Z`, low `2026-06-21T18:00:00Z`), the
    contrast grid (11 x 11 posts 1 km apart), the hand-over grid (21 x 21,
    4 km apart), the frames timed, and the keys every capture shares
    (`light` 1, `tau` 0, `svf` 8).
  - `groundGrid(posts, stepM)`: ENU points centred on the place. RangeError
    for a bad size or step.
  - `captureHash(variant, sun, pose, plan?)`: the lab hash of one capture.
  - `stats(values)` (population mean and sd over the finite values),
    `quantile(values, p)` (nearest rank), `onCanvas([u, v])`.
- Invariants: every row's hash is read back by `readTerrainParams` with no
  note; a capture's hash reproduces its pose exactly (to the hash's 0.01°).
- Tests: `terrain-compare.test.mjs`.
