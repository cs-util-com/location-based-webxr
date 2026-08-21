# canvas-panel.ts

## Purpose

Small canvas-drawing helpers shared by in-world panel views: converting a
normalized UV rect to canvas pixels, and beginning a radius-clamped
rounded-rect path. View-layer (touches a `CanvasRenderingContext2D`) but
framework-free otherwise.

## Public API

- **`toPx(rect: Rect, canvasW: number, canvasH: number): { x, y, w, h }`** —
  converts a UV rect (origin bottom-left, per `PlaneGeometry` convention) to a
  canvas pixel rect (origin top-left) for a canvas of the given size.
- **`roundRect(ctx, x, y, w, h, r): void`** — begins a rounded-rectangle path
  on `ctx` (caller fills/strokes it). `r` is clamped so it never exceeds half
  of the shorter side.

## Invariants & assumptions

- `toPx` flips the Y axis (UV origin bottom-left → canvas origin top-left).
- `roundRect` only opens the path; it does not fill or stroke.

## Examples

```ts
import { toPx, roundRect } from 'gps-plus-slam-app-framework/visualization';

const px = toPx({ x: 0.04, y: 0.25, w: 0.2, h: 0.5 }, 512, 176);
roundRect(ctx, px.x, px.y, px.w, px.h, 22);
ctx.fill();
```

## Tests

- View-layer; no dedicated test file. Covered indirectly through the
  `transport-panel-view.ts` consumer that draws with it.
