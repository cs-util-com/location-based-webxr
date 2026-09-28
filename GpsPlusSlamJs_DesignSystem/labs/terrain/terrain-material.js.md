# terrain-material.js: the mesh, the textures and the one shader

- Purpose: draw the terrain in every style (terrain plan 2026-09-27-0605 §4
  "Mesh", "Shading" and "Styles"; research 2026-09-27-0600 §6, §7.1).
- Public API:
  - `createTerrainTextures({ rgba16, rgba8, side, lut, lutSwiss })` ->
    `{ data, aux, lut, lutSwiss }`: an RGBA16F data texture (half-float
    bits), the RGBA8 aux texture and the two ramps' 256 x 1 LUTs (style A's
    and style D's); linear, clamped, no mipmaps.
  - `createFarTexture(grid, side)`: the far field's RGBA8 grid
    (`terrain-far-field.js`).
  - `createTerrainMaterial(textures, { side, extentM, datum })`: a
    `ShaderMaterial` whose uniforms the page updates in place: per frame
    `uExag`, `uGain`, `uNearW` and `uFarReliefW`; per hash through
    `applyStyle`; per build the textures and `uDatum`; once `uHalfM`,
    `uFarDeltaM`, `uFarDeltaUv` and `uFar`.
  - `applyStyle(material, params, { shaderStyle, latDeg, hRange })`: the
    style switch and every style's uniforms from the hash's params (see
    `terrain-params.js.md`): the shading strength, the A/E shading set, B's
    tree and snow lines for the place's latitude plus the offsets, the
    aspect, rock slope and lift, D's exposure, lowland contrast and the
    region's land range, and the snow mask.
  - `createTerrainGeometry(halfExtentM, stepM)`: the flat grid over the
    drawn region (not the padding), a vertex every `stepM` metres.
- Invariants & assumptions:
  - The vertex shader lifts the grid by the datum-relative height times
    `uExag`; E enters the height ONLY, never the normal (plan §9 finding
    20), so exaggerating lifts the land without darkening it, in every
    style. It also passes the ENU position, which the far field reads by.
  - ONE shader with a switch (`uStyle`): A 0, B 1, D 2, E 3; C is A with
    the far field. Each branch mirrors its tested reference line for line:
    `terrain-style.js` (A: the LUT ramp, the relief green,
    `multidirectionalShade`, the tints, the sky view, the detail, the sea),
    `terrain-styles.js` (B: `naturalWeights`/`naturalColour`; D:
    `exposureColour`/`swissColour`; E: `clayColour` through A's shading
    with E's uniforms, `shadeColour`).
  - Style A's uniforms and code path are unchanged from T1 when `uStyle`
    is 0 and the far field is off (`uNearW` 1): the T1 smoke's flat-tile
    and tilted-plane checks still hold it to `landColour`.
  - The far field (`uNearW` < 1): the grid's sRGB texel decoded with
    three's `sRGBTransferEOTF`, its relief ratio faded in by `uFarReliefW`,
    tone mapped with three's own `NeutralToneMapping` (the chunk is
    included, since the lab renders with no tone mapping), encoded with
    `sRGBTransferOETF`, and mixed under the near style. A texel the imagery
    could not answer (alpha 0) keeps the near style.
  - The snow mask (`uSnowMask` 1) draws B's snow weight as grey in any
    style, for the smoke and for judging the line by eye.
  - Half floats and bytes only (plan §9 finding 13): every texture is
    filterable in core WebGL2; the smoke asserts no FloatType texture.
  - sRGB throughout, written as is: no tone mapping and no colour-space
    conversion (except the far field, explicitly), so a flat pixel equals
    `landColour` (the T1 smoke checks it).
  - Texture rows run south to north (row 0 south), as the worker's grids do.
  - GLSL's `smoothstep` is undefined for reversed edges, so every reversed
    blend (the far field's altitudes) is computed on the page.
  - The page sets `frustumCulled = false`: the grid's flat bounds do not
    contain the lifted surface.
- Tests: through `terrain.smoke.spec.mjs` (style A: a flat tile's colour
  equals the reference at E 1, 2, 5 and 10; a tilted plane; a ridge's lifted
  silhouette; the hatch; no FloatType) and `terrain-styles.smoke.spec.mjs`
  (each style's pixels against A; B's snow mask on the Alps at E 1, 2, 5;
  D warm and cool and higher-is-lighter; E's saturation; C's far pixel
  against the grid and the imagery).
