# labs/globe/globe-atmosphere.js - the atmosphere seen from space

- Purpose: round-4 plan 2026-09-28-2105 DEC-GL4-4 (the owner's reference:
  a bright white-cyan band just inside the lit limb, a soft blue halo just
  outside it, only where the sun shines, and a blue veil over the day side)
  and DEC-GL4-11 (the rim as wide as in the reference by default, a
  thickness slider back down to the physical width). One full-screen pass,
  drawn after the Earth, marches each pixel's ray through the framework's
  PHYSICAL atmosphere, reusing its transmittance and multi-scattering
  tables (`/fw/visualization/atmosphere/`), which depend on neither the
  camera nor the sun, so they are built once. The limb, the halo, the fade
  across the terminator and the veil all come out of the same march.
  Chosen over a fresnel rim shell on the research's recommendation A (a
  shell's width is a fixed fraction of the radius, too thick close up,
  with guessed colours).
- Public API: `createGlobeAtmosphere(renderer, [a, b, c])` (the ellipsoid's
  radii in metres) returns:
  - `supported` - false where float colour buffers cannot be rendered to
    (then `render` does nothing);
  - `look` - a copy of `{ steps, strength, thickness }`;
  - `setLook(partial)` - any of them (`globe-atmosphere-frame.js`
    `atmosphereLook`: RangeError outside steps 2-64, strength 0-4,
    thickness 1-10); a new step count recompiles the march;
  - `render(camera, { worldFromEcef, sunEcef, sunIntensity })` - draws the
    pass over the current frame (the lab calls it after the Earth).
    `worldFromEcef` is the tiles group's world matrix (the ECEF frame's
    placement, identity in the lab), `sunEcef` a unit vector,
    `sunIntensity` the Earth's sun light's, so the air is lit by the same
    sun as the ground;
  - `dispose()`.
- Invariants & assumptions:
  - The frame: ECEF metres are scaled per axis so the WGS84 ellipsoid IS
    the model's ground sphere (6360 km); the top is 100 km above it times
    the thickness. Rays stay straight under the affine map, so the top and
    the ground are hit analytically; a ray that misses the top is discarded
    at once (space costs almost nothing).
  - Thickness k: the shell is drawn k times thicker at the SAME optical
    depth (a sample at altitude h reads the air at h / k and its step
    counts 1 / k), so the colours and the terminator do not change with
    it; only the band and the halo widen (DEC-GL4-11).
  - The march: `steps` samples between where the ray enters the air and
    where it leaves it or meets the ground, packed quadratically towards
    the ray's point nearest the centre from both sides (at the limb the
    densest air; for a ray to the ground, the ground end). Each sample:
    the medium, the sun's transmittance and the multi-scattering from the
    tables, Rayleigh and Mie phases, as the framework's own sky-view march.
  - The blend: premultiplied in-scattered light plus what lies behind
    times the ray's transmittance (one grey value, the mean over R, G, B;
    a per-channel veil needs the ground's own shader). Rays into space keep
    space (transmittance 1). The light is tone mapped (Neutral, as the
    Earth) and sRGB-encoded before it is added over the already encoded
    Earth: an approximation (exact would be one HDR target for both),
    accepted for a look judged by eye; it is exact over black space and
    dark sea.
  - Light: the tables hold radiance for a sun of 1000 (the framework's
    radiance scale); the pass multiplies by the sun's intensity / 1000 and
    the strength.
  - The camera ray comes from the view's inverse projection and one 3x3
    (camera rotation, world to ECEF, ECEF to the model's axes); the camera
    position is converted to km on the CPU in double precision.
  - No context-loss handling: after a restored WebGL context the tables
    are not rebuilt (the lab has none either).
- Examples:

  ```js
  const atmosphere = createGlobeAtmosphere(
    renderer,
    [6378137, 6378137, 6356752.3],
  );
  atmosphere.setLook({ steps: 12 });
  // per frame, after renderer.render(scene, camera):
  atmosphere.render(camera, {
    worldFromEcef: globe.tiles.group.matrixWorld,
    sunEcef,
    sunIntensity: globe.sun.intensity,
  });
  ```

- Tests: `globe-atmosphere-frame.test.mjs` (the frame and the look's
  ranges). In the browser, `globe-atmosphere.smoke.spec.mjs`: the lit limb
  brighter inside and just outside, the night limb unchanged, the day side
  bluer, far space untouched, each against the pass off (floors swept
  x0.5-x2); the halo's falloff at both ends of the thickness slider; the
  banding per sample count against 64; the cost per sample count on both
  tiers and per pixel-ratio cap on the phone tier.
