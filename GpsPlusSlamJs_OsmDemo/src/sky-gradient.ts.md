# `sky-gradient.ts`

## Purpose

The sky's vertical colour ramp, as RGBA pixel rows. Pure arithmetic — no `three`,
no GPU.

## Public API

- `skyGradientPixels(rows = SKY_GRADIENT_ROWS): Uint8Array` — RGBA, **top row
  first**, fully opaque. Throws `RangeError` for fewer than 2 rows or a
  non-integer.
- `SKY_GRADIENT_ROWS` (64), `ZENITH_RGB`, `HORIZON_RGB`.

## Invariants & assumptions

- **Top row first.** This is the contract the tests assert, chosen because it is
  the intuitive reading. It is **not** what `THREE.DataTexture` wants: `flipY`
  defaults to `false` there (unlike an image-backed texture), so row 0 lands at
  `v = 0`, which on an equirectangular map is the **nadir**. `building-view.ts`
  sets `flipY = true` to correct it — the three.js quirk is deliberately kept out
  of this file.
  - Measured before that fix: 63.5 luma overhead against 52.9 near the horizon,
    i.e. precisely inverted. An upside-down sky reads as a stylistic choice, not a
    bug, which is why the orientation has its own test.
- **Monotonically brighter towards the horizon.** A band partway up reads as a
  light source in the sky rather than as a broken ramp.
- **Always fully opaque.** A translucent sky composites against the canvas clear
  colour — the near-black this replaces — so the bug would present as "the change
  did nothing".
- **The horizon is clearly lighter than the ground** (`0x3a4356`), by design and by
  test. That is what makes the ground plane's far edge read as a silhouette rather
  than as a seam between two similar darks, which was the second half of the
  reported complaint.
- **Desaturated on purpose.** It sits behind a grey city and a heat-coloured hex
  grid; a vivid sky would compete with the ramp the demo exists to read.
- **No fog anywhere.** Offered and rejected (DEC-R2-2): fog would have concealed
  finding R2-9 — distant buildings standing on fabricated, striped terrain —
  instead of surfacing it.

## Examples

```ts
const sky = new THREE.DataTexture(
  skyGradientPixels(),
  1,
  SKY_GRADIENT_ROWS,
  THREE.RGBAFormat,
);
sky.mapping = THREE.EquirectangularReflectionMapping;
sky.flipY = true; // see the invariant above
scene.background = sky;
scene.environment = sky; // also what makes the ground's specular read
```

## Tests

`sky-gradient.test.ts` — orientation, monotonicity, opacity, the
horizon-vs-ground contrast margin, and the degenerate-row guard. Each targets one
of the three ways a gradient goes wrong while still looking deliberate on screen.
The e2e _"has a graded sky, so the ground reads against it"_ asserts the gradient
survives to the canvas, sampling at the left edge where no building reaches.
