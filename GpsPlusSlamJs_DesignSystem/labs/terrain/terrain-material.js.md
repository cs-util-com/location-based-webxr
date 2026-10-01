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
    `uExag`, `uGain`, `uNearW`, `uFarReliefW`, `uSun` and
    `uLightMode`; per hash through
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
    three's `sRGBTransferEOTF`, lit as the globe lights it (`farColour`:
    times `uSunIntensity` / π, and with `light` 1 times the sun's direct
    term on flat ground, `sunDirect(up, vis)`, through the cloud-shadow
    seat like every other direct term: review 2026-10-01-1650 m4),
    its relief ratio faded in by `uFarReliefW`,
    tone mapped with three's own `NeutralToneMapping` (the chunk is
    included, since the lab renders with no tone mapping), encoded with
    `sRGBTransferOETF`, and mixed under the near style. A texel the imagery
    could not answer (alpha 0) keeps the near style.
  - The key light (globe round-5 plan §3.3, `terrain-sun.js`'s
    `SUN_GLSL`, included whole): `uSun` is unit ENU toward the light, the
    map light (315°, 45°) or the globe's sun, set per frame by the page;
    `uLightMode` 1 shades A and E by it alone (`sunRelativeShade`) instead
    of the four map lights; B and D always read it (`sunShade` is
    `sunRelativeShade`, which with the map light is their
    `singleLightShade`). `terrainSunVisibility(vEnu, h, uSun)` is computed
    once per fragment and passed to every direct term: the cloud-shadow
    port replaces its body and nothing else. A sun straight overhead has
    no azimuth, so D's exposure colour is then flat.
  - `globe-albedo` (`uStyle` 4, `terrain-globe-colour.js`): `uAlbedo` (the
    imagery's 1 km grid over the region, read at the far field's
    `regionUv`) under `sunLight`, the light scaled by `detailRatio` of
    style B's cover luminance (`naturalBase`, the cover half of `natural`)
    to `uCoarseLum` (its footprint mean, RGBA16F); `uAlbedoDetail` the
    weight. Where the albedo texel is empty (not loaded, a failed tile) it
    draws style B. `createScalarTexture(values, side, toHalf)` builds the
    footprint texture; `EMPTY_TEXTURE` is the transparent texel both grids
    start from.
  - `globe-bands` (`uStyle` 5): the region's band ramp (`uLutBands`, 256 x
    1 over 0-`uLutMaxM`, `createLutTexture`) or its sea colour
    (`uBandSea`, when `uBandSeaOn`) under `sunLight`, as the globe lights
    its pixels. `uBandsOn` is 0 until the page has built the DRAWN
    region's ramp (no imagery yet, imagery that failed, or a new region
    whose imagery is still loading; the page resets it on every region
    change), and globe-bands then draws style B (review 2026-10-01-1650
    m6: it drew style A's LUT or the previous region's ramp).
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
