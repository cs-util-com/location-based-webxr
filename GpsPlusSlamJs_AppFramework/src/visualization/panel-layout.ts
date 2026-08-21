/**
 * Pure layout + hit-mapping for the in-world transport panel.
 *
 * The panel is a textured plane (a `CanvasTexture`) showing a play/stop button
 * and a horizontal progress bar. This module is the one place that knows *where*
 * those controls live on the panel — expressed as normalized rectangles in the
 * plane's UV space — so the same layout both draws the panel and decides what a
 * tap means. That keeps the interaction correct by construction and free of any
 * renderer: the view raycasts the panel, reads the hit UV, and asks
 * `hitToAction` what to dispatch.
 *
 * The result is a ready-to-dispatch `TransportAction` (`toggle` or `seek`) —
 * an earlier separate "intent" type was an identity mapping away from the
 * action union, so every caller re-wrote the same pass-through switch.
 *
 * UV convention matches `THREE.PlaneGeometry` intersection UVs: origin (0,0) is
 * the bottom-left of the front face, u → right, v → up.
 */

import { clamp01 } from './clamp.js';
import { contains, type Rect } from './panel-geometry.js';
import type { TransportAction } from './playback-transport.js';

export interface PanelLayout {
  /** Play/stop button hit area. */
  readonly button: Rect;
  /** Progress-bar track hit area (seek maps along its width). */
  readonly track: Rect;
}

/**
 * Default panel layout: a square-ish button on the left, a wide track to its
 * right, vertically centred. Kept disjoint so the button-first resolution in
 * `hitToAction` is unambiguous.
 */
export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  button: { x: 0.04, y: 0.25, w: 0.2, h: 0.5 },
  track: { x: 0.32, y: 0.38, w: 0.6, h: 0.24 },
};

/** The subset of transport actions a panel tap can produce. */
export type PanelTapAction = Extract<
  TransportAction,
  { type: 'toggle' | 'seek' }
>;

/**
 * Map a panel-local hit (u,v in [0,1]) to a transport action. The button is
 * resolved first; a track hit becomes a `seek` at the fraction along the track
 * width; anything else (panel padding/chrome) is `null` (no-op).
 */
export function hitToAction(
  uv: { readonly u: number; readonly v: number },
  layout: PanelLayout = DEFAULT_PANEL_LAYOUT
): PanelTapAction | null {
  if (contains(layout.button, uv.u, uv.v)) {
    return { type: 'toggle' };
  }
  if (contains(layout.track, uv.u, uv.v)) {
    return {
      type: 'seek',
      fraction: clamp01((uv.u - layout.track.x) / layout.track.w),
    };
  }
  return null;
}
