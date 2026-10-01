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
  - `GLOBE_BANDS` `{ widthM: 300, sweepM, minWidthM, maxWidthM }`: C3's
    band width and the widths the comparison sweeps.
  - `linearLuminance(srgb)`: Rec. 709 luminance in linear light.
  - `detailRatio(fineLum, coarseLum, detail)`: 1 + detail x (fine / coarse
    - 1), clamped; 1 for no detail, a black footprint or a non-finite
    fine value. RangeError for a weight outside 0-1.
  - `globeAlbedoColour({ albedo, light, fineLum, coarseLum, detail })`:
    `sunLitColour(albedo, light x detailRatio(...))`.
  - `footprintM(level, latDeg, tileSize = 256)` -> `[east-west, north-south]`
    metres of one EPSG:4326 imagery pixel (sphere of the WGS84 equatorial
    radius; 2.45 km north-south at level 5, 4.9 km at level 4).
  - `summedArea(values, side)` and `boxMeanAt(sat, { side, spacingM,
    extentM }, x, y, wx, wy)`: the mean of the lab's posts inside a box,
    clipped to the grid, null when none is inside.
  - `bandRamp(samples, { widthM })` -> `{ widthM, bands, sea }`: C3's ramp
    from `{ heightM, rgb }` samples; `bandRampColour(ramp, h)` (null with no
    land band), `bandRampLut(ramp, LUT)`, `rampFitError(ramp, samples)` ->
    `{ mean, p95, n }` (CIE76). RangeError for a width outside 10-5000 m.
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
  - The imagery level is the far field's `FAR_FIELD.level` (4 on this
    branch; the globe stream moves it to 5).
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
  against hand-computed L*) and `terrain-globe-colour.smoke.spec.mjs` (C1
  at real Alps pixels against its reference; the detail moves pixels but
  not the region's mean).
