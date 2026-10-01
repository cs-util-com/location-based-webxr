# compare.js: the terrain colour comparison page

- Purpose: judge the relief colour approaches end to end (globe round-5
  plan 2026-10-01-0945 §3.3): ONE terrain lab in a frame
  (`compare.html`), driven through its test hooks along its fly-in onto the
  Alps (`flyInPoseAtAltitude`), captured at 300, 100, 30 and 10 km at a
  day and a low sun, one row per approach (`COMPARE_VARIANTS`).
- What it logs per row (a table, the console as `compare <id>: ...` lines,
  and `window.__terrainCompare = { done, error, rows }`), never asserting:
  - the colour difference (CIE76) at the hand-over altitude (150 km, the
    fly-in's pose there) between each ground point's rendered colour and
    the globe's pixel for it, modelled as the globe draws flat ground:
    `sunLitColour(imagery, max(0, sun height))` (no clouds, no specular,
    the far field's imagery level); mean and 95th percentile;
  - the local contrast at 1-10 km, read from the rendered pixels of an
    800 x 500 frame (the frame size is part of the measurement: at 300 km a
    320 x 200 frame averaged the 10 km patch onto about 7 pixels and read a
    third of the spread): the luminance spread (sd, 8-bit), the
    mean luminance and their ratio (the coefficient of variation: a
    darker image has less spread at the same relative contrast) over
    an 11 x 11 ground grid 1 km apart around the place, at each capture
    altitude;
  - the frame cost at the day sun and 30 km, as a ratio to the first row
    (style A) within one load: a CPU rasteriser's milliseconds are
    relative only.
- Query: `?quick=1` (rows A and C1 at detail 0.5, 100 km, the day sun: the
  smoke's bounded run); `?rows=A,C3` picks rows by id.
- Waits: each capture waits for the hash to apply, the relief, the
  imagery and the imagery styles' grids, and the sky view, each bounded;
  a timeout ends the run with `error` set and says so on the page.
- Tests: `terrain-compare.smoke.spec.mjs` (the bounded run completes on
  the committed tiles with finite numbers; `TERRAIN_COMPARE_FULL=1` runs
  the full table).
