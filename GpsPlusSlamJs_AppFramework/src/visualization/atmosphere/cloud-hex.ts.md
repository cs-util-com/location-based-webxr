# cloud-hex.ts

Hex-tiling for the clouds' big-shape octave: the 24 km noise tile no longer
repeats, with no seam, and the field still repeats at N tiles so the wind's
drift can wrap there. The CPU twin of the shader chunk.

Source: hex-tiling plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-0919-cloud-hex-tiling-plan.md`
(H1, DEC-HX-1..7 and its cold review). Method: Mikkelsen 2022, "Practical
Real-Time Hex-Tiling" (JCGT 11(2)); blend: Heitz and Neyret 2018
(variance-preserving).

## Public API

- `CLOUD_HEX`: `cellsPerTile` 2 (cells of half a tile, 12 km), the rows'
  aspect `aspectNum / aspectDen` = 13 / 15, `sharpness` 4, `seed` 7,
  `textureMean` (the default texture's mean, held by a test).
- `hexPeriodTiles(cellsPerTile)`: N, the tiles after which the field
  repeats in both axes: 13 for 2 cells a tile, 26 for 1 and 3.
  RangeError for a cell count that is not a positive integer.
- `hexCorners(u, v, cellsPerTile?)`: the three cell centres around (u, v)
  (tiles) as cell indices, and the point's barycentric shares (summing
  to 1).
- `hexCellOffset(i, j, cellsPerTile?, seed?)`: a cell's texture offset in
  [0, 1)^2, equal for cells one period apart.
- `hexTiledSample(sample, u, v, mean, options?)`: the hex-tiled texture at
  (u, v): each of the three cells reads `sample` at its own offset, blended
  by sharpened barycentric weights w, as mean + sum(w (x - mean)) /
  sqrt(sum(w^2)). `mean` is the texture's mean. RangeError for coordinates
  that are not finite.

- `hexCoverThresholds(field, options?)`: the cover thresholds of `field`
  (the whole two-octave noise with octave 1 hex-tiled, `cloudNoiseSample`
  with `hex`) for `options.covers` (default k / 32; +Infinity at 0), its
  quantiles over one period.
- `HEX_COVER_LOW_TAIL`: the covers k / 512 up to 1 / 32, precomputed and
  held by a test; without it every cover under 1 / 32 drew 3.1 % cloud
  (H1/H2 milestone review, finding 1).
- `HEX_COVER_THRESHOLDS`: that table for the default texture, precomputed
  (1.8 s on a desktop under load; a live switch must not pay it on a
  phone) and held to the computation by a test.
- `hexCloudThreshold(cover)`: linear in that table; +Infinity at 0.
  RangeError for a cover outside [0, 1].
- `CLOUD_HEX_GLSL`: the shader twin (GLSL ES 3.00), include-guarded:
  `atmCloudHexGrad(tex, uv, dx, dy, mean)` reads with the gradients of the
  continuous uv (the offsets jump at the cells' edges, so implicit
  derivatives there picked the coarsest level and drew the lattice as a
  line: cold review finding 1); `atmCloudHexLod(tex, uv, lod, mean)` at an
  explicit level, for a march.

## Invariants

- **The lattice is periodic.** A true hex lattice never is on the square
  tile grid (its rows step by sqrt(3) / 2, irrational); 13 / 15 is within
  0.08 % of it. In cell indices the period is spanned by (N k, 0) and
  (-m / 2, m), m = N k 15 / 13 (even by N's rule); the offsets reduce along
  that skewed vector first, then modulo N k. An independent "i mod 26, j mod
  30" is not periodic in y (the cold review's sim: error 1.04).
- **The hash is uint32 arithmetic** (`Math.imul`), so the shader's uint
  operations give the same bits (its float conversion rounds to 2^-24).
- **Continuous everywhere**: a corner's weight reaches 0 at its triangle's
  far edge, and the corners shared across an edge carry the same weight on
  both sides.
- **Mean and contrast kept**: measured on the real noise, the contrast
  within 1 % over cell sizes 1-3 and sharpness 2-8.
- **The cover's threshold is not kept**: today's thresholds on the hex
  field give 2.2-3.4 % too much cloud, worst near 0.69 cover (the same
  sweep). With hex on, the field's own thresholds are used; on points the
  table was not computed from, every k / 32 cover is met within 0.006.

## Measured (2026-10-08, real noise, 90,000 points over 13 x 13 tiles)

- Correlation one tile on, of the FIRST octave: 1.000 today; 0.10 / 0.05
  / 0.02 for whole-tile cells at sharpness 2 / 4 / 8; about 0.0 for cells
  of half and a third of a tile. The drawn two-octave field keeps 0.15-0.16
  over 13 tiles (its detail octave is not hex-tiled, cold review item 8),
  and -0.23 to 0.45 in the 1-4-tile windows one view sees (the milestone
  review's sweep).

## Limits

- The tables and the shader's mean are the DEFAULT texture's (256, seed
  1). A non-default texture would split the CPU twin (its own mean) from
  the GPU (the constant): `SkyAtmosphere` is the only caller of
  `createCloudTexture` and uses the default (H1/H2 milestone review,
  finding 11).
- The hex field's range is wider than the plain one's (-0.11..0.97 against
  0..0.92): the cover is right by quantile, but the peaks are a little
  thicker (finding 12; for the owner's eye in H3).
- The coverage map's GLSL interpolates its table between clear (2) and the
  1 / 32 entry below that cover, plain or hex alike (unchanged by hex).

## Tests

- `cloud-hex.test.ts`: the period rule, the weights, the offsets' period
  along both lattice vectors, the field's period at N in both axes (cell
  sizes 1-3), no repeat at one tile on the real noise (swept), mean and
  contrast, a constant texture, bad input.
  The table against the computation, the cover met on other points, the
  interpolation; the shader string's guard, constants and explicit reads
  (it cannot run without WebGL: its readback against `hexTiledSample` is
  the browser check, plan H2).
- `cloud-hex.property.test.ts`: continuity across every cell edge (2,000
  random points, cell sizes 1-3) and the barycentric shares.
