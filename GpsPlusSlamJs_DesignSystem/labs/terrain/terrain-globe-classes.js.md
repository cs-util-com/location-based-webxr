# terrain-globe-classes.js: style `globe-classes` (C2)

- Purpose: the globe round-5 plan's C2 (2026-10-01-0945 §3.3; the owner's
  core idea, feedback 2026-10-01-0936 §4): the globe imagery already
  loaded decides HOW MUCH of each land-cover class an imagery pixel holds
  (forest, grass, rock, snow, and water from the imagery's own water
  mask), and the relief decides WHERE inside the 2.45 km pixel each class
  goes (snow above the snow line, rock on steep slopes, forest below the
  tree line, water on flat ground). Lit by the sun term, through
  `terrainSunVisibility`, as the globe lights its pixels.
- Public API:
  - `LAND_CLASSES`: `["forest", "grass", "rock", "snow"]`, the order of
    every land weight vector (the shader's x, y, z, w).
  - `GLOBE_CLASSES`: the land prototypes (sRGB, read off the Alps'
    level-5 tile and checked by the smoke's per-class means), the water
    colour (a dark lake: the 2D-canvas decode loses the imagery's own
    colour under the mask), `widthDE` 12 (the colour kernel's width,
    CIE76), `floor` 0.05 (the least affinity), `waterFlatDeg` [1, 4] and
    `ratioRange` [0.4, 2.5].
  - `PROTOTYPE_LAB`, `PROTOTYPE_LINEAR`, `WATER_LINEAR`: the prototypes as
    the shader receives them.
  - `landClassWeights(landSrgb, widthDE?)`: exp(-ΔE² / 2 widthDE²) per
    prototype, normalised; wholly the nearest when every kernel vanishes.
    RangeError for a width that is not positive.
  - `classAffinities(point, o?)` -> `{ land, water }`: each class's
    affinity for a post, `floor` to 1, from style B's lines
    (`naturalWeights`, with its offsets `treeOffsetM`, `snowOffsetM`,
    `aspectSnowM`, `rockSlopeDeg`): forest (1 - meadow)(1 - rock slope),
    grass (1 - snow)(1 - rock slope), rock max(rock slope, scree, bare
    above the snow), snow, water 1 - smoothstep(1°, 4°, slope); at or
    below 0 m only water.
  - `classAlbedo({ land, water, point, o?, widthDE? })` -> `{ albedo, land,
water }`: the land colour scaled per channel (linear light) by the
    ratio of the fine to the coarse prototype mix (clamped), mixed toward
    the water colour by the fine water share; the fine weights returned.
  - `coarseClassColour(land, water)`: the imagery's land and water colour
    mixed in linear light by the mask: what a footprint should average to.
  - `globeClassesColour(input, light, intensity?)`: `sunLitColour` of the
    albedo.
  - `classSweep(region, settings)` -> per setting `{ label, posts, drift,
detail, shares }`: the footprint drift (CIE76 between the fine albedo's
    footprint mean and the coarse colour's, over the same posts), the detail (mean CIE76 of a
    post's albedo from the coarse colour) and the mean fine class shares.
  - `CLASS_SWEEP`: the sweep's settings, one threshold moved at a time:
    snow line ±300 / ±600 m, tree line ±400 m, rock slope 30-46°, colour
    width 6-24, floor 0.02-0.15.
- Invariants & assumptions:
  - Where every affinity is equal (a floor of 1), the fine weights are the
    coarse ones and the albedo IS the imagery's colour (a property test):
    any departure is the relief's doing.
  - The fine weights (land and water) sum to 1; the ratio is clamped, so a
    class can neither black out nor bleach a pixel.
  - NOT mean-preserving: a pixel's classes are redistributed by RELATIVE
    affinities, so a class welcome on few of the pixel's posts loses
    share over the footprint. `classSweep`'s drift measures it on the real
    relief and imagery (the smoke logs it per threshold).
  - The water share comes from the tiles' alpha (the globe's MODIS water
    mask), the land colour from the land pixels alone
    (`sampleImageryLand`): the lab's 2D-canvas decode returns black under
    the mask, which would darken every shore.
  - The detail has hue (unlike C1's luminance-only high-pass): snow is
    white and rock grey inside a pixel whose mean is a greyish green.
- Examples:

  ```js
  const { albedo } = classAlbedo({
    land: [0.42, 0.44, 0.4],
    water: 0,
    point: { heightM: 3200, gx: 0.1, gy: 0, smallM: 0, latDeg: 46.56 },
  });
  const colour = sunLitColour(albedo, sunLight(n, sun, { shadow: 0.8, svf }));
  ```

- Tests: `terrain-globe-classes.test.mjs` (the weights follow the colour
  and sum to 1; the affinities follow the lines and stay in floor-1; the
  albedo is the imagery with no preference, whitens high and greys steep,
  sends water to the flat posts; the sweep on a synthetic region) and
  `terrain-globe-classes.smoke.spec.mjs` (C2 at real Alps pixels against
  its reference; the region's per-class colours against the prototypes;
  a lake in the mask; the class-threshold sweep on the Alps and the Blue
  Ridge, logged).
