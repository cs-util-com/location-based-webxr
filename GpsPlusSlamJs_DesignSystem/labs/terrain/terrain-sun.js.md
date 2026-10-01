# terrain-sun.js: the relief lit by the globe's sun

- Purpose: one light for the terrain lab's relief, the globe's own sun
  (globe round-5 plan 2026-10-01-0945 §3.3 "One light first"), so the
  hand-over continuity metric, the colour approaches built on the globe
  imagery and the later cloud-shadow port share it.
- Public API:
  - `GLOBE_SUN.intensity` (re-exported from `terrain-far-field.js`, where
    it lives so the far field lights its texels the same way): the globe
    surface's sun intensity (5, DEC-GL4-1); a test holds it to
    `GpsPlusSlamJs_Globe/src/globe-surface.ts`.
  - `MIN_SUN_Z`: sin 2°, the floor a relative shade divides by.
  - `sunEnu({ elevationRad, azimuthRad })` -> `[east, north, up]`, unit.
  - `MAP_KEY_LIGHT`: the classic map light (315°, 45° up), styles B and D's,
    derived from `NATURAL`'s light (one source; a test holds D's to it).
  - `sunDownNote(sunZ, timeMs?)`: the line the page shows while the relief
    is lit by the globe's sun and that sun is on or below the horizon
    (naming the UTC time when given); null while the sun is up.
  - `sunEnuFromGlobe(sun, latDeg, lngDeg)`: the globe's sun input (the
    framework's `solarPosition(ms, 0, 0)`, as `globe-lab.js` computes it)
    turned into the place's ENU. RangeError for any non-finite input.
  - `reliefNormal(gx, gy, gain)`: the shading normal (gain steepens the
    slope for the shading only; E never enters it).
  - `sunDirect(n, sun, visibility = 1)`: max(0, N·L) x visibility. THE one
    term the cloud shadow dims.
  - `sunRelativeShade(n, sun, visibility = 1)`: the direct term over the
    sun's height (floored): the map styles' shade under the sun (flat 1).
  - `sunLight(n, sun, { shadow, svf = 1, visibility = 1 })`: shadow x
    direct + (1 - shadow) x max(0, L.z) x svf. RangeError for a shadow share
    outside 0-1.
  - `sunLitColour(albedoSrgb, light, intensity = GLOBE_SUN.intensity)`:
    the globe's pipeline: the diffuse term of its MeshStandardMaterial
    (albedo / π x intensity x light), Neutral tone mapping, sRGB; the far
    field's `farColour` is its one implementation. Not modelled: the
    material's GGX specular (roughness 0.9; a small share on dark ground,
    estimated 15-20 % of the diffuse for dark Alpine albedo by the review
    2026-10-01-1650, not measured) and the atmosphere's veil.
  - `SUN_GLSL`: the shader's copy, with `terrainSunVisibility(enu, heightM,
toSun)` returning 1 (the cloud-shadow port's seat). Needs `uSun`,
    `uSunIntensity` and three's tone-mapping chunk.
- Invariants & assumptions:
  - The sun IS the globe's: the page calls `solarPosition(ms, 0, 0)` exactly
    as the globe lab does and turns it with `sunEnuFromGlobe` (geodetic ENU
    axes at the place; exact for a direction). Its clock is the globe lab's
    (`time=`, `timeScale=`, `/globe/globe-clock.js`).
  - Open flat ground in a clear sky gets exactly max(0, L.z) from
    `sunLight` for every shadow share: the globe's dot(N, L) with no sky
    light, so the relief and the globe agree on flat ground at the
    hand-over. The sky fill only redistributes light where the relief
    differs from flat.
  - `visibility` enters only `sunDirect`; the sky fill is never dimmed, so a
    cloud-shadowed field is darker but never black (shadow 0.8 leaves 0.2).
    In the shader every direct term goes through `terrainSunVisibility`,
    the far field's flat-ground light included (review 2026-10-01-1650 m4;
    a test reads the shader source for a bare sun height).
  - THE FILL COUPLING, for the cloud-shadow port (review 2026-10-01-1650
    m4): the sky fill is derived from the sun, `(1 - shadow) x max(0, L.z) x
svf`, so under a FULL cloud shadow (visibility 0) only the `shadow`
    share goes: open flat ground keeps 0.2 of its clear-sky light at shadow
    0.8, as if the sky above the cloud still lit it at full sun. Physically
    an overcast sky lights the ground diffusely with far less than that,
    and a broken one with more than the sun-derived fill under the cloud's
    edge. When the port lands, decide whether the fill follows the cloud
    cover's mean transmittance over a wider footprint (a soft overcast
    term) instead of staying sun-derived; until then a cloud shadow on the
    relief is lighter than the globe's own cloud shadow, which dims all of
    its single light.
  - `sunRelativeShade` equals `singleLightShade` for the same light, so a
    map style switched to the sun changes its light's direction only.
  - Below the horizon the direct term is 0 and the sky fill is 0: the
    relief has no night (the globe's night lights are not modelled), so the
    page shows `sunDownNote` while it is dark (the imagery styles open on
    the clock's present).
- Examples:

  ```js
  const sun = sunEnuFromGlobe(solarPosition(ms, 0, 0), 46.56, 9.14);
  const n = reliefNormal(gx, gy, 1.6);
  const colour = sunLitColour(albedo, sunLight(n, sun, { shadow: 0.8, svf }));
  ```

- Tests: `terrain-sun.test.mjs` (the frame turn against textbook solar
  geometry over 2000 random cases; flat ground equals the globe's dot(N, L)
  for every shadow; visibility dims only the direct share; the relative
  shade equals `singleLightShade`; the colour is the Lambert diffuse at the
  globe's intensity through Neutral; the intensity held to the globe's
  source) and `terrain-sun.smoke.spec.mjs` (the page's sun within 1° of an
  independent estimate, and the Alps' lit faces swapping between a morning
  and an evening sun).
