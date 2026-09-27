# globe-stars.ts - the globe's procedural stars

- Purpose: round-2 plan 2026-09-26-2055 M3d, owner decision 2026-09-27 on
  round-2 Q2: **procedural stars, not a catalogue.** No star catalogue with
  a clearly public-domain or attribution-only licence was found (the Yale
  Bright Star Catalogue states no licence at its sources; Hipparcos and
  Gaia are non-commercial; HYG is share-alike: the evidence is in the
  stream-F record `2026-09-27-0743-globe-sky-results.md` §2). So the field
  is generated in code from a seed, nothing is added to the committed
  assets (which are 99 % of their 4.5 MB budget), and the lab's credits
  line says the stars are procedural. It is a plausible sky, not the real
  one: no constellation is where it really is.
- Public API:
  - `GLOBE_STARS` - `seed` (one fixed sky), `countAt6_5` (5000),
    `brightestMag` (-1.5), `maxMagLimit` (7.5).
  - `generateStarField({ seed, magLimit })` → `{ count, directions,
magnitudes, colors }` (Float32Arrays; directions are unit vectors in the
    celestial frame, x to RA 0h, z to the north celestial pole). The
    cumulative count is `countAt6_5 x 10^(0.5 (m - 6.5))` over
    [-1.5, magLimit]: magnitudes are drawn by inverting that law; directions
    uniformly on the sphere (z uniform, longitude uniform); a slight colour
    per star, each channel in [0.6, 1], bluish or reddish around white.
    RangeError for a non-integer seed or a limit outside 0.5-7.5.
  - `greenwichSiderealAngleRad(ms)` - Greenwich mean sidereal time as an
    angle in [0, 2π) (the standard 1982 expression from J2000.0), matching
    the published reference values to 1e-7 rad. RangeError when non-finite.
  - `celestialToEcefQuaternion(θ, target?)` - the rotation about the pole
    by -θ: a star at right ascension θ lies on the Greenwich meridian.
    Precession and nutation (under half a degree since J2000) are left out.
  - `GALACTIC_NORTH_POLE`, `GALACTIC_CENTRE` - unit vectors (J2000, RA
    192.859° Dec +27.128°; RA 266.405° Dec -28.936°); the galactic plane is
    tilted 62.87° to the celestial equator. The sky pass draws the Milky
    Way band from them.
- Counts and sizes (one field, 28 bytes per star: position, magnitude,
  colour as float32):
  - to 5.5: 1,581 stars, 44 KB;
  - to 6.5: 5,000 stars, 140 KB (the default limit);
  - to 7.5: 15,811 stars, 443 KB (what the sky pass generates, once, on
    the CPU at load; the limit is a uniform, so changing it is free).
  - The real sky has about 9,100 stars to 6.5 (the Bright Star Catalogue);
    5,000 is the owner's "a few thousand".
- Invariants & assumptions: deterministic per seed (a pinned link shows the
  same sky); the generator is a small 32-bit seeded generator kept here
  (the one-liner per package rule: the globe package cannot reach the
  framework's test utilities).
- Example:

  ```ts
  const field = generateStarField({ seed: GLOBE_STARS.seed, magLimit: 6.5 });
  const q = celestialToEcefQuaternion(greenwichSiderealAngleRad(Date.now()));
  // a star's ECEF direction: new Vector3(...dir).applyQuaternion(q)
  ```

- Tests: `globe-stars.test.ts` (the same seed, the same sky; the counts at
  5.5 / 6.5 / 7.5 and within one field following 10^(0.5 m); uniform
  directions; the colour spread; the refusals; the galactic tilt; the
  sidereal angle against the reference values, and one turn per sidereal
  day; the rotation's meridian). The lab's `globe-sky.smoke.spec.mjs`: the
  stars in space and not over the Earth, and the sun's right ascension from
  the lab's sun and sidereal angle (0h at the March equinox, 6h at the June
  solstice).
