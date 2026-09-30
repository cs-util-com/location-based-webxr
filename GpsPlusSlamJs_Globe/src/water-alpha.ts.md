# water-alpha.ts - the imagery tiles' water alpha

- Purpose: the alpha byte the hand-run `scripts/fetch-globe-assets.mjs`
  writes into each Blue Marble tile (round-4 plan 2026-09-28-2105
  DEC-GL4-6), which the surface shader reads as the water mask
  (`globe-surface-material.ts`: `globeWater = 1 - alpha`, the glint's
  roughness). A pure function, so the hand-run script's rule is
  unit-tested.
- Public API:
  - `WATER_MAX_BRIGHTNESS` (55): water is darker than this in every
    channel (8-bit sRGB of the lossless source).
  - `waterAlpha(mask, imagery, count)` → `Uint8Array` of `count` bytes,
    0 on water and 255 on land. `mask` is GIBS's `MODIS_Water_Mask` tile as
    RGBA (water opaque cyan, land transparent or opaque black), `imagery`
    the Blue Marble tile as RGB, both cut to the same box.
  - Errors: `Error("mask pixel <p> is r,g,b,a")` for any other mask colour
    (a GIBS style change must fail the fetch, not draw a wrong coast);
    `RangeError` when `count` is not a non-negative integer or a buffer does
    not hold `count` pixels.
- Invariants & assumptions:
  - Water = the mask's water AND the imagery's dark sea. The rule only ever
    takes water away from the mask; it never adds water on the mask's land
    (property test).
  - Why the colour: the mask and the imagery disagree by up to a texel at
    the coast. Along the Namib coast (tile 4/17/10, row 34) the mask marked
    the mixed sea-and-sand pixel (luminance 100, the sea 8-20) as water, so
    a whole 4.5 km texel of sand glinted: 41 levels 5 km inland in the coast
    smoke at 50 km up, after the 2048 px global mask was already gone.
  - The limit barely matters: over levels 3-5 of the cached sources the
    rule turns 3.40 % (at 90), 3.46 % (70), 3.56 % (55) and 3.88 % (40) of
    the mask's water to land. At level 4, beyond 55° latitude 5.98 % (sea
    ice, bright; ice should not glint as water either), elsewhere 0.48 %
    (mixed coastal pixels, turbid water). The research's second condition
    (blue at least red) is not used: it turned a further 0.59 % of
    mid-latitude water to land, dark water that should glint.
  - Measured on the August 2004 Blue Marble month GIBS serves; another
    month's sea ice would move the polar share, not the coasts.
- Example: a mask pixel `[0, 255, 255, 255]` over imagery `[8, 12, 20]` is
  `0` (water); over `[120, 98, 70]` it is `255` (land).
- Tests: `water-alpha.test.ts` (water, land, the Namib mixed pixel, the
  limit's edge per channel, a foreign mask colour, bad buffers) and
  `water-alpha.property.test.ts` (any tile: binary, exactly mask AND
  colour). End to end: `GpsPlusSlamJs_DesignSystem/labs/globe/globe-coast.smoke.spec.mjs`.
