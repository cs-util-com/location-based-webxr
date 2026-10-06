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
    sun as the ground; `skyShare` (0-1, default 1; RangeError outside)
    scales the light of the rays that miss the ground, so below the
    hand-over edge the ground sky (`globe-ground-sky.js`, F2b) takes the
    sky's pixels while the ground keeps the space pass's veil;
  - `dispose()`.
- Invariants & assumptions:
  - The frame: ECEF metres are scaled per axis so the WGS84 ellipsoid IS
    the model's ground sphere (6360 km); the top is 100 km above it times
    the thickness. Rays stay straight under the affine map, so the top and
    the ground are hit analytically; a ray that misses the top is discarded
    at once (space costs almost nothing).
  - Thickness k: the shell is drawn k times thicker (a sample at altitude
    h reads the air at h / k and its step counts 1 / k). That keeps a
    VERTICAL ray's optical depth but NOT a grazing ray's, which through a
    k times thicker layer holds only 1 / sqrt(k) of it (review B2; an
    earlier version of this file claimed the colours could not change,
    and measured, the halo's chromaticity moved 0.09-0.11 between k = 1,
    6 and 10). So each ray's steps are also weighted by
    `grazingCompensation` (`globe-atmosphere-frame.js`): Chapman's
    function at the two scale heights, normalised to 1 straight down
    (review m3), about sqrt(k) at the limb, Rayleigh and Mie each with its
    own scale height (the ozone absorption rides on Rayleigh's weight,
    although its profile is a layer about 25 km up, not an exponential
    one, so its compensation is approximate), taken at the ray's LOWEST
    point in the air: the
    limb's tangent point, the ground hit, or, from inside the shell, the
    camera when the ray climbs (review M1, `lowestPointMu`). Measured from
    inside: the sky from 150 km in the k = 6 shell matches the real air's
    from 25 km (k = 1) within 0.98-1.02 at 5-35 degrees above the level,
    against 1.41-1.72 with the limb's weight on climbing rays. Measured across k = 1, 6, 10 at
    the same fractions of the rim's width: the halo's chromaticity moves
    0.017-0.026 with it against 0.030-0.112 without (inside the disc
    0.015-0.034 either way, the ground behind differing). It also moves the
    limb's brightest point out of the ground's edge, as the physics says
    (the limb is brightest where a grazing ray's optical depth falls to
    about 1): a near-white plateau to about 30 km at k = 6 and 60 km at 10,
    then one fall-off, and no rise near the shell's top.
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
    dark sea. So the SCATTERING is physical, the final pixel is not
    (review B4): the air's light is composited in display space, which
    overstates it over bright land and clouds, and the ground is dimmed
    by one grey transmittance, not per channel.
  - Light: the tables hold radiance for a sun of 1000 (the framework's
    radiance scale); the pass multiplies by the sun's intensity / 1000 and
    the strength.
  - The camera ray comes from the view's inverse projection and one 3x3
    (camera rotation, world to ECEF, ECEF to the model's axes); the camera
    position is converted to km on the CPU in double precision.
  - The terminator's crossing (review B3, thickness 6, 17.7 km a pixel):
    where the terminator meets the edge the limb turns violet, about 5
    degrees of the edge wide, and dark (0-3 levels) from 5 degrees into
    the night. Measured 2026-09-30 with the B2 weighting: 27/16/45 just
    inside, 46/35/56 just outside (violet index 11 and 11). Since the
    lowest-point weighting with Mie on its own scale height (review M1/m3,
    2026-10-01): 33/21/51 inside, 74/48/74 outside (violet 12 and 26,
    luminance up to 55), and the halo just before the crossing is whiter
    (142/148/179 at 40 degrees on the lit side, was 110/140/177). A VISIBLE
    change: the spot is brighter and more violet just outside the edge.
    The rim spec holds it to this range with about a third of headroom. It is the twilight the tables describe: the
    grazing sun reddened by the air, scattered by blue-favouring
    Rayleigh. ACCEPTED and documented rather than tuned away (a spot, not
    a line along the night limb; no rim on the night side beyond it);
    the owner judges it by eye.
  - Cost (SwiftShader, frame time on / off, relative only; the phone's
    GPU is not measured): desktop x4.0 at 12 samples (x2.6 at 6, x6.6 at
    24); phone 412x915 at pixel ratio 1 / 1.5 / 2 x3.4 / x4.2 / x4.6 at 12
    and x2.8 / x3.4 / x3.9 at 8, hence 8 samples on a coarse pointer
    (review B5). With tiles loading at 30,15 the rim took the frame
    from 337 to 733 ms.
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
