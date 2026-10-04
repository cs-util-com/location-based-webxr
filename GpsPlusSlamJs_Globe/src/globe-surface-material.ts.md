# globe-surface-material.ts - the globe's surface patch

- Purpose: globe plan 2026-09-26-0539 §7.3, M3. Night lights on the dark
  side, a glint on smooth water, and the clouds, as one string patch on
  three's physical shader (the one `MeshStandardMaterial` compiles), with
  one program shared by every tile. The clouds drift east over the ground
  with the globe's clock (round-2 plan 2026-09-26-2055 M3f), so they read
  as a layer of their own.
- Public API:
  - `GLOBE_SURFACE_TUNING` - `{ nightGain: 0.7 (the owner's look, round-4
plan DEC-GL4-1; 1 before), waterRoughness: 0.35,
cloudOpacity: 0.8, skyShare: 0.2 }`, the defaults (lab parameters `#nightGain=`,
    `#waterRoughness=`, `#cloudOpacity=`; the phone round sets them).
    `skyShare` is the sky fill's share of the diffuse light, 1 - the
    relief's direct share (the terrain lab's 0.8, DEC-GL5-5).
  - `GLOBE_CLOUD_DRIFT_DEG_PER_S` - 0.375 (0.75 x the first 0.5, the
    owner's choice, round-6 plan DEC-G6-5), the clouds' default drift in
    degrees of longitude per scene second (lab `#cloudDrift=`, 0-10): sized
    to move visibly within a few seconds at real time (about 1 px/s on a
    phone-sized globe); real weather moves about a degree an hour.
  - `cloudLonOffsetRad(sceneMs, degPerS)` - the drift at an instant (the
    globe clock's epoch ms), radians east in [0, 2π): an absolute function
    of the instant, so a pinned `#time=` shows the same clouds on every
    load. RangeError for a non-finite instant or rate.
  - `GLOBE_SURFACE_CACHE_KEY` - the program key every tile shares (`-v2`
    since the drift uniform joined the program, `-v6` since the sky fill,
    `-v8` since the fill follows the band). A page with a relief compiles
    the band (`band: true`) under its own key, the same with `-band`, and
    a globe that fills the relief's gaps through the stencil (`band: true,
fill: true`, round-6 plan G6-1) under `-band-fill`.
  - `createGlobeSurfaceUniforms({ night, clouds })` returns the one
    shared uniforms object: `uSunEcef` (unit, ECEF), `uSunWorld` (the
    same sun in world space, kept by the surface), `uNight`,
    `uClouds`, `uNightGain`, `uWaterRoughness`, `uCloudOpacity`,
    `uCloudLonOffset` (radians, 0 until the caller sets it), `uSkyFloor`
    (`SKY_FILL.floor`, globe lab `#skyFloor=`) and `uSkyShare`
    (`GLOBE_SURFACE_TUNING.skyShare`), `uCarrierShare` (the altitude
    band's relief share, 0 until the page sets it) and `uSunRadiance` (the
    sun light's colour x intensity, kept by the surface: the fill's light by
    role, not the scene's first directional light).
  - `GLOBE_FADE_GLSL` and `globeFadeKeeps(d, share, side)`: the band's
    cross-fade (one-scene plan §3.2). Each pixel goes to exactly one
    carrier by a screen dither (interleaved gradient noise of
    `gl_FragCoord`): the globe's tiles (`GLOBE_FADE_SIDE` 0, the default)
    keep the pixels whose dither is at or above `uCarrierShare`, the
    relief's tiles (`globe-terrain.ts` defines 1) the ones below. No
    blending, so no sorting and no pixel lit twice. The discard is the
    fragment's first work, after `clipping_planes_fragment`.
  - The band's code (the discard and the sky fill) is compiled only where a
    relief exists: `#if defined( GLOBE_BAND ) || GLOBE_FADE_SIDE == 1`. The
    discard is also left out of a globe that fills the relief's gaps
    (`GLOBE_FILL`, from `fill: true`): it keeps every pixel the stencil lets
    through, and a discard would turn off a GPU's early depth and stencil
    tests for its whole shader (`globe-stencil-fill.ts`). The
    plain globe draws the program from before the relief (review
    2026-10-03-1835 minor 10). `patchGlobeSurfaceShader(shader, uniforms,
{ band })` and `applyGlobeSurface(material, uniforms, { band })` prefix
    `#define GLOBE_BAND` for a page with a relief.
  - The sky fill's share on the globe's own tiles is `uSkyShare x
uCarrierShare`, so above the band (share 0) the approved globe look is
    unchanged and the two carriers agree where they meet (review
    2026-10-03-1835 major 2); the relief's tiles take `uSkyShare` in full.
  - `patchGlobeSurfaceShader(shader, uniforms)` - a pure string transform,
    in place: the geodetic-normal varying (the OBJECT-space normal:
    `GeneratedSurfacePlugin` writes the geodetic ellipsoid normal and gives
    a tile only a translation, so it is ECEF whatever `tiles.group`'s
    placement; a world normal would misplace the maps once phase 5
    re-centres) and the terms, each after its chunk:
    - after `alphamap_fragment` (so after `map_fragment` and
      `color_fragment`, over the tile imagery): the water from the tile's
      alpha (`1 - diffuseColor.a`; round-4 plan 2026-09-28-2105
      DEC-GL4-6), then the alpha set back to 1 so no tile turns
      translucent; latitude and longitude from the normal, the two global
      maps sampled once (the clouds
      `uCloudLonOffset` further west, so they drift east, with the same
      gradients: the shift is continuous and the map repeats, so it adds
      no seam), and the clouds whitening `diffuseColor` by
      `cloud * uCloudOpacity`;
    - after `roughnessmap_fragment`: water with no cloud takes
      `uWaterRoughness` (the sun's glint);
    - after `emissivemap_fragment`: `night * uNightGain`, faded in across
      the terminator as `1 - smoothstep(-0.12, 0.08, n·sun)` (GLSL leaves
      smoothstep with edge0 > edge1 undefined) and dimmed 80 % under cloud.
    - after `lights_fragment_end`: the sky fill (DEC-GL5-11), the
      relief's light on the globe. The direct diffuse keeps
      `1 - uSkyShare`; the sky adds `uSkyShare` x the Globe package's one
      sky level (`sky-level.ts`, `skyLevelOf`) at the geodetic sun height
      x the sun light's colour (its intensity included) through three's
      Lambert. On flat ground with the sun above the floor that is the
      direct term again (no change at noon); below it the sky holds the
      floor and fades through the civil twilight, so a low sun's ground is
      what the terrain lab's relief draws for flat ground (0.255 of a
      zenith sun at 11.2 degrees, not 0.194). The specular (the glint) is
      untouched. `uSkyFloor` 0 is exactly the look before on flat tiles
      (the fill is then the geodetic sun height, the flat globe's own
      direct term). Inside `#if NUM_DIR_LIGHTS > 0`: the sun light's
      uniform exists only then. The relief's tiles (`globe-terrain.ts`)
      carry the same patch, so relief and globe agree at a low sun.
    - Throws, naming the chunk, when an anchor is missing or repeated (a
      three upgrade that renamed one), instead of dropping a term.
  - The reference look's uniforms (round-4 plan 2026-09-28-2105
    DEC-GL4-8), each 0 (off: the patch then draws exactly as before) to 1:
    `uGrade` (the ground's colour mixed towards its luma times a cool blue,
    by 0.7 at 1), `uCloudRelief` (the clouds whiten towards a shade: blue
    grey where thin, white where thick, lighter on the side facing the sun
    from the coverage's screen-space gradient against the sun's direction
    in view space, clamped to 0.65-1.3; the sun is `uSunWorld`, the ECEF
    sun turned by every group above the tiles, which the view matrix maps
    correctly however the tiles are placed: review 2026-10-01 m4, the
    ECEF sun was right only while those groups were unturned; the program
    key is v5 since), `uTwilight` (warm city lights, a faint
    blue-grey night side and a soft band just past the terminator, both
    from the ground's own colour, added as emission).
  - `applyGlobeSurface(material, uniforms)` - sets `onBeforeCompile` (the
    patch) and `customProgramCacheKey`.
- Invariants & assumptions:
  - The maps are equirect, north at the top; the shader reads `.r` of
    the clouds (coverage, read as data) and `.rgb` of the night lights
    (sRGB, decoded by the GPU). The water is each imagery tile's alpha (0
    on water, 1 on land; a tile with no water has no alpha and reads as
    land; the MODIS mask kept only where the imagery shows dark sea,
    `water-alpha.ts`), at the imagery's own resolution (4.9 km a pixel at level 4, 2.4
    km at level 5) and cut to the same tiles, so the glint ends where the
    imagery's coast is. It replaced a 2048 px global map (about 20 km a
    pixel) whose blur put the glint onto the land beside every coast (the
    owner's bright coastal line; `labs/globe/globe-coast.smoke.spec.mjs`).
  - That reading relies on 3d-tiles-renderer 0.5.3 handing each surface
    tile its ONE imagery tile's texture directly (`RegionImageSource`'s
    single-tile fast path; the surface tiles are cut on the overlay's own
    tiling), decoded with `premultiplyAlpha: 'none'`. A path that
    composited tiles into a 2D canvas (premultiplied) would lose the colour
    under the water and turn the sea black.
  - **No seam at 180°:** the longitude wraps there, and its raw derivative
    would pick the coarsest mip for a 1-2 px line. Samples use
    `textureGrad` with the derivatives of whichever of two wraps (seam at
    180° or at 0°) changes less across the pixel (Tarini's method), all
    computed before the choice so they stay defined. Needs `RepeatWrapping`
    in longitude.
  - No texture is ever a material property (see `globe-surface.ts.md`).
  - Not composed with the library's overlay or fade wrappers: as built, the
    imagery is a plain `map` and no fade plugin runs (plan §14), so §7.8's
    wrapper checks do not apply until phase 3 stacks overlays.
- Tests: `globe-surface-material.property.test.ts` (over random extra lines
  anywhere in three's shader: the patch only inserts, always the same
  lines) and `globe-surface-material.test.ts`, on copies of three's real
  `ShaderLib.standard`: each term once and after its chunk, in order; the
  uniforms shared; the drift offset in the cloud sample only; the sky fill
  from the shared `SKY_LEVEL_GLSL`, after the lights, under the sun light's
  guard;
  `cloudLonOffsetRad` exact modulo a turn at today's epoch (a property); `textureGrad` for all three samples; a missing or
  doubled anchor refused by name; one program key; no texture on the
  material but `map`. The browser: the lab smoke's day, night, glint and
  seam checks, each proven able to fail (the night gain off and matte water
  inline, through the hash; the seam fix and the terminator fade removed as
  one-time source mutants). `globe-sky.smoke.spec.mjs`: the drift offset at
  two pinned times and the drifted clouds in the pixels (none with the
  clouds off).
