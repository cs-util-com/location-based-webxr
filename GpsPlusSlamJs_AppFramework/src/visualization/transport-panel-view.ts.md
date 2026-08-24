# transport-panel-view.ts

## Purpose

In-world transport-panel view (view layer): draws the play/stop button and
progress bar into a 2D canvas, wraps it in a `THREE.CanvasTexture`, and puts
it on a plane. This is the XR-safe approach to an overlay control — a DOM/CSS
overlay is unreliable in immersive WebXR — and the same canvas-texture
technique generalizes to richer in-world panel content. The _where_ of each
control comes from `panel-layout.ts`, so the pixels drawn here line up
exactly with the hit-mapping used for taps.

## Public API

- **`TransportPanel`** — `{ mesh: Mesh, redraw(state, id): void, dispose(): void }`.
  `redraw` repaints the canvas for the given state (the panel belongs to the
  given `id`, so it only draws when that clip's state is passed in).
- **`createTransportPanel(width: number, height: number, layout: PanelLayout = DEFAULT_PANEL_LAYOUT): TransportPanel`**.

## Invariants & assumptions

- Fixed backing-canvas resolution (`512×176`); `width`/`height` scale the
  world-space plane, not the canvas pixels.
- `redraw` fully clears and repaints the canvas each call — no incremental
  drawing.
- `dispose()` frees the geometry, material, and texture.
- Not unit-tested (glyph rendering is view-layer); the layout math and the
  progress fraction it reads are tested in `panel-layout.ts` /
  `playback-transport.ts`. Depends on `three`, `canvas-panel.ts`,
  `panel-geometry.ts`, `panel-layout.ts`, and `playback-transport.ts`.

## Examples

```ts
import { createTransportPanel } from 'gps-plus-slam-app-framework/visualization';

const panel = createTransportPanel(1.15, 0.4);
group.add(panel.mesh);
panel.redraw(state, billboardId);
```

## Tests

- Not unit-tested (canvas glyph rendering is view-layer); exercised manually
  via the consuming demo.
