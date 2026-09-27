# Lessons learned: gps-plus-slam-globe

- **An untextured generated globe still needs an overlay.** 3d-tiles-renderer
  0.5.3's `GeneratedSurfacePlugin` takes its tiling scheme from an overlay;
  with `applyOverlayTexture: false` it fetches no image, so M0 draws the
  ellipsoid with no network at all (measured: every request to 127.0.0.1).
- **An overlay's projection is resolved only when it initialises.** Before
  that, `overlay.projection.scheme` reads `"none"`, so a test pins the
  options the module passes, not the overlay's own field.
- **The plugin has no `name`,** so `getPluginByName` cannot find it; the
  renderer's `plugins` list does.
- **A dark limb looks like a misshapen globe.** The night side merges with a
  black background; a reference sphere showed the geometry was round.
- **A black view is the night side before it is a hole.** Until M3 the lab's
  sun is fixed over the Atlantic, so views towards 150-180°E are black. M2's
  first centring failure at (0, 179.9) looked like a missing surface; a
  pixel grid across several longitudes showed the terminator instead.
- **A ray crossing a tile edge of constant latitude exactly can miss the
  tiles.** Observed: every centre ray on the equator found no tile, and at
  a tile corner the far side of the Earth ((45, 0) read back as
  (-45, 180)); edges of constant longitude were hit, and 0.01° off an edge
  always hit. Whether the tiles' shared vertices differ or three's triangle
  test is simply not watertight is NOT established, so this says nothing
  about visible cracks. The lab aims its centre ray 1e-5 of the half-frame
  off both axes (about 50 m, 0.0008°) and treats a far-side hit as none.
- **A light inside `tiles.group` lights nothing.** The library's `TilesGroup`
  refreshes its children's world matrices only when its own world matrix
  changes; at identity it never does, so a `DirectionalLight` added there
  keeps the matrix it was made with, sits on its target and has no
  direction. M3's first render was an all-black globe with no error. The
  surface's `group` now holds the tile group and the sun side by side.
- **A 180° seam test can pass by construction.** Centred exactly on 180°,
  the wrap falls on a 2x2 pixel-quad boundary, so no derivative ever spans
  it and the image is identical with and without the seam fix. The view
  must put the line inside a quad, and assert it: 179.95° first seemed to, but at 9.45 px per degree it lands the line on a quad boundary and "worked" only through a 0.03 px centring residual (milestone review). The view is 1 px west (179.894°), and the test checks the line's quad per row. Pooled over rows, a real
  cloud edge on the line hid the seam too; the check is per row.
- **"Nearly black" is not "a hole" once exposure changes.** Under M3's tone
  mapping deep sea reads (0,0,9); a hole shows the black sky exactly.
- **Level 4 weighs more than its sample said.** The globe plan estimated z4
  at about 1.9 MiB from 48 random tiles (3.7 KiB each); the whole level
  measured 2.42 MB (512 tiles, about 4.6 KiB each), so the committed assets
  came to 4,451,405 bytes against the owner's 4.5 MB budget: about 1 %
  headroom. Sampling error explains it: the sizes are skewed (median 3.2,
  mean 4.6, standard deviation 4.4 KiB, 0.65-19.4 KiB), so a 48-tile mean
  has a standard error of 0.63 KiB and 3.7 was 1.5 of them low. A size
  estimate from a sample needs its spread reported with it.
  `globe-sources.test.ts` holds the total.
