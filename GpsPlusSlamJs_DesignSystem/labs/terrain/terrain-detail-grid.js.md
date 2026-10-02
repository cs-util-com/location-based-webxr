# terrain-detail-grid.js - globe-albedo's detail as a grid of factors

- Purpose: the form in which the globe's relief tiles read
  `globe-albedo`'s detail. Those tiles come from the 3D-tiles library, not
  from the terrain lab's mesh, so they cannot run the lab's per-fragment
  style B. This module computes the same factor at the lab's own posts:
  the fine luminance is style B's cover, the coarse one is its mean over
  the far field's imagery pixel, and the factor is `detailRatio` of the
  two. The lab's own functions are used, so the two pages cannot drift
  apart. The globe lab hands the grid to the Globe package's
  `setGlobeDetail` (`globe-detail.ts`).
- Public API:
  - `fineLuminanceGrid(fields, { datum, latDeg, cover })` - style B's cover
    luminance (linear, the shade of open flat ground) at every post of
    the lab's fields (`height` datum-relative, `gx`, `gy`, `reliefSmall`,
    `reliefStd`; row 0 south). `cover` takes the line offsets
    (`treeOffsetM`, `snowOffsetM`, `aspectSnowM`, `rockSlopeDeg`). The
    terrain lab's coarse-luminance build runs the same loop.
  - `coarseLuminanceGrid(fineLum, spec, latDeg)` - `footprintLuminanceGrid`
    over `GLOBE_ALBEDO.side` texels across the drawn region, the footprint
    of `FAR_FIELD.level`'s imagery pixel at `latDeg`.
  - `scalarAt(grid, side, halfM, x, y)` - a bilinear read between texel
    centres, clamped at the edge, as a linearly filtered texture reads.
  - `detailRatioGrid({ fields, spec, datum, latDeg, detail, cover })` ->
    `{ ratio, side, extentM, halfM }`: the factor at every post, 1
    outside the drawn region (the coarse grid covers only that) and
    everywhere for `detail` 0 (default `GLOBE_ALBEDO.detail`, 0.5).
    RangeError when the fields do not have `spec.side`^2 posts.
- Invariants & assumptions:
  - Posts are the lab's: `side` per row, post 0 at -`extentM`, every
    `spacingM`, placed by `enuFrameAt` (equirectangular at the centre).
  - The factor is computed at the posts and filtered between them. The
    lab computes it per fragment from filtered inputs, so the two differ
    slightly between posts and agree at them.
  - The factor stays within `GLOBE_ALBEDO.ratioRange`.
- Examples: on uniform land every factor is 1; at a forest-to-snow step
  the snow side next to the step is above 1 and the forest side below.
- Tests: `terrain-detail-grid.test.mjs` (style B per post; the coarse grid
  equals the lab's `footprintLuminanceGrid`; the bilinear read; 1 on
  uniform land, outside the region and with the detail off; the step's
  sign; the clamp; the size refusal).
