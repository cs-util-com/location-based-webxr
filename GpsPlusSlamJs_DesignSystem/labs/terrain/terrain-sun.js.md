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
  - `SKY_FILL` `{ floor, twilightDeg: 6 }` (DEC-GL5-11): the sky fill's
    declared parameters. `floor` (0-1, in units of open flat ground under
    a zenith sun) is the least sky level while the sun is up; the page's
    `sky` key overrides it. `twilightDeg` is the depth below the horizon
    over which the floor fades to 0 (civil twilight). The default floor,
    0.5, comes from a browser sweep of 0-1 (results doc
    2026-10-02-0933-terrain-low-sun-sky-fill-results.md): at an 11° sun on
    the Alps it is the one swept value that both lifts the darkest tenth
    of `globe-albedo` above 10 of 255 at 30 and 10 km and keeps the relief
    at least as contrasty (CV) as at noon; 0.65 is the other defensible
    choice (darkest tenth 13.6 at 30 km, 2 % flatter than noon at 10 km).
  - `skyLevel(sunZ, floor = SKY_FILL.floor, twilightDeg = SKY_FILL.twilightDeg)`:
    max(sin h, floor) while the sun is up; below the horizon the floor
    times a smoothstep from 1 at the horizon to 0 at -`twilightDeg`.
    Never falls as the sun rises. RangeError for a non-finite height, a
    floor outside 0-1 or a twilight outside 0-90°.
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
  - `sunLight(n, sun, { shadow, svf = 1, visibility = 1, skyFloor = SKY_FILL.floor })`:
    shadow x direct + (1 - shadow) x `skyLevel(L.z, skyFloor)` x svf.
    RangeError for a shadow share or a floor outside 0-1.
  - `sunLitColour(albedoSrgb, light, intensity = GLOBE_SUN.intensity)`:
    the globe's pipeline: the diffuse term of its MeshStandardMaterial
    (albedo / π x intensity x light), Neutral tone mapping, sRGB; the far
    field's `farColour` is its one implementation. Not modelled: the
    material's GGX specular (roughness 0.9; a small share on dark ground,
    estimated 15-20 % of the diffuse for dark Alpine albedo by the review
    2026-10-01-1650, not measured) and the atmosphere's veil.
  - `SUN_GLSL`: the shader's copy, with `terrainSunVisibility(enu, heightM,
toSun)` returning 1 (the cloud-shadow port's seat) and `skyLevel()`
    (its twilight a constant from `SKY_FILL`). Needs `uSun`,
    `uSunIntensity`, `uSkyFloor` and three's tone-mapping chunk.
- Invariants & assumptions:
  - The sun IS the globe's: the page calls `solarPosition(ms, 0, 0)` exactly
    as the globe lab does and turns it with `sunEnuFromGlobe` (geodetic ENU
    axes at the place; exact for a direction). Its clock is the globe lab's
    (`time=`, `timeScale=`, `/globe/globe-clock.js`).
  - While the sun stands above the floor (sin h >= floor), open flat ground
    in a clear sky gets exactly max(0, L.z) from `sunLight` for every
    shadow share: the globe's dot(N, L) with no sky light, so the relief
    and the globe agree on flat ground at the hand-over, and the sky fill
    only redistributes light where the relief differs from flat.
  - THE LOW-SUN SKY (DEC-GL5-11): below that sun the sky holds the floor,
    so a face the sun does not reach keeps (1 - shadow) x floor x svf
    instead of a share of the vanishing sin h (0.2 x sin 11° before, under
    one 8-bit level on dark ground). The change is declared and bounded:
    the light rises by exactly (1 - shadow) x svf x max(0, floor - sin h),
    so nothing moves at a sun above asin(floor) (the browser test holds
    the day render's pixels identical at floors 0 and 0.8), and at most by
    (1 - shadow) x svf x floor, at the horizon. Why a floor is plausible:
    relative to the sun's beam, the clear sky's light does not fall with
    the sun's height as the beam's projection on flat ground does; it
    holds, and toward the horizon rises, because the beam itself weakens
    on its longer path through the air. The lab's beam keeps its full
    strength at every height, so the floor stands in for that ratio.
    Consequence at a low sun: the relief's open flat ground is lighter than
    the globe's, which has no sky light (shadow x sin h + (1 - shadow) x
    floor against sin h); the comparison page logs the hand-over difference
    at the low sun for every floor. The far field keeps the globe's
    flat-ground light, so at a low sun the near relief is lighter than the
    far field it blends into, and the blend fades the sky in as the camera
    descends.
  - A CLOUD SHADOW DIMS THE DIRECT LIGHT, NEVER THE SKY FILL: `visibility`
    enters only `sunDirect`, and `skyLevel` never reads it, in the
    reference and in the shader (`skyLevel()` takes no visibility; a test
    reads the shader source for it). So a cloud-shadowed field is darker
    but never black: at shadow 0.8 it keeps the 0.2 sky share of its sky
    level, at a low sun the floor's. In the shader every direct term goes
    through `terrainSunVisibility`, the far field's flat-ground light
    included (review 2026-10-01-1650 m4; a test reads the shader source for
    a bare sun height, allowed only in `skyLevel` and the relative shade's
    floor).
  - THE FILL COUPLING, for the cloud-shadow port (review 2026-10-01-1650
    m4): the sky level comes from the sun's height and the floor, not from
    the cloud cover, so under a FULL cloud shadow (visibility 0) only the
    `shadow` share goes: open flat ground keeps (1 - shadow) x its sky
    level, as if the sky above the cloud still lit it. Physically an
    overcast sky lights the ground diffusely with far less than a clear
    one, and a broken one with more under a cloud's edge. When the port
    lands, decide whether the sky level also follows the cloud cover's mean
    transmittance over a wider footprint (a soft overcast term); until then
    a cloud shadow on the relief is lighter than the globe's own cloud
    shadow, which dims all of its single light.
  - `sunRelativeShade` equals `singleLightShade` for the same light, so a
    map style switched to the sun changes its light's direction only.
  - Below the horizon the direct term is 0 and the sky fill fades from the
    floor to 0 over the civil twilight (6°): the relief has no night (the
    globe's night lights are not modelled), so the page shows
    `sunDownNote` from the horizon on, saying the relief has only the
    fading twilight sky (the imagery styles open on the clock's present).
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
  source; the sky level's floor, twilight and monotony; the light changing
  only below the floor, by the declared amount; the shader's sky level
  free of the visibility and fed the page's floor),
  `terrain-sun.smoke.spec.mjs` (the page's sun within 1° of an independent
  estimate, and the Alps' lit faces swapping between a morning and an
  evening sun) and `terrain-sky-fill.smoke.spec.mjs` (globe-albedo at the
  11° sun held to this reference at floors 0, 0.25, 0.5 and 1, the faces
  in shadow lighter at every step, and the day render unmoved between
  floors 0 and 0.8).
