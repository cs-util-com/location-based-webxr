/**
 * Self-made indicator sprite assets for the image-indicator toggle.
 *
 * The PNGs are original simple shapes (no third-party icon downloads — the
 * demo site is public and the prototype's icon-site assets had unknown
 * licenses). The arrow points UPWARD and both are centered, per the
 * framework's `arrowSprite` contract (see wayfinding-hud.ts.md).
 *
 * Resolved via `new URL(..., import.meta.url)` so Vite fingerprints the
 * assets into the production bundle (a raw './src/...' string would 404
 * in build output — Prototype-2 precedent).
 */

export const ARROW_SPRITE_URL = new URL(
  "./assets/wayfinding-arrow.png",
  import.meta.url,
).href;

export const CIRCLE_SPRITE_URL = new URL(
  "./assets/wayfinding-ring.png",
  import.meta.url,
).href;
