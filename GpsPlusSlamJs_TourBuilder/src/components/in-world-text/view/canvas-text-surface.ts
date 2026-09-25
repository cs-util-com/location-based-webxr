/**
 * The `CanvasTexture` text backend (view layer) — the XR-safe fallback.
 *
 * Draws the shared `PanelDrawModel` into a 2D canvas and exposes it as a
 * `THREE.CanvasTexture`. It is fully synchronous (`settled()` resolves at once),
 * so it is what the factory swaps to if the HTML-in-3D backend throws or times
 * out. Filtering (mipmaps + anisotropy) keeps the text crisp when the panel is
 * approached or viewed at a grazing angle (plan D13).
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";

import { roundRect } from "../../shared/canvas-panel.js";
import type { DrawButton, PanelDrawModel } from "../core/describe-panel.js";
import type { SurfaceDeps, TextSurface } from "./text-surface.js";

export function createCanvasTextSurface(deps: SurfaceDeps): TextSurface {
  const canvas = document.createElement("canvas");
  canvas.width = deps.canvasW;
  canvas.height = deps.canvasH;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2D canvas context unavailable for the text panel");
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = deps.maxAnisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;

  return {
    texture,
    render(model: PanelDrawModel): void {
      drawPanel(ctx, model);
      texture.needsUpdate = true;
    },
    settled: () => Promise.resolve(),
    dispose: () => texture.dispose(),
  };
}

function drawPanel(ctx: CanvasRenderingContext2D, model: PanelDrawModel): void {
  ctx.clearRect(0, 0, model.canvasW, model.canvasH);
  ctx.fillStyle = model.panelColor;
  roundRect(ctx, 6, 6, model.canvasW - 12, model.canvasH - 12, 28);
  ctx.fill();

  ctx.fillStyle = model.textColor;
  ctx.font = `${model.fontPx}px ${model.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const line of model.lines) {
    ctx.fillText(line.text, line.xPx, line.yPx);
  }

  drawButton(ctx, model.prev, "prev", model);
  drawButton(ctx, model.next, "next", model);
  drawIndicator(ctx, model);
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  button: DrawButton,
  dir: "prev" | "next",
  model: PanelDrawModel,
): void {
  const r = button.rectPx;
  ctx.fillStyle = button.enabled
    ? "rgba(79, 140, 255, 0.18)"
    : "rgba(57, 66, 79, 0.15)";
  roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
  ctx.fill();

  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = Math.min(r.w, r.h) * 0.3;
  ctx.fillStyle = button.enabled ? model.accentColor : model.mutedColor;
  ctx.beginPath();
  if (dir === "prev") {
    ctx.moveTo(cx + s * 0.5, cy - s);
    ctx.lineTo(cx + s * 0.5, cy + s);
    ctx.lineTo(cx - s * 0.6, cy);
  } else {
    ctx.moveTo(cx - s * 0.5, cy - s);
    ctx.lineTo(cx - s * 0.5, cy + s);
    ctx.lineTo(cx + s * 0.6, cy);
  }
  ctx.closePath();
  ctx.fill();
}

function drawIndicator(
  ctx: CanvasRenderingContext2D,
  model: PanelDrawModel,
): void {
  const r = model.indicator.rectPx;
  ctx.fillStyle = model.textColor;
  ctx.font = `600 ${Math.round(model.fontPx * 0.7)}px ${model.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(model.indicator.text, r.x + r.w / 2, r.y + r.h / 2);
}
