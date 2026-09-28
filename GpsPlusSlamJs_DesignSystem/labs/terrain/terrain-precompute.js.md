# terrain-precompute.js: the per-region precompute and texture packing

- Purpose: from the full-precision heights, compute what the shader reads
  (terrain plan 2026-09-27-0605 §4 "Precompute", §9 findings 13-14; research
  2026-09-27-0600 §6-§7): the gradient, the local relief at a large and a
  small scale, the relief spread and the sky-view factor; and pack them into
  an RGBA16F and an RGBA8 texture.
- Public API:
  - `gradient(h, side, spacingM)` -> `{ gx, gy }` (m/m, east and north):
    Sobel's 1-2-1 smoothing, one-sided differences on the outer posts, so a
    plane comes back exactly everywhere.
  - `gaussianBlur(h, side, sigmaTexels)` -> Float64Array: three box passes
    per axis, edges clamped; a constant stays exactly constant.
  - `localRelief(h, side, sigmaTexels)`: height minus its blur (m).
  - `reliefStd(h, side, sigmaTexels)`: the standard deviation of height in
    the blur's footprint (m), computed in doubles.
  - `skyView(h, side, spacingM, { directions, steps })` -> 0-1 (Zakšek et
    al. 2011): `1 - mean(sin(horizon angle))`, the angle floored at 0; flat
    ground is exactly 1. A march stops at the grid's edge.
  - `packTerrain(fields, side, toHalf)` -> `{ rgba16, rgba8 }`; `toHalf` is
    three's `DataUtils.toHalfFloat`, injected. RGBA16F: height, gradient
    east, gradient north, local relief. RGBA8 per `AUX_ENCODING`.
  - `AUX_ENCODING`: `reliefStdSpanM` 1000 (R = spread / 1000 m),
    `reliefSmallMPerStep` 2 (G = 128 + small relief / 2 m, so +-256 m);
    B = sky view (1 when not computed yet); A = 255 for data, 0 for fill.
- Invariants & assumptions:
  - Grids are row-major, `side * side`, row 0 at the SOUTH edge (the order
    OsmDemo's `buildHeightfieldData` samples in).
  - Heights are datum-relative (OsmDemo's `terrainTextureFrom`), so half
    floats step 1 m up to 2 km of relief; slopes are never re-derived from
    them (research §4.3).
  - The padding ring (`terrain-params.js`, `FIELD.padM`) is at least the
    sky-view march and three blur sigmas, so the drawn region never reads
    past the data.
  - Cost at 545 x 545 posts: the lab's cost line reports decode, relief and
    sky view in ms (SwiftShader timings are relative only).
- Tests: `terrain-precompute.test.mjs`: a plane's slope exactly, edges
  included; a constant field's blur, relief and spread; the sign of a peak
  and a pit; a spread that grows with relief and never exceeds half the
  step; sky view 1 on flat ground and lower in a valley than on its flank;
  the packing's channels, and the aux encodings' round trip and clamps.
