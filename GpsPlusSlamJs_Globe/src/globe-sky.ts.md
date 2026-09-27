# globe-sky.ts - the sky behind the globe

- Purpose: round-2 plan 2026-09-26-2055 M3e (round-3 plan 2026-09-27-0532
  §4 F). The sun as a disc with a soft glow, PROCEDURAL stars (M3d;
  `globe-stars.ts`: not a catalogue, owner decision on round-2 Q2) and a
  faint Milky Way band along the galactic plane, drawn in a BACKGROUND
  pass before the Earth.
- Public API:
  - `GLOBE_SKY` - `radius` (1, the sky sphere around its camera),
    `sunDiameterDeg` (0.533, the real sun's mean apparent diameter),
    `sunRadiance` (40, far above 1 so tone mapping draws the disc white),
    `glow` (1, the glow's strength at the disc's edge) and `glowWidthRad`
    (1.5°, where the glow has fallen to 1/e). The glow is a look: space has
    no air to scatter light; a lens and an eye do. `starMagLimit` (6.5),
    `starGain` (1: a star reads `10^(-0.2 (m + 1))` x gain, the eye's
    compressed response, so the faint ones stay visible), `milkyWay`
    (0.012, the band's peak radiance), `milkyWayWidthRad` (10°),
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
      the limit (0.5-7.5, a uniform: the field is generated to 7.5 once),
      the gain and Milky Way (>= 0), the device pixel ratio (> 0, so a
      star keeps its size on a phone); RangeError otherwise.
      `visibleStars()` counts the stars the limit draws.
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
  - The shader ends with three's tone mapping and output colour space
    chunks, like every other material on the page.
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
  the lab's look; the chord form in the shader, with tone mapping; the
  stars' flags and order, the limit and look and their refusals, the
  rotation of the stars and the galactic pole). The
  lab's `globe-sky.smoke.spec.mjs` checks the pixels: the disc white and
  centred on the projected sun direction (black with the pass off), the
  glow falling off from 0.5° to 8°, and the Earth covering the sun behind
  it (the same pixels with the pass on and off); the procedural stars in
  space and not over the Earth; the sun's right ascension against the
  sidereal star frame.
