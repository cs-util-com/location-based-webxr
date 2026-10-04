# globe-sky.ts - the sky behind the globe

- Purpose: round-2 plan 2026-09-26-2055 M3e (round-3 plan 2026-09-27-0532
  §4 F). The sun as a disc with a soft glow, PROCEDURAL stars (M3d;
  `globe-stars.ts`: not a catalogue, owner decision on round-2 Q2) and a
  faint Milky Way band along the galactic plane, drawn in a BACKGROUND
  pass before the Earth.
- Defaults (round-4 plan 2026-09-28-2105 DEC-GL4-1): the disc, the
  glow, the star limit and gain and the Milky Way default to the values
  the owner tuned by eye on his phone (disc 1°, glow 0.95, stars to 7.5
  at gain 4, Milky Way 0.03; before: 0.533°, 1, 6.5, 1, 0.02); round 5
  (plan 2026-10-01-0945 DEC-GL5-4) took the stars to 8.5. The globe
  smokes pin the old values where their pixel floors were measured on
  them (`withPreRound4Look` in `labs/globe/globe-smoke-helpers.mjs`).
- Public API:
  - `GLOBE_SKY` - `radius` (1, the sky sphere around its camera),
    `realSunDiameterDeg` (0.533, the real sun's mean apparent diameter),
    `sunDiameterDeg` (1, the default disc: the owner's look),
    `sunRadiance` (40, far above 1: the shader clamps the disc to white),
    `glow` (0.95, the glow's strength at the disc's edge) and `glowWidthRad`
    (1.5°, where the glow has fallen to 1/e). The glow is a look: space has
    no air to scatter light; a lens and an eye do. `starMagLimit` (8.5),
    `starGain` (4: a star's linear radiance is `10^(-0.2 (m + 1))` x gain,
    the eye's compressed response; at gain 1 magnitude 6.5 reads about
    0.03, about 49/255 on screen), `milkyWay` (0.03, the band's peak
    linear radiance; 0.02 reads about 38/255 towards the galactic centre),
    `milkyWayWidthRad` (10°),
    `starShell` (0.9, the stars' radius inside the sphere).
  - `createGlobeSky()` returns `{ scene, camera, uniforms, stars,
starUniforms, visibleStars(), setCelestialRotation(q), setStarLook(look),
setSun(direction),
setLook({ sunDiameterDeg, glow }), syncCamera(view), render(renderer,
view), dispose() }`.
    - `setSun(direction)`: the world direction towards the sun (any
      length), the same one that lights the Earth; RangeError for a zero or
      non-finite vector.
    - `setLook`: the disc's apparent diameter in degrees (> 0) and the
      glow's strength (>= 0); RangeError otherwise.
    - `syncCamera(view)`: copies the view's WORLD rotation, fov, aspect and
      zoom; never its position (the sun would sit at a finite place) and
      never its clip planes (the globe camera's near plane is tens of
      kilometres and its far plane follows the horizon; the sky sphere has
      its own planes around radius 1).
    - `setCelestialRotation(q)`: the celestial frame into the view's world
      frame (the lab: its placement x `celestialToEcefQuaternion` of the
      Greenwich sidereal angle); turns the stars and the Milky Way's pole
      and centre.
    - `setStarLook({ magLimit, gain, milkyWay, pixelRatio, visible })`:
      the limit (0.5-9, a uniform and the geometry's draw range: the
      field is generated to 9 once, packed 6 bytes a star and sorted
      brightest first, so the range stops at the limit; DEC-GL4-2),
      the gain and Milky Way (>= 0), the device pixel ratio (> 0, so a
      star keeps its size on a phone); RangeError otherwise.
      `visibleStars()` counts the stars the limit draws;
      `brightestStar()` is the brightest star's celestial direction as
      the GPU decodes it (the lab's smoke checks the pixels there).
    - The star vertex shader has no `position`: it decodes the packed
      octahedral direction (`index0AttributeName` is `aOct`), the
      magnitude byte over `uMagRange` and the colour tint.
    - `setSpace({ strength, earthDirection, earthAngularRadiusRad })`
      (DEC-GL4-8 item 6): navy space instead of black, lighter over the
      last half radian towards the Earth's limb; the caller passes the
      Earth's direction from the camera and its angular radius every frame.
      0 (the default) is black. RangeError for a negative strength, a zero
      direction or a radius outside 0 to π/2.
    - `setStarGlow(glow)` (item 7): widens each star's sprite by up to
      12 px x glow in proportion to its intensity (clamped at 1; round 5
      DEC-GL5-4 replaced the intensity SQUARED, which at the default limit
      widened only a few dozen stars) and adds a soft halo round the core,
      which keeps its size; 0 (the default) draws exactly as before.
      RangeError when negative or not finite.
    - `render(renderer, view)`: syncs, then draws the sky. The caller
      clears first (with `autoClear` off) and draws its scene after.
  - `uniforms`: `uSunDirection` (unit), `uSunRadius` (radians),
    `uSunRadiance`, `uGlow`, `uGlowWidth`.
- Invariants & assumptions:
  - The stars are round soft points, added (additive blending) after the
    sphere (`renderOrder` 1), no depth, never culled.
  - The sphere is drawn inside out (`BackSide`), never culled, with no
    depth test and no depth write: it can never hide the Earth, and the
    Earth, drawn after it, always covers it.
  - The angle to the sun is `2 asin(|d - s| / 2)`, exact near zero, where
    `acos(d·s)` loses a 0.27° disc to 32-bit rounding. The disc's edge is
    smoothed over one pixel (`fwidth`); the glow falls off exponentially
    outside it.
  - NOT tone mapped (`toneMapped: false` on the sphere and the stars;
    stream F review, finding 3): Neutral tone mapping squares values under
    0.08, which crushed the faint stars and hid the Milky Way. The shaders
    clamp to 1 themselves and end with the output colour space chunk.
  - Stars past the magnitude limit are moved outside the clip volume and
    blacked out (finding 2): a point size of 0 is undefined in WebGL, and
    ANGLE draws it as one pixel.
  - The Milky Way's mottle is a function of galactic longitude and
    latitude only (finding 7), so it turns with the band.
- Example (the globe lab):

  ```js
  renderer.autoClear = false;
  const sky = createGlobeSky();
  // per frame:
  renderer.clear();
  sky.setSun(sunWorldDirection);
  sky.render(renderer, camera);
  renderer.render(scene, camera);
  ```

- Tests: `globe-sky.test.ts` (the depth and culling flags; a property that
  the sky camera takes the view's rotation and fov, never its position or
  planes; the unit sun and its refusals; the real sun's size by default and
  the lab's look; the chord form in the shader; tone mapping off with the
  clamp; the mottle in galactic coordinates; the stars' flags and order,
  the clip past the limit, the limit and look and their refusals, the
  rotation of the stars and the galactic pole and centre). The
  lab's `globe-sky.smoke.spec.mjs` checks the pixels: the disc white and
  centred on the projected sun direction (black with the pass off), the
  glow falling off from 0.5° to 8°, and the Earth covering the sun behind
  it (the same pixels with the pass on and off); the procedural stars in
  space and not over the Earth; the sun's right ascension against the
  sidereal star frame.
