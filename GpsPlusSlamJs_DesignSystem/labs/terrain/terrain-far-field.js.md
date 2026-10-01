# terrain-far-field.js: style C's far field

- Purpose: the globe's own Blue Marble imagery under the terrain, blended
  into the near style by the camera's altitude (terrain plan 2026-09-27-0605
  §4 style C, §9 findings 11 and 12; research 2026-09-27-0600 §6.3), so the
  later dive from the globe crosses a seam between two images that agree.
- Public API:
  - `FAR_FIELD`: level 5 of the globe's pyramid, its finest (5.625°
    tiles, about 2.4 km a pixel north-south; level 4 was 4.9, review
    2026-10-01 m7), 256 px tiles, a 128 x 128 grid over the
    drawn region (2 km a texel at 256 km), the blend's altitudes (near
    style from 1500 km down to 300 km).
  - `imageryTiles(box, level)`: the EPSG:4326 tiles over a lat/lng box
    (2 x 2^z columns from 180° W, 2^z rows from 90° N, the globe's
    `tile-pyramid.ts` layout), north row first. Throws on a bad level or an
    inside-out box.
  - `regionBox(toLatLng, halfM, pixelDeg?)`: the box of the region's
    corners, widened by one imagery pixel.
  - `sampleImagery(tiles, lat, lng)`: bilinear sRGB 0-1, each pixel at its
    centre, across tile edges; null where a pixel is missing.
  - `farFieldGrid({ side, halfM, toLatLng, sample })`: the grid's RGBA
    bytes, texel i centred at `-halfM + (i + 0.5) x 2 halfM / side`, row 0
    south; alpha 0 where the imagery has no answer (the shader keeps the
    near style there). `farFieldAt(grid, side, halfM, x, y)` reads it back
    as the shader does (bilinear, clamped).
  - `srgbToLinear`, `linearToSrgb` (three's sRGB transfer curves),
    `neutralToneMap(rgb, exposure?)` (three r185's Neutral, line for line)
    and `farColour(srgb, light = 1)`: the texel as the globe draws ground
    under its sun (`GLOBE_SUN.intensity`, Lambert; `light` 1 is lit straight
    from above; decode, tone map, encode). `GLOBE_SUN`: the globe's sun
    intensity, held to the globe's source by `terrain-sun.test.mjs`.
  - `farWeights(altitudeM, { on, highKm?, lowKm? })` -> `{ near, relief }`:
    the near style's weight (0 above `highKm`, 1 below `lowKm`) and the far
    field's relief texture (0 above twice `highKm`, 1 below `highKm`); off,
    `{ near: 1, relief: 0 }`.
- Invariants & assumptions:
  - "Matches the globe" (finding 12) means the texel through the globe's
    tone mapping with nothing else applied: ground lit from straight above.
    The globe itself lights its ground with the sun at its own angle and
    adds a small specular term (a standard material at roughness 0.9), so
    a real globe pixel differs from the reference by those. The claim that
    the dive's seam is then invisible is unverified until the dive exists
    (plan §7).
  - The shader uses three's own tone-mapping chunk; this file mirrors it
    for the tests, and the smoke holds the two together.
  - The blend follows the SMOOTHED camera altitude (as the exaggeration
    does), uniformly over the frame. A per-pixel distance blend would fade
    an oblique view's far edge first; that is a choice for the dive (§7).
  - The far field's relief is the ratio of the fine shade to the shade at
    the imagery's own scale (the gradient over +-2 km), so shading the
    imagery already carries is not doubled.
- Examples: `farColour([0.5, 0.5, 0.5])` is about 0.59 (a mid grey lit at the
  globe's intensity 5 over π, through
  the tone mapping); `farWeights(900_000, { on: true }).near` is 0.5.
- Tests: `terrain-far-field.test.mjs` (the tiles over the Blue Ridge and
  across tile edges, the region box, pixel centres and tile edges in the
  sampler, the grid's placement and read-back, empty texels, the sRGB
  round trip, the tone mapping worked by hand, the weights at their ends
  and with swept altitudes). In the browser:
  `terrain-styles.smoke.spec.mjs` (the far pixel against the grid and the
  imagery, style A as the counter-case, a failed imagery load).
