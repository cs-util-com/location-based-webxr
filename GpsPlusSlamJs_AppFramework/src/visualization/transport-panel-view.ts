/**
 * In-world transport-panel view (view layer).
 *
 * Draws the play/stop button and the progress bar into a 2D canvas, wraps it in
 * a `THREE.CanvasTexture`, and puts it on a plane. This is the XR-safe approach
 * (a DOM/CSS overlay is unreliable in immersive WebXR — TASK §2.3.2); component
 * 2 will reuse the same canvas-texture technique for rich text. The *where* of
 * each control comes from panel-layout.ts, so the pixels drawn here line up
 * exactly with the hit-mapping used for taps.
 *
 * Not unit-tested (glyph rendering is view-layer); the layout maths and the
 * progress fraction it reads are tested in panel-layout / playback-transport.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { roundRect, toPx } from './canvas-panel.js';
import type { Rect } from './panel-geometry.js';
import { DEFAULT_PANEL_LAYOUT, type PanelLayout } from './panel-layout.js';
import {
  isPlaying,
  progressFraction,
  type TransportState,
} from './playback-transport.js';

export interface TransportPanel {
  readonly mesh: Mesh;
  /** Redraw the canvas for the given state (this panel belongs to `id`). */
  redraw(state: TransportState, id: string): void;
  dispose(): void;
}

const CANVAS_W = 512;
const CANVAS_H = 176;

function drawButtonGlyph(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  playing: boolean
): void {
  const b = toPx(rect, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#e9eef7';
  if (playing) {
    // Stop = filled square (centred, 56% of the button box).
    const s = Math.min(b.w, b.h) * 0.56;
    ctx.fillRect(b.x + (b.w - s) / 2, b.y + (b.h - s) / 2, s, s);
    return;
  }
  // Play = right-pointing triangle.
  const s = Math.min(b.w, b.h) * 0.62;
  const cx = b.x + (b.w - s) / 2;
  const cy = b.y + (b.h - s) / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx + s * 0.9, cy + s / 2);
  ctx.closePath();
  ctx.fill();
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fraction: number
): void {
  const t = toPx(rect, CANVAS_W, CANVAS_H);
  const radius = t.h / 2;
  // Track background.
  ctx.fillStyle = '#2a2f3a';
  roundRect(ctx, t.x, t.y, t.w, t.h, radius);
  ctx.fill();
  // Filled portion.
  ctx.fillStyle = '#4f8cff';
  roundRect(ctx, t.x, t.y, Math.max(t.h, t.w * fraction), t.h, radius);
  ctx.fill();
}

export function createTransportPanel(
  width: number,
  height: number,
  layout: PanelLayout = DEFAULT_PANEL_LAYOUT
): TransportPanel {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('2D canvas context unavailable for the transport panel');
  }
  // Bind a non-null const so the narrowing survives into the `redraw` closure.
  const ctx: CanvasRenderingContext2D = context;

  const texture = new CanvasTexture(canvas);
  const geometry = new PlaneGeometry(width, height);
  const material = new MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new Mesh(geometry, material);

  function redraw(state: TransportState, id: string): void {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    // Panel background.
    ctx.fillStyle = 'rgba(16, 19, 26, 0.88)';
    roundRect(ctx, 4, 4, CANVAS_W - 8, CANVAS_H - 8, 22);
    ctx.fill();

    drawButtonGlyph(ctx, layout.button, isPlaying(state, id));
    drawTrack(ctx, layout.track, progressFraction(state));
    texture.needsUpdate = true;
  }

  return {
    mesh,
    redraw,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
