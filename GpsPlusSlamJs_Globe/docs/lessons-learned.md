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
