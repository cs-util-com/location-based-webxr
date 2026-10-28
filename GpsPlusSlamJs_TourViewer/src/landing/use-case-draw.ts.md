# use-case-draw.ts

## Purpose

The drawing kit of the landing page's use-case pictures: the muted palette
of the real scene, the two looks that set the augmented layer apart, and
the small SVG pieces (cards, framed photos, anchors, trees, houses) the
pictures in `use-case-data.ts` are built from. Everything returns SVG
markup as a string, so the pictures render and test in node.

## Public API

- `type UseCaseTreatment = "route-light" | "true-colour"`,
  `USE_CASE_TREATMENTS` - the two looks:
  - `route-light` (shipped): the scene in paper tones; everything augmented
    drawn in the route ramp, with a soft route glow and a thin light outline.
  - `true-colour` (kept as the prototype page
    `public/prototypes/use-cases-true-colour/`): the scene desaturated and
    veiled; augmented things in their own colours, with the same glow and
    outline.
- `SCREEN_W` / `SCREEN_H` - 210 x 100, the screen's 21:10 drawing size.
- `ROUTE_RAMP` - five steps of the route colour, deep to pale; index 1 is
  `#cf4428` (`--map-route`). `AugTone` indexes it.
- `REAL` - the scene palette: every colour has a chroma (largest minus
  smallest RGB channel) of at most 48, against the route's 167.
- `chroma(hex)` - that measure; TypeError for anything not `#rgb`/`#rrggbb`.
- `augColour(t, natural, tone)` - `ROUTE_RAMP[tone]` in route-light,
  `natural` in true-colour; TypeError for a non-hex colour, RangeError for
  an unknown look.
- `card(t, { x, y, w, title, text?, lines?, size? })` - a white card with a
  route edge; title and text escaped with the framework's `escapeHtml`
  (deep import, `gps-plus-slam-app-framework/utils/escape-html`). Its height
  follows its content; it grows to an estimate of its text's width (0.6 em
  a glyph, about Verdana and a bold serif fallback) and moves left to stay
  on the screen, because SVG text cannot be measured without a DOM.
  RangeError without a width.
- `photo(t, { x, y, w, h, rot?, inner })` - a frame with `inner` drawn in a
  60 x 44 box (nested `<svg>`, `slice`), rotated about its centre.
- `anchor(x, y, rx)` - the dashed ring where a station stands; `stalk(x,
y1, y2)` - the line from a floating card down to it.
- `treatmentDefs(t)` - the filters a look needs, ids `uc-glow-<t>` (white
  outline by `feMorphology` dilate, route glow by blur) and, for
  true-colour, `uc-mute-<t>` (saturate 0.15).
- `screenLayers(t, scene, overlay)` - `<g class="uc-real">` (muted, plus
  a paper veil in true-colour), then `<g class="uc-aug">` with the glow.
- Scene pieces, always in `REAL` colours: `land(horizon)`, `hills(y)`,
  `tree(x, base, r)`, `conifer(x, base, h)`, `house(x, base, w, h)`,
  `bench(x, y, w)`.

## Invariants & assumptions

- The overlay is drawn after the scene: AR content sits over the camera
  image, so nothing real covers it.
- No ids except the filters, which `use-case-markup.ts` writes once per
  section; pictures share one document.
- Numbers are rounded to two decimals, so the markup is stable byte for
  byte. No randomness, no clock.

## Example

```ts
const overlay = card("route-light", {
  x: 80,
  y: 12,
  w: 60,
  title: "Clue 3 of 6",
});
const body = screenLayers("route-light", land(56) + tree(30, 84, 12), overlay);
```

## Tests

`use-case-draw.test.ts`: chroma, the colour mapping per look, escaping and
growth of cards, the photo's rotation, both looks' filters, the layer
order. The palette bound over every scene is held in
`use-case-data.test.ts`.
