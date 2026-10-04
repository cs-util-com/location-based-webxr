# terrain-style.js: style A "Pastel atlas", the shader's reference

- Purpose: the colours and shading of style A (terrain plan 2026-09-27-0605
  §4 "Styles"; research 2026-09-27-0600 §6.1), as plain functions the shader
  in `terrain-material.js` mirrors line for line.
- Public API:
  - `PASTEL_ATLAS`: the land stops (0 m cream `#F3F0E4` to 5000 m
    `#F8F8F5`), the sea (`#AFCFE3` to `#9CC3DB` at -200 m), the relief green
    (`#C2DCAE`, R0 40 m, R1 220 m, amount 0.7), the shadow (0.45,
    `#5E7280`), the highlight (0.15, `#FFFDF4`), the sky view's darkening
    (0.25), the small-relief detail (0.1) and the lights' altitude (45°).
  - `LUT` `{ size: 256, maxM: 5000 }` and `rampLut(stops)`: RGBA bytes,
    each texel the ramp at its centre's height.
  - `LIGHT_AZIMUTHS_DEG` `[225, 270, 315, 360]`.
  - `NO_DATA_COLOURS`: the hatch where a post had no data.
  - `hexToRgb(hex)`, `smoothstep(e0, e1, x)` (GLSL's; the design system's
    one copy under DEC-H3), `rampColour(stops, h)`,
    `greenWeight(spread, style?)`, `landColour(style, h, spread)`,
    `waterColour(style, h)`.
  - `multidirectionalShade(gx, gy, gain?, altitudeDeg?)`: Mark 1992's four
    lights weighted by sin²(aspect - azimuth), halved; each light's term is
    normalised by its height, so flat ground is exactly 1.
- Invariants & assumptions:
  - Colours are sRGB 0-1 and the lab draws them as they are (no tone
    mapping), as a printed map; the smoke holds a rendered flat pixel to
    `landColour` within 2 levels.
  - The stops are the research's designs, a starting point to tune by eye
    against the owner's screenshots, not a measurement.
  - The green follows local relief, not height: the screenshots' greens are
    probably forest, which tracks rugged land (research §2.4).
- Tests: `terrain-style.test.mjs`: every stop exactly, linear between and
  clamped outside, rising stops, the LUT at texel centres, the green's ends,
  its monotonicity, the R0 sweep (20/40/100 m against a 70 m spread), the
  mix, the sea's ends, and the shade: 1 when flat, lit on a north-west face
  and shaded on a south-east one, and further from 1 as the slope steepens.
