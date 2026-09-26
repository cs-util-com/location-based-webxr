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
