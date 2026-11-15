/**
 * A pin's label as every view of a tour draws it: the framework's text
 * sprite on a pill, one recipe for the phone's AR (through `seams.ts`) and
 * the desktop editor's 3D view, so a pin reads the same in both.
 *
 * The canvas is as wide as its text needs (`pinLabelLayout`), the sprite
 * scaled to the canvas aspect at one height: a fixed canvas cut every
 * caption over about 16 characters at both ends, and the text sprite's
 * defaults (a 64 px square, a 48 px glyph) clipped every word.
 * Transparent, no depth write: the pill's surround must not paint a black
 * square over the camera.
 *
 * @see pin-label.ts.md
 */
import type { Object3D } from "three";

import { createTextSprite } from "gps-plus-slam-app-framework/visualization/text-sprite";

import { canvasMeasure, type Measure } from "./kinds/short-text/plate.js";

/** The label's measures, in canvas px unless named otherwise. */
export const PIN_LABEL = {
  heightPx: 256,
  fontPx: 56,
  minFontPx: 32,
  minWidthPx: 512,
  maxWidthPx: 1536,
  /** Clear room each side of the text: the pill's 10 px inset and its
   *  rounded end. */
  sidePx: 40,
  /** The sprite's world height (m); its width keeps the canvas aspect. */
  heightM: 0.3,
} as const;

/** A label's canvas, font and world scale for its text. */
export interface PinLabelLayout {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly fontPx: number;
  readonly font: string;
  readonly scale: { readonly x: number; readonly y: number; readonly z: 1 };
}

const fontOf = (px: number): string => `bold ${String(px)}px sans-serif`;

/**
 * The label's layout for `text`, its widths from `measure`: the canvas as
 * wide as the text at the full letter size plus clear room each side, at
 * least `minWidthPx`. A text too wide for `maxWidthPx` is drawn smaller,
 * down to `minFontPx`, so the format's longest caption fits within the cap;
 * whatever is still wider then widens the canvas past it rather than clip.
 */
export function pinLabelLayout(text: string, measure: Measure): PinLabelLayout {
  const full = measure(fontOf(PIN_LABEL.fontPx), text);
  const room = PIN_LABEL.maxWidthPx - 2 * PIN_LABEL.sidePx;
  const fontPx =
    full <= room
      ? PIN_LABEL.fontPx
      : Math.max(
          PIN_LABEL.minFontPx,
          Math.floor((PIN_LABEL.fontPx * room) / full),
        );
  const font = fontOf(fontPx);
  const w = Math.max(
    PIN_LABEL.minWidthPx,
    Math.ceil(measure(font, text) + 2 * PIN_LABEL.sidePx),
  );
  const h = PIN_LABEL.heightPx;
  return {
    canvasWidth: w,
    canvasHeight: h,
    fontPx,
    font,
    scale: { x: (PIN_LABEL.heightM * w) / h, y: PIN_LABEL.heightM, z: 1 },
  };
}

/** The label's object and how to free it. */
export function createPinLabel(text: string): {
  object: Object3D;
  dispose(): void;
} {
  const layout = pinLabelLayout(text, canvasMeasure());
  const sprite = createTextSprite({
    text,
    background: "pill",
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    font: layout.font,
    transparent: true,
    depthWrite: false,
    scale: layout.scale,
  });
  return { object: sprite.sprite, dispose: () => sprite.dispose() };
}
