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
    `brightestMag` (-1.5), `maxMagLimit` (9: round-4 plan 2026-09-28-2105
    DEC-GL4-2; 7.5 before).
  - `generateStarField({ seed, magLimit })` → `{ count, directions,
magnitudes, colors }` (Float32Arrays; directions are unit vectors in the
    celestial frame, x to RA 0h, z to the north celestial pole). The
    cumulative count is `countAt6_5 x 10^(0.5 (m - 6.5))` over
    [-1.5, magLimit]: magnitudes are drawn by inverting that law; directions
    uniformly on the sphere (z uniform, longitude uniform); a slight colour
    per star, each channel in [0.6, 1], bluish or reddish around white.
    RangeError for a non-integer seed or a limit outside 0.5-9.
  - `packStarField(field)` -> `{ count, octahedral, magTint, magnitudes }`
    (DEC-GL4-2): the field packed for the GPU, 6 bytes a star instead of
    28, sorted brightest first. `octahedral`: the direction folded onto
    the octahedron as two signed normalised 16-bit values (worst error
    under 0.01°, property-tested); `magTint`: the magnitude as a byte over
    [brightestMag, maxMagLimit] (a step of 0.041 mag) and the colour's tint
    t (red minus blue is 0.6 t) as a byte over [-0.5, 0.5]; `magnitudes`:
    the decoded magnitudes, ascending, for counting what a limit draws.
  - `octahedralEncode(x, y, z)` / `octahedralDecode(u, v)`, `fromSnorm16`,
    `unpackMagnitude(byte)`: the packing's halves, the same as the star
    shader's decode.
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
- Counts and sizes (float32 at 28 bytes a star; packed at 6):
  - to 5.5: 1,581 stars;
  - to 6.5: 5,000 stars;
  - to 7.5: 15,811 stars, 443 KB float32, 95 KB packed (the default limit
    since DEC-GL4-1);
  - to 8.5: 50,000 stars, 1.40 MB float32, 0.30 MB packed;
  - to 9: 88,914 stars, 2.49 MB float32, 0.53 MB packed (what the sky
    pass generates, once, on the CPU at load; the limit is a uniform and
    a draw range, so changing it costs nothing to set, and a lower limit
    draws fewer points).
  - The real sky has about 9,100 stars to 6.5 and about 128,000 to 9 (the
    research findings 2026-09-28-2129 §2.9, from Sky2000); this law grows
    a little faster below 6.5 and a little slower above it.
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
