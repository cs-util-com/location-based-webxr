# terrain-material.js: the mesh, the textures and the style-A shader

- Purpose: draw the terrain (terrain plan 2026-09-27-0605 §4 "Mesh" and
  "Shading"; research 2026-09-27-0600 §6.1, §7.1).
- Public API:
  - `createTerrainTextures({ rgba16, rgba8, side, lut })` -> `{ data, aux,
lut }`: an RGBA16F data texture (half-float bits), the RGBA8 aux texture
    and the ramp's 256 x 1 LUT; linear, clamped, no mipmaps.
  - `createTerrainMaterial(style, textures, { side, extentM, datum })`: a
    `ShaderMaterial` whose uniforms the page updates in place (`uExag`,
    `uGain`, `uGreenAmount`, `uShadow`, the textures and `uDatum`).
  - `createTerrainGeometry(halfExtentM, stepM)`: the flat grid over the
    drawn region (not the padding), a vertex every `stepM` metres.
  - The no-data hatch uses `terrain-style.js`'s `NO_DATA_COLOURS`.
- Invariants & assumptions:
  - The vertex shader lifts the grid by the datum-relative height times
    `uExag`; E enters the height ONLY, never the normal (plan §9 finding
    20), so exaggerating lifts the land without darkening it.
  - The fragment shader shades per pixel from textures finer than the mesh
    (the fine ridge texture), and mirrors `terrain-style.js` line for line:
    the LUT ramp, the relief green, `multidirectionalShade`, the shadow and
    highlight tints, the sky view's darkening, the small-relief detail, the
    sea for h <= 0. Where the aux alpha says no data it draws the hatch.
  - Half floats and bytes only (plan §9 finding 13): all three textures are
    filterable in core WebGL2; the smoke asserts no FloatType texture.
  - sRGB throughout, written as is: no tone mapping and no colour-space
    conversion, so a flat pixel equals `landColour` (the smoke checks it).
  - Texture rows run south to north (row 0 south), as the worker's grids do.
  - The page sets `frustumCulled = false`: the grid's flat bounds do not
    contain the lifted surface.
- Tests: through `terrain.smoke.spec.mjs` (a flat tile's colour equals the
  reference at E 1, 2, 5 and 10; a ridge's lifted silhouette matches the
  projection of E x height; the hatch where a tile failed; no FloatType).
