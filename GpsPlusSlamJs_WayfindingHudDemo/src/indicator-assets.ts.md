# indicator-assets.ts

- **Purpose:** exposes the URLs of the demo's two self-made indicator sprite PNGs (`assets/wayfinding-arrow.png`, `assets/wayfinding-ring.png`) for the image-indicator toggle.
- **Public API:**
  - `ARROW_SPRITE_URL: string` — bundle-resolved URL of the upward-pointing arrow sprite.
  - `CIRCLE_SPRITE_URL: string` — bundle-resolved URL of the ring sprite.
- **Invariants & assumptions:**
  - The arrow art points **upward** (12 o'clock) and both assets are centered — the framework's `arrowSprite`/`circleSprite` rotation/placement logic assumes it (`wayfinding-hud.ts.md`).
  - Assets are original work (generated simple shapes in the HUD tint `#ff3b30`) — no license/provenance risk on the public demo site (plan decision D3).
  - `new URL(..., import.meta.url)` is the Vite-recognized asset pattern: dev serves the file, build fingerprints it. In node (vitest) it resolves to a `file://` URL, which the tests exploit to assert the files exist.
- **Examples:** `createWayfindingHud({ ..., arrowSprite: ARROW_SPRITE_URL, circleSprite: CIRCLE_SPRITE_URL })`.
- **Tests:** `indicator-assets.test.ts` (URL shape, distinctness, files exist on disk).
