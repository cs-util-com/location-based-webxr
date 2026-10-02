# terrarium-bytes.mjs - the real data one descent costs

- Purpose: round-5 F1a review major 4 (reproducible data numbers): the
  globe-terrain data smoke records every height tile a descent asks for
  (`test-results/globe-terrain/requests-<heights>-et<n>.json`, heights
  `synthetic` or `terrarium`, error target n); the synthetic tiles' PNG
  sizes are not representative, so this script sums the REAL Terrarium
  sizes of those tiles from AWS Open Data (one HEAD request per distinct
  tile, content-length), per list and per level.
- Usage: from `GpsPlusSlamJs_DesignSystem/`, after the smoke ran:
  `node labs/globe-terrain/terrarium-bytes.mjs`. It prints the fetch date
  with the totals (the AWS tiles can change).
- Invariants & assumptions: needs network; a tile that is missing or
  unreachable is counted as `missing`, not as 0 bytes silently. Not part
  of any gate and not deployed (no page imports it).
- Tests: none of its own; its input comes from
  `globe-terrain.smoke.spec.mjs` ("the data one descent asks for").
