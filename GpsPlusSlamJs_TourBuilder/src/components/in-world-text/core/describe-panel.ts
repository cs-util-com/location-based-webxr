/**
 * Pure "what to draw where" description for the text panel.
 *
 * Both rendering backends (Canvas and HTML-in-3D) consume this one model: the
 * Canvas backend draws it with 2D calls, the HTML backend positions elements at
 * the same pixel rectangles. Sharing this description is what keeps the two
 * backends identical (so the fallback is transparent) and deduplicated (jscpd),
 * and it is itself a pure, unit-testable function (plan R6).
 *
 * Pixel origin is top-left (canvas convention); text is drawn baseline-top, one
 * line every `lineHeightPx`.
 */

import { toPx } from "../../shared/canvas-panel.js";
import { computePagePanelLayout } from "./page-layout.js";
import type { ResolvedTextStyle } from "./text-style.js";

export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DrawLine {
  readonly text: string;
  readonly xPx: number;
  readonly yPx: number; // top of the line
}

export interface DrawButton {
  readonly rectPx: PxRect;
  readonly enabled: boolean;
}

export interface PanelDrawModel {
  readonly canvasW: number;
  readonly canvasH: number;
  readonly panelColor: string;
  readonly textColor: string;
  readonly accentColor: string;
  readonly mutedColor: string;
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly fontFamily: string;
  readonly lines: readonly DrawLine[];
  readonly prev: DrawButton;
  readonly next: DrawButton;
  readonly indicator: { readonly rectPx: PxRect; readonly text: string };
}

export function describePanel(
  page: readonly string[],
  style: ResolvedTextStyle,
  nav: {
    readonly canPrev: boolean;
    readonly canNext: boolean;
    readonly label: string;
  },
): PanelDrawModel {
  const { canvasW, canvasH } = style;
  const layout = computePagePanelLayout(style.planeH, style.floorPlaneH);
  const textRect = toPx(layout.text, canvasW, canvasH);
  const lines: DrawLine[] = page.map((text, index) => ({
    text,
    xPx: textRect.x,
    yPx: textRect.y + index * style.lineHeightPx,
  }));
  return {
    canvasW,
    canvasH,
    panelColor: style.panelColor,
    textColor: style.textColor,
    accentColor: style.accentColor,
    mutedColor: style.mutedColor,
    fontPx: style.fontPx,
    lineHeightPx: style.lineHeightPx,
    fontFamily: style.fontFamily,
    lines,
    prev: {
      rectPx: toPx(layout.prev, canvasW, canvasH),
      enabled: nav.canPrev,
    },
    next: {
      rectPx: toPx(layout.next, canvasW, canvasH),
      enabled: nav.canNext,
    },
    indicator: {
      rectPx: toPx(layout.indicator, canvasW, canvasH),
      text: nav.label,
    },
  };
}
