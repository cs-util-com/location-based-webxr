/**
 * Scroll-linked copy color (round-14 R14-4): highlight words (amber GPS,
 * red anchors, AR blue, …) START colorless as their copy block fades in
 * at the BOTTOM of the screen and reach FULL color only as the block
 * rises toward the TOP — timed to the matching 3D beat during the camera
 * journey, so the reader asks "why is that word colored?".
 *
 * This module is the PURE driver: from a copy element's top position (in
 * viewport pixels) it returns a 0→1 `strength` that main.ts writes to the
 * element's `--hl-strength` CSS var; the CSS lerps each highlight from
 * `--text` to its target color by that strength. Bands are expressed as
 * FRACTIONS of the viewport height, so the timing is viewport-independent
 * (portrait phone vs desktop) — the same lesson as the piecewise
 * scroll→timeline mapping.
 */

import { clamp01 } from "./clamp01";

export interface ColorBands {
  /** Element-top fraction of the viewport at/below which strength is 0
   * (the block has just faded in near the bottom). */
  readonly start: number;
  /** Element-top fraction at/above which strength is 1 (full color;
   * the block has reached the top band). */
  readonly full: number;
}

const DEFAULT_BANDS: ColorBands = { start: 0.85, full: 0.2 };

/**
 * Highlight color strength (0..1) for a copy element whose top edge sits
 * `topPx` pixels below the viewport top, on a viewport `viewportHeight`
 * px tall. 0 = colorless (block low on screen), 1 = full color (block in
 * the top band). Non-finite input yields 1 (full color) so a broken
 * layout read never flashes the copy colorless.
 */
export function scrollColorStrength(
  topPx: number,
  viewportHeight: number,
  bands: ColorBands = DEFAULT_BANDS,
): number {
  if (
    !Number.isFinite(topPx) ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return 1;
  }
  const startPx = bands.start * viewportHeight;
  const fullPx = bands.full * viewportHeight;
  if (topPx >= startPx) {
    return 0;
  }
  if (topPx <= fullPx) {
    return 1;
  }
  return clamp01((startPx - topPx) / (startPx - fullPx));
}
