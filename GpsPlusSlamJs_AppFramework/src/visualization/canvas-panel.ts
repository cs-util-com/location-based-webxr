/**
 * Small canvas helpers shared by the in-world panels' view layers.
 *
 * These are the medium-specific drawing primitives that both the transport panel
 * (component 1) and the paginated text panel (component 2) use to turn normalized
 * UV rectangles into pixels on a `CanvasTexture`. They are view-layer (they touch
 * a canvas context) but framework-free, and they live here so the two panels
 * share one definition instead of duplicating it (jscpd).
 */

import type { Rect } from './panel-geometry.js';

/**
 * Convert a UV rect (origin bottom-left, per the PlaneGeometry convention) to a
 * canvas pixel rect (origin top-left) for a canvas of the given size.
 */
export function toPx(
  r: Rect,
  canvasW: number,
  canvasH: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: r.x * canvasW,
    y: (1 - (r.y + r.h)) * canvasH,
    w: r.w * canvasW,
    h: r.h * canvasH,
  };
}

/**
 * Begin a rounded-rectangle path on `ctx` (the caller fills/strokes it). The
 * radius is clamped so it never exceeds half of the shorter side.
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}
