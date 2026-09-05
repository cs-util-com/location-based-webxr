# indicator-assets.ts

- **Purpose:** exposes the URLs of the demo's two self-made indicator sprite SVGs (`assets/wayfinding-arrow.svg`, `assets/wayfinding-diamond.svg`) for the image-indicator toggle. Since the owner taste round of 2026-09-04 they are the design system's marker language: the catalog's world-annotation diamond, and a bare white chevron for the arrow.
- **Public API:**
  - `ARROW_SPRITE_URL: string` — bundle-resolved URL of the upward-pointing chevron sprite.
  - `CIRCLE_SPRITE_URL: string` — bundle-resolved URL of the diamond sprite (the framework option is still called `circleSprite`; it is the on-screen "target ahead" indicator, whatever its shape).
- **Invariants & assumptions:**
  - The arrow art points **upward** (12 o'clock) and both assets are centred in a square canvas — the framework's `arrowSprite`/`circleSprite` rotation/placement logic assumes it (`wayfinding-hud.ts.md`). Both files use `viewBox="-4 -4 72 72"` around the catalog's 64-unit drawing so the halo and the rotated corners are never clipped and the texture keeps a transparent border.
  - Both files carry `width="256" height="256"`: the framework loads them through `THREE.TextureLoader` (an `<img>` element), and an SVG without intrinsic size rasterises at the browser default. 256 px is above the sprite's on-screen size at the demo's defaults, so it is minified slightly rather than magnified.
  - The diamond's geometry is the catalog's `.diamond` verbatim (rect 10,10 44×44 rx 4 rotated 45° about 32,32; dot r 4.5); the chevron is a polyline 10,44 → 32,20 → 54,44 with round caps and joins. Stroke 2 (the system's `--line-strong`), dot stroke 0.5 (`--line`), halo `feDropShadow` 0 1 σ1 at 0.8 (`--halo-drop`).
  - The colour literals (`#fff`, `#f2971f`) are held to `--ink` / `--accent` in the canonical `design.css`, and the diamond's geometry to the catalog's first `.diamond`, by the webxr root's `tests/repo-config/design-accent-copies.test.js`. An SVG cannot use `var()`, which is why the guard exists.
  - Assets are original work — no license/provenance risk on the public demo site (plan decision D3 of the sprites plan; the design language is the repo's own).
  - `new URL(..., import.meta.url)` is the Vite-recognized asset pattern: dev serves the file, build fingerprints it. In node (vitest) it resolves to a `file://` URL, which the tests exploit to assert the files exist.
- **Examples:** `createWayfindingHud({ ..., arrowSprite: ARROW_SPRITE_URL, circleSprite: CIRCLE_SPRITE_URL })`.
- **Tests:** `indicator-assets.test.ts` (URL shape, distinctness, files exist on disk, intrinsic size attributes present); `playwright-tests/indicator-style.spec.js` (the toggle fetches the arrow SVG and the diamond's accent dot actually paints in the centre); the repo-config accent guard above.
