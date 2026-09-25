/**
 * The swappable text-rendering backend seam (view layer).
 *
 * A `TextSurface` turns a pure `PanelDrawModel` into a `THREE.Texture` on demand.
 * Two implementations exist — the HTML-in-3D backend (primary) and the
 * `CanvasTexture` backend (fallback) — and the factory picks between them behind
 * this one interface so the scene/store never change (plan D2). Rendering may be
 * asynchronous (the HTML backend rasterizes off an SVG image), so `render` is
 * fire-and-forget and `settled()` exposes when the latest raster has landed —
 * that is what the factory races against its fallback timeout.
 *
 * This module also owns `createMeasure`, the one place a font turns into a
 * width-measuring function (an offscreen canvas `measureText`), shared by both
 * backends so wrapping/pagination match exactly (plan D9).
 */

import type { Texture } from "three";

import type { PanelDrawModel } from "../core/describe-panel.js";
import type { Measure } from "../core/text-wrap.js";

export type SurfaceKind = "html" | "canvas";

export interface SurfaceDeps {
  readonly canvasW: number;
  readonly canvasH: number;
  readonly maxAnisotropy: number;
}

export interface TextSurface {
  readonly texture: Texture;
  /** Render a draw model. Returns immediately; the texture updates when the
   *  (possibly async) raster completes. */
  render(model: PanelDrawModel): void;
  /** Resolves when the most recent `render`'s raster has completed; rejects if
   *  it failed. The Canvas backend resolves synchronously. */
  settled(): Promise<void>;
  dispose(): void;
}

export type SurfaceFactory = (
  kind: SurfaceKind,
  deps: SurfaceDeps,
) => TextSurface;

/** Build a width measurer backed by an offscreen 2D canvas at the given font. */
export function createMeasure(fontPx: number, fontFamily: string): Measure {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2D canvas context unavailable for text measurement");
  }
  ctx.font = `${fontPx}px ${fontFamily}`;
  return (text) => ctx.measureText(text).width;
}
