# compare.js: the terrain colour comparison page

- Purpose: judge the relief colour approaches end to end (globe round-5
  plan 2026-10-01-0945 §3.3): ONE terrain lab in a frame
  (`compare.html`), driven through its test hooks along its fly-in onto the
  Alps (`flyInPoseAtAltitude`), captured at 300, 100, 30 and 10 km at a
  day and a low sun, one row per approach (`COMPARE_VARIANTS`). Style C
  (the far field itself) is captured at 1500, 900, 600 and 300 km instead:
  at and below 300 km it draws exactly style A.
- What it logs per row (a table, the console as `compare <id>: ...` lines,
  and `window.__terrainCompare = { done, error, rows, buffer, pixelRatio }`),
  never asserting:
  - the colour difference (CIE76) at the hand-over altitude (150 km, the
    fly-in's pose there) to the globe's pixel, two ways (review
    2026-10-01-1650 M2):
    - `point`: each ground point of a 21 x 21 grid 4 km apart, its rendered
      pixel against the bilinear imagery there under the sun. Relief
      shading counts as colour error here, although the globe at that
      scale would show the same light on average.
    - `footprint`: for each grid point's imagery pixel, the render
      box-averaged in linear light over that pixel's footprint (5 x 5
      points over 2.45 x 1.68 km on the Alps) against that ONE pixel's
      globe colour. At 150 km one imagery pixel is about 3 x 3 drawing
      pixels across and along the view, so this is what a viewer compares
      at the hand-over. It removes the per-point relief shading, but keeps
      any shift of the footprint's mean.
    - The globe's pixel is a MODEL, `sunLitColour(imagery, max(0, sun
height), sunIntensity)`: flat ground under the globe's sun. That is
      C1's own formula without the slope term, so C1 at detail 0 matches it
      BY CONSTRUCTION on flat ground: its residual is relief shading and
      the bilinear imagery against the pixel. C3 and the map styles have no
      such advantage. The ranking of C1 and C3 against A and B is robust
      to this (a gap of 29-52 ΔE in the first run); C1 against C3 (a gap of about 4) is not.
    - Not modelled, and so missing from every row alike: the globe's
      atmosphere veil (aerial perspective over 150 km of air, which lifts
      and blues the globe's dark ground) and the GGX specular of its
      MeshStandardMaterial (roughness 0.9; estimated 15-20 % of the
      diffuse for dark Alpine albedo by the review, not measured). Both
      make the real globe pixel lighter than the model, so the imagery
      styles, which draw the model, would read darker than the real globe.
  - the local contrast, read from the rendered pixels: the luminance
    spread (sd, 8-bit), the mean luminance and their ratio (the
    coefficient of variation: a darker image has less spread at the same
    relative contrast) over an 11 x 11 ground grid around the place, at
    each capture altitude. The pixel scale it rests on is logged with it:
    - the lab is pinned to pixel ratio 1 (`dpr=1`), so the 800 x 500 frame
      is an 800 x 500 drawing buffer on every screen (the buffer size is
      logged);
    - the grid step is 1 km, widened per altitude (to a whole 100 m) until
      the posts are 3 drawing pixels apart along the view
      (`contrastStepM`); a widened step is marked `*`. At 300 km 1 km is
      1.15 px across and 0.74 px along the view (not 3 px, as the page
      once said), so the 300 and 100 km rows measure contrast at a coarser
      ground scale than the 30 and 10 km rows;
    - each row logs the modelled px/km and the measured median post
      spacing in pixels (the projected grid).
  - the frame cost at the day sun and 30 km (C: 300 km), the mean and sd
    of 10 frames, and its ratio to the FIRST row's mean (style A unless
    `?rows=` leaves it out) within one load: a CPU rasteriser's
    milliseconds are relative only.
- Query: `?quick=1` (rows A and C1 at detail 0.5, 100 km, the day sun: the
  smoke's bounded run); `?rows=A,C3` picks rows by id.
- Waits: each capture waits for the hash to apply, the relief, the
  imagery and the imagery styles' grids, and the sky view, each bounded;
  a timeout ends the run with `error` set and says so on the page.
- Tests: `terrain-compare.smoke.spec.mjs` (the bounded run completes on
  the committed tiles with finite numbers and a pinned 800 x 500 buffer;
  `TERRAIN_COMPARE_FULL=1` runs the full table) and
  `terrain-compare.test.mjs` (the plan, the pixel scale against an
  independent pinhole projection, the footprint helpers).
