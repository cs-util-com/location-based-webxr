/**
 * Self-made indicator sprite assets for the image-indicator toggle.
 *
 * Two SVG files that ARE the design system's marker language (owner taste
 * round 2026-09-04): the world-annotation diamond (`.diamond` in the catalog,
 * verbatim geometry: a 44 × 44 rect, rx 4, rotated 45°, ink stroke at the
 * system's 2 px, an accent centre dot, the halo drop shadow) and a bare white
 * chevron for the edge arrow ("just a roof, no shaft", same stroke and halo).
 * Both carry explicit `width`/`height` so the `<img>` the framework's
 * TextureLoader creates has an intrinsic 256 px size; a `viewBox` alone
 * would rasterise at the browser's default and blur.
 *
 * The arrow points UPWARD and both are centred, per the framework's
 * `arrowSprite` contract (see wayfinding-hud.ts.md). The colour literals
 * inside the files are held to `--accent` / `--ink` by the webxr root's
 * `tests/repo-config/design-accent-copies.test.js`, which also compares the
 * diamond's geometry with the catalog's.
 *
 * Resolved via `new URL(..., import.meta.url)` so Vite fingerprints the
 * assets into the production bundle (a raw './src/...' string would 404
 * in build output — Prototype-2 precedent).
 */

export const ARROW_SPRITE_URL = new URL(
  "./assets/wayfinding-arrow.svg",
  import.meta.url,
).href;

export const CIRCLE_SPRITE_URL = new URL(
  "./assets/wayfinding-diamond.svg",
  import.meta.url,
).href;
