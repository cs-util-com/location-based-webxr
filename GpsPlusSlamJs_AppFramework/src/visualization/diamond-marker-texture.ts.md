# `diamond-marker-texture.ts`

- Purpose: the drawer behind `diamond-entrance.ts`'s seam - paints the
  design system's diamond at one `DiamondEntranceState` into a canvas that
  a `THREE.CanvasTexture` uploads, so a HUD sprite can show the build-up.
  Geometry is the demo's `wayfinding-diamond.svg` verbatim (the catalog's
  `.diamond`). Plan:
  [2026-09-05-2138 HUD diamond entrance animation](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md)
  (M2).
- Public API:
  - `createDiamondMarkerTexture({ size?, ink, accent, halo? }) →
DiamondMarkerTexture` - `size` a positive integer (default 256, the
    SVG's raster size), `ink` / `accent` / `halo` non-empty CSS colours
    (`halo` defaults to `DEFAULT_DIAMOND_HALO`, the SVG's black at 0.8).
    Throws `TypeError` / `RangeError` at creation, never per frame.
  - `DiamondMarkerTexture.texture` - sRGB-tagged `CanvasTexture`, nothing
    drawn until the first `apply`.
  - `apply(state): boolean` - redraws ONLY when `state` differs from the
    last state drawn (compared field by field), sets `needsUpdate` only
    then, returns whether it redrew. `false` without a 2D context and after
    `dispose`.
  - `lastDrawMs` - wall-clock milliseconds of the last redraw (0 before
    the first or where `performance` is absent); the demo's on-device
    readout reads it.
  - `dispose()` - releases the texture; idempotent.
  - `DIAMOND_GEOMETRY` - the SVG's numbers (viewBox 72 from −4, rect 10/44/
    rx 4 rotated 45° about 32, dot r 4.5, strokes 2 and 0.5, halo blur 2 /
    offset 1); `DEFAULT_DIAMOND_HALO`.
- Invariants & assumptions:
  - Two canvases: the shapes on a scratch canvas WITHOUT shadow, then one
    `drawImage` onto the texture canvas WITH the shadow triple (`halo`,
    blur `2·s`, offsetY `1·s`, `s = size / 72`) - one group shadow, as the
    SVG's `feDropShadow` on the `<g>`; the dot never shadows the outline.
  - The transform is `translate(4·s, 4·s); scale(s)`: the viewBox starts at
    −4, and a bare scale lands the marker 14 px up-left at 256.
  - The dash is `[180, 180]` with offset `180 · (1 − outline)` - the
    seam's contract; the dot is skipped entirely while `dot` is 0 and is
    scaled AND faded by `dot` otherwise.
  - `roundRect` is used where present and replaced by an `arcTo` path
    elsewhere (Chrome 99 / Safari 16 have it; the Quest Browser does).
  - A null 2D context (jsdom) is tolerated: the texture exists, `apply`
    returns false, `dispose` is safe - the `text-sprite.ts` contract, and
    what the HUD's jsdom tests rely on.
  - Cost: the plan's spike measured ≈ 0.04 ms per redraw at 256 px on
    desktop Chromium (amortised, GPU-accelerated); the Quest number is the
    owner's on-device read.
- Example:

  ```ts
  const marker = createDiamondMarkerTexture({ ink: '#fff', accent: '#f2971f' });
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: marker.texture, transparent: true })
  );
  marker.apply(computeDiamondEntrance(elapsedMs)); // true while animating, false once settled
  ```

- Tests: `diamond-marker-texture.test.ts` (jsdom, a per-canvas recording
  context: the transform order, the dash offsets at 0 / 0.5 / 1, the dot
  skipped and then drawn at r 4.5, the half-popped dot, the single shadowed
  `drawImage` on the texture canvas and none on the scratch one, the
  scaled shadow and a custom halo, the `arcTo` fallback, `needsUpdate` once
  per changed state, the sRGB tag and draw time, the null-context path,
  idempotent dispose, the validation throws, the geometry constants).
