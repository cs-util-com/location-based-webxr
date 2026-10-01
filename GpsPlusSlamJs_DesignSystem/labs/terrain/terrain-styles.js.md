# terrain-styles.js: styles B, D and E, and the style registry

- Purpose: the colours and rules of the terrain lab's styles B "Natural
  colour", D "Swiss classic" and E "Clay" (terrain plan 2026-09-27-0605 §4
  "Styles", DEC-TR-2, DEC-TR-6, milestone T2; research 2026-09-27-0600 §3
  and §6.2-§6.5), as plain functions the shader in `terrain-material.js`
  mirrors line for line, plus the list of all five styles.
- Public API:
  - `TERRAIN_STYLES`: `pastel` (A), `natural` (B), `globe` (C), `swiss`
    (D), `clay` (E), then the styles coloured from the globe imagery
    (globe round-5 §3.3, `terrain-globe-colour.js`): `globe-albedo` (C1),
    `globe-classes` (C2, `terrain-globe-classes.js`) and `globe-bands`
    (C3);
    each `{ id, letter, label }`, in the plate's order.
  - `SHADER_STYLE`: the shader's `uStyle` per style: A 0, B 1, D 2, E 3,
    C1 4, C3 5; C draws as A (0) with the far field on (`terrain-far-field.js`).
  - `treeLineM(lat)`, `snowLineM(lat)`: the research's latitude rules
    (tree line 3750 m below 30°, +130 m a degree from 50° to 30°, +75 m a
    degree from 70° to 50°; snow line 5000 m below 30°, 3000 m at 46°, 0 at
    70°), symmetric about the equator.
  - `NATURAL`: B's colours (lowland `#7F9860`, forest `#5F7D4A`, meadow
    `#A4A776`, scree `#B2A994`, rock `#9A9184`, light rock `#BDB6A8`, snow
    `#F5F7FA`, snow in shade `#C9D6E6`, sea `#7FB0CF` to `#4A7FA8` at
    -200 m) and rules (lines softened over +-150 m, meadow 300 m above the
    tree line, poleward snow 250 m full at a 0.5 slope, rock above 38° +-3°
    and on 20-30° slopes above the meadow, snow gone between 50° and 60°,
    the light at 315°/45°, the direct light's share 0.65, at most 1.3, the
    lift toward white 0.2).
  - `naturalWeights(point, offsets?)` -> the lines and the cover weights
    (`forest`, `meadow`, `scree`, `rock`, `bareAboveSnow`, `snow`);
    `naturalBaseColour(point, offsets?, style?, s = 1)` -> B's cover colour
    before any light or lift (`s` only cools snow in shade; C1's detail
    reads it at 1);
    `naturalColour(point, options?)` -> sRGB 0-1. A point is `{ heightM,
gx, gy, smallM, latDeg, svf? }`; the options are the hash's `tree`,
    `snow`, `aspect`, `rock`, `lift`, `shadow` and the view's `gain`.
  - `SWISS`: D's ramp (0 m `#B7C8B9` to 4000 m `#FAF8EE`), sea `#B9D3E0`,
    the exposure palette (lit `#FFF673`, shaded `#55967A`, left `#8FB28A`,
    right `#55967A`, flat `#CFE0A9`, full at a 0.5 horizontal normal),
    exposure 0.35, lowland contrast 0.4, shadow 0.6, sky view 0.25.
  - `exposureColour(nx, ny)`, `swissColour(point, options?)`.
  - `CLAY`: `#EDEAE4`, sea `#C9D8E0`, shadow 0.55 toward the neutral
    `#8C8C8C`, highlight 0.1 toward white, sky view 0.5, detail 0.2;
    `clayColour(h)`.
  - `singleLightShade(gx, gy, gain?, azimuth?, altitude?)`: one light,
    normalised by its height (flat ground exactly 1), never negative.
  - `shadeColour(base, s, svf, style)`: the shading A and E share (the
    shader's lines, for style E's saturation property).
  - `saturation(rgb)`: HSV saturation.
- Invariants & assumptions:
  - B's lines depend on the height in METRES and the TRUE slope only:
    neither the exaggeration nor the view's slope boost moves them (the
    smoke checks the line at E 1, 2 and 5).
  - B's small relief is the edge noise: a ridge counts as higher, so each
    line follows ridges and gullies instead of a contour. It is clamped to
    +-150 m (`edgeM`): unclamped, Alpine ridges (up to 420 m over their
    1 km surroundings at z8, measured in the smoke) put snow 400 m below
    the line. So on open ground every line has a band of +-300 m (the
    noise plus the softening); the aspect term moves the line itself.
  - D multiplies the ramp by the exposure colour's RATIO to its flat
    colour, so flat ground keeps the ramp ("higher is lighter") and only
    slopes turn warm (lit) or cool (shaded).
  - E's shading tint is neutral grey and its lift white, so no shade adds a
    hue (the property test and the smoke).
  - The colours are the research's designs, not measurements; the latitude
    rules are off by up to about 500 m, which is why B has offsets.
- Tests: `terrain-styles.test.mjs` (the research's own tree-line values,
  the snow-line anchors, continuity and symmetry; B's snow at +-400 m, the
  offsets, the aspect in both hemispheres, snow sliding off, no view
  parameter in the weights, the cover bands, the sea, the lift, a 0-1
  property over 2000 random inputs; D's palette at full tilts, flat ground
  equal to the ramp, "higher is lighter", lit warmer than shaded over 500
  random slopes, the lowlands' lower contrast; E's colours and its
  saturation property over 2000 random shades). In the browser:
  `terrain-styles.smoke.spec.mjs`.
