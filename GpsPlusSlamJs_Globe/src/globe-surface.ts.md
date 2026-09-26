# globe-surface.ts - the globe's surface

- Purpose: globe plan 2026-09-26-0539 §7, M0. The WGS84 ellipsoid generated
  by 3d-tiles-renderer's `GeneratedSurfacePlugin` from a 4326 tiling,
  untextured until M1 brings the imagery, drawn with a lit material.
- Public API:
  - `GLOBE_SURFACE` - the overlay projection (`EPSG:4326`), refinement
    levels, the future imagery URL, the placeholder colour.
  - `createGlobeSurface()` → `{ tiles, group, plugin, overlay, options,
update(camera, renderer), state(), dispose() }`. The caller adds
    `group` to its scene and calls `update` every frame before rendering.
    `state()` is `{ models, tileErrors }` (the library's `load-error`
    events).
  - `useLitMaterial(model, material)` - swaps every mesh material under a
    loaded tile model.
- Invariants & assumptions:
  - `applyOverlayTexture` is false in M0, so no image is requested.
  - The overlay only names the tiling; its projection is resolved when it
    initialises.
  - One lit material is shared by every tile and disposed with the surface.
  - The camera is set once (again only when a different camera is passed).
- Tests: `globe-surface.test.ts` (the options, the registration, the
  initial state, the swap) and `.property.test.ts` (the swap over random
  model trees). The browser: the design system's globe lab smoke.
