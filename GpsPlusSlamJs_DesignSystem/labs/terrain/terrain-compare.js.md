# terrain-compare.js: the colour comparison's rows, plan and statistics

- Purpose: the data and arithmetic under the comparison page
  (`compare.html`, `compare.js`; globe round-5 plan 2026-10-01-0945 §3.3
  "Judged end to end"), kept pure so `node --test` covers it.
- Public API:
  - `COMPARE_VARIANTS`: the rows, `{ id, label, hash, altitudesKm? }`: A,
    B, C (with its own captures at 1500, 900, 600 and 300 km, where its
    far-field blend acts), `globe-albedo` at detail 0 and 0.5,
    `globe-bands`, `globe-classes` at colour width 12 and 24. Another agent's styles join by appending a row (one line
    each).
  - `COMPARE_PLAN`: the place (`alps`), the capture altitudes (300, 100, 30,
    10 km), the hand-over altitude (150 km, the globe's `handOverKm`), the
    suns (day `2026-06-21T11:00:00Z`, low `2026-06-21T18:00:00Z`), the
    contrast grid (11 x 11 posts, 1 km apart or wider, `minPostPx` 3), the
    hand-over grid (21 x 21, 4 km apart), the footprint samples (5 x 5),
    the frames timed (10), and the keys every capture shares (`light` 1,
    `tau` 0, `svf` 8, `far` 1, `dpr` 1).
  - `captureAltitudesKm(variant, plan?)`: the row's own altitudes or the
    plan's.
  - `groundPixelsPerM({ altitudeM, tiltDeg }, heightPx, fovDeg)` ->
    `{ across, along }`: drawing pixels per metre of ground at the target,
    f / d across the view and f / d x cos(tilt) along it (f = heightPx /
    (2 tan(fov / 2)), d = altitude / cos(tilt)). RangeError for a frame or
    field of view that cannot project.
  - `contrastStepM(pose, heightPx, fovDeg, plan?)`: the plan's step,
    widened to a whole 100 m until the posts are `minPostPx` apart along
    the view.
  - `imageryPixelCentre(lat, lng, level, tileSize = 256)`: the centre of the
    EPSG:4326 imagery pixel holding a position.
  - `footprintPoints(x, y, wx, wy, n)`: n x n cell centres of a box.
    RangeError for n < 1.
  - `linearMeanSrgb(colours)`: the mean in linear light, as sRGB; null for
    none.
  - `groundGrid(posts, stepM)`: ENU points centred on the place. RangeError
    for a bad size or step.
  - `captureHash(variant, sun, pose, plan?)`: the lab hash of one capture.
  - `stats(values)` (population mean and sd over the finite values),
    `quantile(values, p)` (nearest rank), `onCanvas([u, v])`.
  - `withSkySweep(variants, skies)` (DEC-GL5-11): every row repeated at
    each sky floor, `sky` in its hash, `@sky<floor>` on its id and the
    floor in its label, its own altitudes kept; no floors returns the rows
    as they are. RangeError for a floor outside 0-1 (the lab would read it
    as its default without a word).
  - `darkTail(pixels, share)`: the darkest `share` of 8-bit RGB pixels by
    luminance: the luminance at that quantile (`p`, nearest rank), the
    mean CIELAB chroma of those pixels (`chroma`: do the shadows keep a
    hue?) and their count `n`; NaN and 0 for no pixels.
- Invariants: every row's hash is read back by `readTerrainParams` with no
  note; a capture's hash reproduces its pose exactly (to the hash's 0.01°);
  the far field's near weight is 1 at every near style's capture and at
  the hand-over, and below 1 at some of C's.
- Tests: `terrain-compare.test.mjs` (the pixel scale against an
  independent pinhole projection and the review's own 1.15 / 0.74 px at
  300 km; the step's floor and 3 px rule; the pixel centre, the footprint
  grid and the linear mean; the sky sweep's rows and their hash read back
  by the lab; the dark tail's rank and chroma).
