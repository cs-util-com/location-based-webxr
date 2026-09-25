/**
 * Pure style + sizing resolution for the in-world text panel.
 *
 * Turns the authorable `TextStyle` (fonts, colours, panel width in metres) into
 * a `ResolvedTextStyle` with concrete canvas pixels and plane metres. The panel
 * is a fixed-aspect box; `maxLinesPerPage` and the text wrap width are *derived*
 * from the text UV rect and the line height, so the visuals and the hit regions
 * (which share `PAGE_PANEL_LAYOUT`) always line up — a line that overflows the
 * box is paginated, never clipped.
 *
 * Pure arithmetic: no Three.js, no DOM.
 */

import { chromeHeightM, PAGE_PANEL_LAYOUT } from "./page-layout.js";

export interface TextStyle {
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly fontFamily: string;
  readonly panelColor: string; // panel background (semi-transparent, outdoors)
  readonly textColor: string; // body text
  readonly accentColor: string; // enabled Prev/Next buttons + indicator
  readonly mutedColor: string; // disabled (edge) buttons
  readonly maxWidthMeters: number; // physical panel width
  /**
   * Optional cap, in metres, on how tall the panel may grow to fit its text
   * (see `resolveTextStyle`'s `lineCount` param). Omitted → today's fixed 4:3
   * aspect, unconditionally.
   */
  readonly maxHeightMeters?: number;
  /**
   * Optional floor, in metres, on the panel height — e.g. to match the height
   * of the visual it sits beside. Applies even to short text; the extra
   * height goes to the text rect. `maxHeightMeters` wins if it is lower.
   */
  readonly minHeightMeters?: number;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontPx: 120,
  lineHeightPx: 168,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  panelColor: "rgba(16, 19, 26, 0.9)",
  textColor: "#e9eef7",
  accentColor: "#4f8cff",
  mutedColor: "#39424f",
  maxWidthMeters: 0.6,
};

export interface ResolvedTextStyle extends TextStyle {
  readonly canvasW: number;
  readonly canvasH: number;
  readonly planeW: number; // metres
  readonly planeH: number; // metres
  /** This panel's default (fixed-aspect) height for its width — the floor
   *  `planeH` never shrinks below, and the reference size the page-layout
   *  footer/button chrome is pinned to (`computePagePanelLayout`). */
  readonly floorPlaneH: number;
  readonly wrapWidthPx: number; // max line width fed to wrapText (with safety margin)
  readonly maxLinesPerPage: number; // derived from the text rect height / line height
}

/** Fixed 4:3 texture — crisp at ~1.5 m and cheap to re-raster. */
const CANVAS_W = 1024;
const CANVAS_H = 768;
/** Wrap slightly narrower than the text box so `measureText`↔CSS metric drift
 *  degrades to a hidden sub-pixel rather than an overflow/clip (plan R4). */
const WRAP_SAFETY = 0.95;

/**
 * Resolve a `TextStyle` into concrete canvas/plane dimensions.
 *
 * `lineCount` — the number of wrapped lines the current text produces at this
 * style's `wrapWidthPx` (independent of panel height, so callers can wrap
 * once and pass the result here) — only matters when `style.maxHeightMeters`
 * is also set; otherwise the panel keeps its fixed 4:3 aspect regardless.
 * When both are given, the panel grows past its default (fixed-aspect)
 * height to fit `lineCount` lines, capped at `maxHeightMeters`. The canvas
 * pixel height scales with the plane height at the same px/metre density as
 * the (always fixed) width, so growing never stretches text or buttons.
 */
export function resolveTextStyle(
  style: TextStyle,
  lineCount?: number,
): ResolvedTextStyle {
  const planeW = style.maxWidthMeters;
  const floorPlaneH = planeW * (CANVAS_H / CANVAS_W);
  const pxPerMetre = CANVAS_W / planeW;
  const textRectWidthPx = PAGE_PANEL_LAYOUT.text.w * CANVAS_W;
  // The footer/top-margin chrome (page-layout.ts) has a fixed physical size
  // pinned to floorPlaneH; every metre above that goes entirely to the text
  // rect, so this is the one place both the growth math below and
  // maxLinesPerPage need to agree on.
  const chromeM = chromeHeightM(floorPlaneH);

  let planeH = Math.max(floorPlaneH, style.minHeightMeters ?? 0);
  if (style.maxHeightMeters !== undefined && lineCount !== undefined) {
    const desiredTextHeightM =
      (Math.max(1, lineCount) * style.lineHeightPx) / pxPerMetre;
    planeH = Math.min(
      Math.max(chromeM + desiredTextHeightM, planeH),
      style.maxHeightMeters,
    );
  }

  const canvasH = Math.round(planeH * pxPerMetre);
  const textRectHeightPx = (planeH - chromeM) * pxPerMetre;
  return {
    ...style,
    canvasW: CANVAS_W,
    canvasH,
    planeW,
    planeH,
    floorPlaneH,
    wrapWidthPx: textRectWidthPx * WRAP_SAFETY,
    maxLinesPerPage: Math.max(
      1,
      Math.floor(textRectHeightPx / style.lineHeightPx),
    ),
  };
}
