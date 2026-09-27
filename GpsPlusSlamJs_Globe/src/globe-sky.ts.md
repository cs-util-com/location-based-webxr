# globe-sky.ts - the sky behind the globe

- Purpose: round-2 plan 2026-09-26-2055 M3e (round-3 plan 2026-09-27-0532
  §4 F). The sun as a disc with a soft glow, drawn in a BACKGROUND pass
  before the Earth. The stars (M3d) were meant to join this pass; they wait
  for the star catalogue's licence (round-2 plan §6 Q2), so the pass holds
  the sun alone.
- Public API:
  - `GLOBE_SKY` - `radius` (1, the sky sphere around its camera),
    `sunDiameterDeg` (0.533, the real sun's mean apparent diameter),
    `sunRadiance` (40, far above 1 so tone mapping draws the disc white),
    `glow` (1, the glow's strength at the disc's edge) and `glowWidthRad`
    (1.5°, where the glow has fallen to 1/e). The glow is a look: space has
    no air to scatter light; a lens and an eye do.
  - `createGlobeSky()` returns `{ scene, camera, uniforms, setSun(direction),
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
    - `render(renderer, view)`: syncs, then draws the sky. The caller
      clears first (with `autoClear` off) and draws its scene after.
  - `uniforms`: `uSunDirection` (unit), `uSunRadius` (radians),
    `uSunRadiance`, `uGlow`, `uGlowWidth`.
- Invariants & assumptions:
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
  the lab's look; the chord form in the shader, with tone mapping). The
  lab's `globe-sky.smoke.spec.mjs` checks the pixels: the disc white and
  centred on the projected sun direction (black with the pass off), the
  glow falling off from 0.5° to 8°, and the Earth covering the sun behind
  it (the same pixels with the pass on and off).
