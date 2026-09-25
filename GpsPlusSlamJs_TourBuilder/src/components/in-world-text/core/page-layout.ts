/**
 * Pure layout + hit-mapping for the paginated text panel.
 *
 * The panel is a billboarded plane showing wrapped text with a footer bar that
 * holds a Prev button, a page indicator, and a Next button. This module owns the
 * one description of *where* those controls sit — normalized UV rectangles — so
 * the same layout both positions the pixels (via `describePanel`) and decides
 * what a tap means (`hitToPageIntent`). Interaction is therefore correct by
 * construction and identical across both rendering backends (plan D7).
 *
 * UV convention matches `THREE.PlaneGeometry` intersection UVs: origin (0,0) is
 * the bottom-left of the front face, u → right, v → up. The buttons are
 * deliberately large (≈0.17 m × 0.13 m on the default 0.6 m panel) so they are
 * comfortable tap / XR-ray targets (plan D6/D13).
 */

import { contains, type Rect } from "../../shared/panel-geometry.js";

export interface PagePanelLayout {
  readonly text: Rect; // wrapped-text area (upper region)
  readonly prev: Rect; // footer, left
  readonly indicator: Rect; // footer, centre ("2 / 5")
  readonly next: Rect; // footer, right
}

/** Footer band's height, as a fraction of the panel's *default* (fixed-
 *  aspect) height — the reference size the footer/buttons are pinned to. */
const FOOTER_HEIGHT_FRACTION = 0.34;
/** Button height, same reference as `FOOTER_HEIGHT_FRACTION`. */
const BUTTON_HEIGHT_FRACTION = 0.28;
/** Gap above the text rect, up to the canvas's top edge — same reference. */
const TOP_MARGIN_FRACTION = 0.04;

/**
 * The footer band's + top margin's combined physical height (metres) for a
 * panel whose default (fixed-aspect) height is `floorPlaneH` — i.e. how much
 * of *any* resolved panel height is fixed "chrome", with the remainder going
 * to the text rect. Shared with `resolveTextStyle` so the two stay in sync.
 */
export function chromeHeightM(floorPlaneH: number): number {
  return (FOOTER_HEIGHT_FRACTION + TOP_MARGIN_FRACTION) * floorPlaneH;
}

/**
 * Compute the page-panel layout for a panel whose height is `planeH`, given
 * `floorPlaneH` — that panel's own default (fixed-aspect) height for its
 * width (`ResolvedTextStyle.floorPlaneH`).
 *
 * The footer band (buttons + paddings) and the top margin have a *fixed
 * physical size*, taken from the panel's floor height rather than its
 * current (possibly grown) one — so a panel that grows taller to fit more
 * text does not grow its Prev/Next/indicator chrome along with it; all of
 * the growth goes to the text rect instead. The buttons are centred
 * vertically within the fixed-height footer band.
 */
export function computePagePanelLayout(
  planeH: number,
  floorPlaneH: number,
): PagePanelLayout {
  const footerFraction = (FOOTER_HEIGHT_FRACTION * floorPlaneH) / planeH;
  const buttonFraction = (BUTTON_HEIGHT_FRACTION * floorPlaneH) / planeH;
  const topMarginFraction = (TOP_MARGIN_FRACTION * floorPlaneH) / planeH;
  const buttonY = (footerFraction - buttonFraction) / 2;
  return {
    text: {
      x: 0.05,
      y: footerFraction,
      w: 0.9,
      h: 1 - footerFraction - topMarginFraction,
    },
    prev: { x: 0.04, y: buttonY, w: 0.28, h: buttonFraction },
    indicator: { x: 0.34, y: buttonY, w: 0.32, h: buttonFraction },
    next: { x: 0.68, y: buttonY, w: 0.28, h: buttonFraction },
  };
}

/** The layout at `planeH === floorPlaneH` — today's fixed-aspect default. */
export const PAGE_PANEL_LAYOUT: PagePanelLayout = computePagePanelLayout(1, 1);

export type PageIntent =
  { readonly type: "prev" } | { readonly type: "next" } | null;

/**
 * Map a panel-local hit (u,v in [0,1]) to a navigation intent. A Prev/Next hit
 * only fires when that direction is currently available (`nav`), so a tap on a
 * dimmed edge button is a no-op. A hit on the text/indicator/chrome → `null`.
 */
export function hitToPageIntent(
  uv: { readonly u: number; readonly v: number },
  nav: { readonly canPrev: boolean; readonly canNext: boolean },
  layout: PagePanelLayout = PAGE_PANEL_LAYOUT,
): PageIntent {
  if (nav.canPrev && contains(layout.prev, uv.u, uv.v)) {
    return { type: "prev" };
  }
  if (nav.canNext && contains(layout.next, uv.u, uv.v)) {
    return { type: "next" };
  }
  return null;
}

/**
 * Pure pagination: chunk wrapped lines into fixed-height pages.
 *
 * Runs after `wrapText` and drives the Prev/Next navigation. Framework-free and
 * unit-tested. Always returns at least one page (an empty input yields a single
 * empty page) so the panel — buttons, indicator, chrome — always has something
 * to render.
 */

/** Split `lines` into pages of at most `linesPerPage` lines each. */
export function paginate(
  lines: readonly string[],
  linesPerPage: number,
): string[][] {
  if (linesPerPage < 1) {
    throw new Error(`linesPerPage must be >= 1, got ${linesPerPage}`);
  }
  if (lines.length === 0) {
    return [[]];
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages;
}
