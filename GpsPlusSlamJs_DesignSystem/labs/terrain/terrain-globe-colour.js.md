# terrain-globe-colour.js: the relief coloured from the globe imagery

- Purpose: the owner's core idea (feedback 2026-10-01-0936 §4; globe
  round-5 plan 2026-10-01-0945 §3.3): colour the relief from the Blue
  Marble pixels the globe already shows, blended with the heights, so the
  relief looks detailed although only heights are fetched. Two approaches
  as lab styles, plus the measuring tools the comparison page reports with.
- Public API:
  - `GLOBE_ALBEDO` `{ side: 256, detail: 0.5, ratioRange: [0.5, 1.6] }`:
    C1's albedo grid (1 km texels over the 256 km region), the detail
    weight a style opens with, and the high-pass ratio's clamp.
  - `GLOBE_BANDS` `{ widthM: 300, sweepM, blocksPx, minWidthM,
maxWidthM }`: C3's band width, the widths the comparison sweeps and the
    cross-validation's fold block sizes (1, 4, 16 imagery pixels).
  - `linearLuminance(srgb)`: Rec. 709 luminance in linear light.
  - `detailRatio(fineLum, coarseLum, detail)`: 1 + detail x (fine / coarse
    - 1), clamped; 1 for no detail, a black footprint or a non-finite
      fine value. RangeError for a weight outside 0-1.
  - `globeAlbedoColour({ albedo, light, fineLum, coarseLum, detail })`:
    `sunLitColour(albedo, light x detailRatio(...))`;
    `globeAlbedoLinear(...)` the same light before the tone mapping
    (`sunLitLinear`), whose chromaticity is the albedo's.
  - `footprintLuminanceGrid({ fineLum, grid, halfM, side, footprint })` ->
    `Float32Array`: C1's coarse luminance, the fine post grid's box mean
    over an imagery pixel's footprint around each texel centre of the
    albedo grid (0 where no post is inside). The page builds the shader's
    `uCoarseLum` with it.
  - `footprintM(level, latDeg, tileSize = 256)` -> `[east-west, north-south]`
    metres of one EPSG:4326 imagery pixel (sphere of the WGS84 equatorial
    radius; 2.45 km north-south at level 5, 4.9 km at level 4).
  - `summedArea(values, side)` and `boxMeanAt(sat, { side, spacingM,
extentM }, x, y, wx, wy)`: the mean of the lab's posts inside a box,
    clipped to the grid, null when none is inside.
  - `bandRamp(samples, { widthM })` -> `{ widthM, bands, sea }`: C3's ramp
    from `{ heightM, rgb }` samples; `bandRampColour(ramp, h)` (null with no
    land band), `bandRampLut(ramp, LUT)`, `rampFitError(ramp, samples)` ->
    `{ mean, p95, n, skipped }` (CIE76): a land sample the ramp cannot
    colour (no land band: a ramp fitted on sea alone) is SKIPPED and
    counted, never judged (it passed `null` to `deltaE76`, a TypeError, on a
    sea-only fold; PR #531 review); with none judged, mean and p95 are
    NaN. RangeError for a width outside 10-5000 m.
  - `foldOf(gx, gy, blockPx = 1)`: a sample's fold, a checkerboard of
    `blockPx`-pixel blocks over its global imagery pixel indices.
  - `bandSweep(samples, widthsM, { blockPx = 1 })` -> per width `{ widthM,
blockPx, bands, minCount, fit, cv }`: the in-sample error and the
    two-fold cross-validated one (fitted on one fold, judged on the other;
    the folds that could be judged averaged, `cv.skipped` the land samples
    a fold's ramp could not colour;
    samples carry `gx`, `gy`). RangeError when a fold is empty. The
    cross-validated error is the honest number: narrow bands always fit
    their own pixels better. One-pixel folds LEAK (review 2026-10-01-1650
    m2): neighbouring imagery pixels are alike, and a narrow band's pixels
    lie along a contour, so every judged pixel has fitted neighbours on the
    same contour; blocks of 4 or 16 pixels keep most neighbours in one
    fold (a unit test shows the leak on synthetic autocorrelated imagery).
  - `deltaE76(a, b)`: CIE76 difference of two sRGB colours (D65).
- Invariants & assumptions:
  - C1's detail is a scalar on the light, so it is the same albedo lit more
    or less: no hue of its own (the tone curve's toe shifts saturation by
    up to 0.03, as it does for any brighter or darker globe pixel). The
    coarse luminance is the fine one's box mean over the imagery pixel's
    footprint, so the ratio averages to about 1 over a footprint and the
    footprint keeps the imagery's colour, the globe's at the hand-over.
  - With `detail` 0, C1 IS the imagery under the sun term: open flat ground
    is what the globe draws for that pixel.
  - The fine ramp is style B's cover colour before any light
    (`naturalBaseColour` at s 1), so the high-pass carries forest, meadow,
    rock and snow at the relief's own resolution.
  - C3's means are taken in linear light; each imagery pixel is paired with
    the mean height over ITS footprint (what its colour integrates), so
    peaks are averaged down and the ramp's top bands hold the highest
    footprints, not the highest posts.
  - HOW THE TOP BAND CLAMPS: the ramp is fitted on footprint-mean heights
    but the shader reads it at the posts' own heights, and
    `bandRampColour` holds the last band's colour above that band's mean
    height. So every post higher than the highest footprint mean takes the
    top band's colour: on the Alps the top band sits well below the
    highest post, and the page reports the share of land posts above it
    (`state().globeColour.clamp`, logged by the smoke).
  - The imagery level is the far field's `FAR_FIELD.level` (5, the
    globe's finest): footprints of about 2.45 km north-south.
- Examples:

  ```js
  const ratio = detailRatio(fine, coarse, 0.5);
  const colour = sunLitColour(albedo, light * ratio);
  const ramp = bandRamp(samples, { widthM: 300 });
  ```

- Tests: `terrain-globe-colour.test.mjs` (the ratio's identities, weight
  and clamp; C1 with no detail equals the sun-lit imagery; C1 is the same
  albedo under a scaled light; brighter where the ramp is lighter; box
  means against hand counts, edge clipping and brute force; the footprint
  sizes; C3's band means in linear light, interpolation, ends, sea, a
  ramp recovered from a height function at every width, the LUT; CIE76
  against hand-computed L*; the sweep's two errors, the block folds and
  the one-pixel folds' leak; the footprint mean of the unclamped detail
  ratio is 1 at every texel; C1's linear chromaticity is the albedo's) and
  `terrain-globe-colour.smoke.spec.mjs` (C1 at real Alps pixels against
  its reference; the detail moves pixels but not the region's mean, the
  share declared and swept over 1/2-1/10; C3 against its reference, the
  top band's clamp, and the band-width sweep on the Alps and the Blue
  Ridge at fold blocks of 1, 4 and 16 pixels, logged).
