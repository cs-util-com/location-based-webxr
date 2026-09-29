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
cloudOpacity: 0.8 }`, the defaults (lab parameters `#nightGain=`,
    `#waterRoughness=`, `#cloudOpacity=`; the phone round sets them).
  - `GLOBE_CLOUD_DRIFT_DEG_PER_S` - 0.5, the clouds' default drift in
    degrees of longitude per scene second (lab `#cloudDrift=`, 0-10): sized
    to move visibly within a few seconds at real time (about 1 px/s on a
    phone-sized globe); real weather moves about a degree an hour.
  - `cloudLonOffsetRad(sceneMs, degPerS)` - the drift at an instant (the
    globe clock's epoch ms), radians east in [0, 2π): an absolute function
    of the instant, so a pinned `#time=` shows the same clouds on every
    load. RangeError for a non-finite instant or rate.
  - `GLOBE_SURFACE_CACHE_KEY` - the program key every tile shares (`-v2`
    since the drift uniform joined the program).
  - `createGlobeSurfaceUniforms({ night, water, clouds })` returns the one
    shared uniforms object: `uSunEcef` (unit, ECEF), `uNight`, `uWater`,
    `uClouds`, `uNightGain`, `uWaterRoughness`, `uCloudOpacity`,
    `uCloudLonOffset` (radians, 0 until the caller sets it).
  - `patchGlobeSurfaceShader(shader, uniforms)` - a pure string transform,
    in place: the geodetic-normal varying (the OBJECT-space normal:
    `GeneratedSurfacePlugin` writes the geodetic ellipsoid normal and gives
    a tile only a translation, so it is ECEF whatever `tiles.group`'s
    placement; a world normal would misplace the maps once phase 5
    re-centres) and the terms, each after its chunk:
    - after `alphamap_fragment` (so after `map_fragment` and
      `color_fragment`, over the tile imagery): latitude and longitude from
      the normal, the three maps sampled once (the clouds
      `uCloudLonOffset` further west, so they drift east, with the same
      gradients: the shift is continuous and the map repeats, so it adds
      no seam), and the clouds whitening `diffuseColor` by
      `cloud * uCloudOpacity`;
    - after `roughnessmap_fragment`: water with no cloud takes
      `uWaterRoughness` (the sun's glint);
    - after `emissivemap_fragment`: `night * uNightGain`, faded in across
      the terminator as `1 - smoothstep(-0.12, 0.08, n·sun)` (GLSL leaves
      smoothstep with edge0 > edge1 undefined) and dimmed 80 % under cloud.
    - Throws, naming the chunk, when an anchor is missing or repeated (a
      three upgrade that renamed one), instead of dropping a term.
  - `applyGlobeSurface(material, uniforms)` - sets `onBeforeCompile` (the
    patch) and `customProgramCacheKey`.
- Invariants & assumptions:
  - The maps are equirect, north at the top; the shader reads `.g` of the
    water mask (water is cyan), `.r` of the clouds (coverage, read as data)
    and `.rgb` of the night lights (sRGB, decoded by the GPU).
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
  uniforms shared; the drift offset in the cloud sample only;
  `cloudLonOffsetRad` exact modulo a turn at today's epoch (a property); `textureGrad` for all three samples; a missing or
  doubled anchor refused by name; one program key; no texture on the
  material but `map`. The browser: the lab smoke's day, night, glint and
  seam checks, each proven able to fail (the night gain off and matte water
  inline, through the hash; the seam fix and the terminator fade removed as
  one-time source mutants). `globe-sky.smoke.spec.mjs`: the drift offset at
  two pinned times and the drifted clouds in the pixels (none with the
  clouds off).
