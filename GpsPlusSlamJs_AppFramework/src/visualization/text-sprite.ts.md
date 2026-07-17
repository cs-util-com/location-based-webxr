# text-sprite.ts

## Purpose

Single shared CanvasTexture→SpriteMaterial→Sprite text-label implementation for in-scene text. Consumed by [gps-compass-cubes.ts](gps-compass-cubes.ts.md) (static glyph labels, default configuration) and [wayfinding-hud.ts](wayfinding-hud.ts.md) (dynamic distance labels: pill background, linear filters, explicit render order). Extracted per the graduation plan `GpsPlusSlamJs_Docs/docs/2026-07-17-0756-wayfinding-hud-framework-graduation-plan.md` (slice 1).

## Public API

### `createTextSprite(options?: TextSpriteOptions): TextSprite`

`TextSpriteOptions` (all optional):

- `text` — initial label text (default `''`).
- `canvasWidth` / `canvasHeight` — canvas backing store in px (default `64`×`64`).
- `font` — CSS font shorthand (default `'bold 48px sans-serif'`).
- `textColor` — text fill style (default `'#ffffff'`).
- `background` — `'none'` (default, transparent) or `'pill'` (rounded semi-transparent black capsule redrawn behind the text; falls back to a square-cornered rect on engines without `ctx.roundRect`).
- `depthWrite` / `transparent` — forwarded to the `SpriteMaterial` when set; otherwise three.js material defaults apply. `depthTest` is always `false` (HUD/label semantics).
- `linearFilters` — set `LinearFilter` min/mag on the texture (default `false`).
- `renderOrder` — `Sprite.renderOrder` (default `0`).
- `scale` — initial `sprite.scale` as `{x,y,z}` (default three.js `(1,1,1)`).

Returns `TextSprite`:

- `sprite: THREE.Sprite` (readonly) — attach to the scene graph yourself; the helper never parents it.
- `setText(text)` — change-detection redraw: identical text is a no-op (no canvas redraw, no GPU texture upload), changed text clears, optionally re-draws the pill, draws centered text, and bumps `texture.needsUpdate`.
- `dispose()` — disposes the sprite material and the canvas texture. Consumers that tear down whole subtrees via `disposeObject3D` (compass cubes) may rely on that traversal instead.

## Invariants & Assumptions

- Tolerates a `null` 2D context (jsdom/headless without a canvas backend): sprite creation, `setText`, and `dispose` stay safe; only pixels are skipped.
- Text is always drawn centered (`textAlign: center`, `textBaseline: middle`) at the canvas midpoint.
- The initial `text` is drawn at construction through the same change-detection path (`''` draws nothing meaningful but is safe).
- Per-frame callers MUST go through `setText` — that is what makes unchanged labels free.

## Examples

```ts
// Compass-style static glyph (defaults):
const { sprite } = createTextSprite({ text: 'N' });
sprite.position.set(0, 0.15, 0);
mesh.add(sprite);

// HUD-style dynamic distance label:
const label = createTextSprite({
  canvasWidth: 256,
  canvasHeight: 128,
  font: 'bold 48px Arial, sans-serif',
  background: 'pill',
  depthWrite: false,
  transparent: true,
  linearFilters: true,
  renderOrder: 1000,
  scale: { x: 0.4, y: 0.2, z: 1 },
});
camera.add(label.sprite);
label.setText('12.3 m'); // redraws only on change
label.dispose();
```

## Tests

- `text-sprite.test.ts` — construction defaults (compass parity) and HUD configuration, initial draw, null-context safety, change-detection redraw (texture version bumps only on change), clear-before-redraw, pill drawing + `roundRect` fallback, dispose of material+texture.
- Consumer coverage: `gps-compass-cubes.test.ts` pins label naming/hierarchy and traversal-based disposal through this helper.
