# globe-terrain.ts - the globe's relief carrier, prepared

- Purpose: round-5 plan 2026-10-01-0945 §8 DEC-GL5-9 (decided:
  the tile library's own terrain tiles carry the relief from F1 on), F1a:
  the carrier made usable before it enters the flight. It fixes the three
  defects the F0 spike measured
  (`GpsPlusSlamJs_Docs/docs/2026-10-02-0307-globe-f0-frame-and-carrier-spike-results.md`
  §7):
  1. heights as 32-bit float with linear filtering read 0 m on a device
     without `OES_texture_float_linear` (flat relief): uploaded as R16F;
  2. the tiles drew with the library's material: they get the globe's lit
     copy (night lights, clouds, the water glint), keeping the library's
     displacement, bump maps and bump chunk;
  3. the imagery came from the wrong latitude (at 46.5 N from about
     26.3 N: the library hands the overlay a range normalised in its Web
     Mercator tiling, the imagery is plate carree): ranges are converted
     and the imagery UV is computed per vertex from the geodetic normal.
     The F0 doc first read this as a colour-space step; the range
     conversion is the cause (a 20-degree shift, Sahara for Alps).
- Public API:
  - `GLOBE_TERRAIN`: `programKey` (shared by every terrain tile's lit
    material), `halfFloatStepM(h)` (the step R16F stores at `h` metres:
    0.5 m at 1,000 m, 2 m at 4,000 m, 8 m at 8,848 m).
  - `mercatorToGeographicRange([w, s, e, n])`: a range normalised in Web
    Mercator (0 south, 1 north) as the same box normalised in plate
    carree; RangeError unless four finite numbers in order.
  - `geographicOverlay(imagery)`: the plate-carree overlay as the
    library's terrain plugin calls it: every range converted, the level
    the imagery picks for it (`calculateLevel`; the plugin passes its own
    tile level, up to 14); `tiling` and `init` passed through.
  - `useHalfFloatHeights(texture)`: `internalFormat = "R16F"` on a 32-bit
    float texture, once; other textures untouched. Heights stay metres
    (not h - 4,000 m, which would halve the step at the summits): the
    library refills each grid's border from its neighbours in place, and
    an offset copy would miss those refills.
  - `tileGeographicBounds(geometry)`: a tile's box in radians from its
    geodetic normals; RangeError without normals.
  - `litTerrainMaterial(template, own, bounds)`: the globe's lit copy for
    one tile: `own`'s map, displacement and bump maps and scales, both
    compile hooks (the library's first, then the globe's), the imagery UV
    from the normal over `bounds` (uniform `uTerrainGeoBounds`), program
    key `GLOBE_TERRAIN.programKey`.
  - `createGlobeTerrain({ url, imagery, template, heightScale, maxZoom? })`
    -> `{ tiles, plugin, litTiles(), dispose() }`: the library's
    `TerrariumMeshPlugin` on `url` (Terrarium encoded; `maxZoom` 12 by
    default), the imagery through `geographicOverlay`, and on every
    `load-model` the half-float heights and the lit copy; on
    `dispose-model` the copy is freed. The caller adds `tiles.group` to
    its scene, sets the camera and resolution and calls `tiles.update()`.
    RangeError for an empty url or a height scale that is not finite and
    > = 0; Error if the library stops exporting the plugin (0.5.3 ships it
    > without typings, so it is read off the plugins entry at runtime).
- Invariants & assumptions:
  - The template is the globe's own (`createGlobeSurface().template`), so
    the relief reads the same uniforms and sun as the globe.
  - The imagery's composed texture covers the tile's box with north at
    its top (`CanvasTexture`, `flipY`), so v runs south to north; the
    texture's own offset and repeat (set by the plugin for its linear
    map) are not used.
  - Tiles never cross the antimeridian (XYZ tiles are aligned to it).
  - A guard test reads the library's plugin source: if a bump makes it
    convert the overlay range itself, the adapter would convert twice.
- Example:

  ```ts
  const globe = createGlobeSurface();
  const terrain = createGlobeTerrain({
    url: TERRARIUM_URL_TEMPLATE,
    imagery: globe.overlay,
    template: globe.template,
    heightScale: 1,
  });
  scene.add(terrain.tiles.group);
  terrain.tiles.setCamera(camera);
  terrain.tiles.setResolutionFromRenderer(camera, renderer);
  // per frame: terrain.tiles.update();
  ```

- Tests: `globe-terrain.test.ts` (the range conversion and its size at
  46.5 N; the overlay adapter's calls; the half-float upload and its
  steps; the box from normals; the lit material's maps, hooks, UV patch
  and key; the factory on a simulated tile load and dispose; refusals; the
  library guard). The GPU side (heights read back with the extension
  hidden, the look against the globe at noon, dusk and night, the data
  budget, the seam scan) is the design system's
  `labs/globe-terrain/globe-terrain.smoke.spec.mjs`.
