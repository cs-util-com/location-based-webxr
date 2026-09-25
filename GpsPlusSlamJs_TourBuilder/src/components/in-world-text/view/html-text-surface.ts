/**
 * The HTML-in-3D text backend (view layer) — the primary path.
 *
 * Builds an offscreen DOM subtree from the shared `PanelDrawModel` and rasterizes
 * it to a texture with `three-html-render` (which renders the DOM through an SVG
 * `<foreignObject>` on today's browsers). This is the approach the TASK asks us
 * to use first because it renders reliably inside immersive WebXR, where a
 * DOM/CSS overlay does not (plan D1/D8).
 *
 * The offscreen root is detached from layout (positioned far off-screen,
 * `aria-hidden`, `pointer-events:none`) so it never touches the visible page —
 * it exists only to be rasterized. Rasterization is asynchronous; `render`
 * double-buffers (the previous texture image stays until the new raster lands)
 * and `settled()` exposes the latest raster promise so the factory can time it
 * out and fall back to Canvas if it throws or stalls (plan R1/R2/R3). The markup
 * is self-contained (system fonts, inline styles, no cross-origin resources) so
 * the raster is never tainted (plan D3).
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";

import type {
  DrawButton,
  DrawLine,
  PanelDrawModel,
  PxRect,
} from "../core/describe-panel.js";
import type { SurfaceDeps, TextSurface } from "./text-surface.js";

/** Minimal shape we use from `three-html-render`'s `HtmlRenderer`. */
interface HtmlRasterizer {
  update(node: HTMLElement): Promise<HTMLCanvasElement>;
}

// `three-html-render` patches DOM globals at module-eval time, so it must never
// load in a non-DOM (node/vitest) context. We import it lazily on first render,
// which only happens in the browser — keeping the static import graph (and thus
// the factory's unit tests) node-safe. Memoized so the polyfill installs once.
let rasterizerPromise: Promise<HtmlRasterizer> | null = null;
function loadRasterizer(): Promise<HtmlRasterizer> {
  if (rasterizerPromise === null) {
    rasterizerPromise = import("three-html-render").then((module) => {
      module.installHtmlInCanvasPolyfill();
      return module.getHtmlRenderer();
    });
  }
  return rasterizerPromise;
}

export function createHtmlTextSurface(deps: SurfaceDeps): TextSurface {
  // The root is what gets rasterized, so it must sit at normal coordinates —
  // `three-html-render` clones it verbatim into the SVG `<foreignObject>`, so an
  // off-screen `left:-100000px` on the root would push the content out of the
  // raster viewport and yield a correct-size but fully blank texture. We instead
  // hide it from the visible page with a 0×0 `overflow:hidden` clip wrapper: the
  // root still lays out at its full size (so `offsetWidth` drives the raster) but
  // paints nothing on the page.
  const clip = document.createElement("div");
  clip.setAttribute("aria-hidden", "true");
  clip.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;";
  const root = document.createElement("div");
  styleRoot(root, deps);
  clip.appendChild(root);
  document.body.appendChild(clip);

  // Placeholder image until the first raster lands; swapped in on settle. Sized
  // to the raster's real pixel dimensions (`three-html-render` scales by
  // devicePixelRatio) so the GL texture is allocated at that size — seeding it
  // with a mismatched canvas makes Chrome's accelerated canvas→texture copy
  // overflow the allocation when the first raster arrives (GL_INVALID_VALUE
  // glCopySubTextureCHROMIUM) and upload blank.
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const placeholder = document.createElement("canvas");
  placeholder.width = Math.ceil(deps.canvasW * dpr);
  placeholder.height = Math.ceil(deps.canvasH * dpr);
  const texture = new CanvasTexture(placeholder);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = deps.maxAnisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;

  let pending: Promise<void> = Promise.resolve();
  let token = 0;

  return {
    texture,
    render(model: PanelDrawModel): void {
      buildDom(root, model);
      const current = ++token;
      // Swallow a superseded raster's rejection; only the latest `pending` is
      // surfaced to the factory via settled().
      void pending.catch(() => undefined);
      pending = loadRasterizer()
        .then((rasterizer) => rasterizer.update(root))
        .then((rasterCanvas) => {
          // A degenerate raster uploads blank without ever throwing (the failure
          // surfaces later as an uncatchable GL warning), so reject here to route
          // the factory's guard to the Canvas fallback (plan R1/R2/R3).
          // `three-html-render` returns a 1×1 canvas when the element measures 0;
          // otherwise it preserves our 4:3 aspect at devicePixelRatio scale, so
          // an aspect check accepts any DPR without hard-coding the pixel size.
          const aspect = rasterCanvas.width / rasterCanvas.height;
          const expected = deps.canvasW / deps.canvasH;
          if (
            rasterCanvas.width <= 1 ||
            rasterCanvas.height <= 1 ||
            Math.abs(aspect - expected) > 0.01
          ) {
            throw new Error(
              `html raster ${rasterCanvas.width}×${rasterCanvas.height} is degenerate`,
            );
          }
          if (current === token) {
            texture.image = rasterCanvas;
            texture.needsUpdate = true;
          }
        });
    },
    settled: () => pending,
    dispose(): void {
      token++;
      clip.remove();
      texture.dispose();
    },
  };
}

function styleRoot(root: HTMLDivElement, deps: SurfaceDeps): void {
  const s = root.style;
  // `relative` at the origin: a positioned containing block for the absolutely
  // positioned lines/buttons, kept on normal coordinates so the raster is not
  // shifted out of view. The parent clip wrapper is what hides it from the page.
  s.position = "relative";
  s.left = "0";
  s.top = "0";
  s.width = `${deps.canvasW}px`;
  s.height = `${deps.canvasH}px`;
  s.boxSizing = "border-box";
  s.pointerEvents = "none";
  s.overflow = "hidden";
}

function buildDom(root: HTMLDivElement, model: PanelDrawModel): void {
  root.replaceChildren();
  const s = root.style;
  s.background = model.panelColor;
  s.borderRadius = "28px";
  s.fontFamily = model.fontFamily;
  s.color = model.textColor;

  for (const line of model.lines) {
    root.appendChild(lineEl(line, model));
  }
  root.appendChild(buttonEl(model.prev, "prev", model));
  root.appendChild(buttonEl(model.next, "next", model));
  root.appendChild(indicatorEl(model));
}

/** Absolutely position an element over a pixel rect, contents centred. */
function positionBox(s: CSSStyleDeclaration, rect: PxRect): void {
  s.position = "absolute";
  s.left = `${rect.x}px`;
  s.top = `${rect.y}px`;
  s.width = `${rect.w}px`;
  s.height = `${rect.h}px`;
  s.display = "flex";
  s.alignItems = "center";
  s.justifyContent = "center";
}

function lineEl(line: DrawLine, model: PanelDrawModel): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = line.text;
  const s = el.style;
  s.position = "absolute";
  s.left = `${line.xPx}px`;
  s.top = `${line.yPx}px`;
  s.fontSize = `${model.fontPx}px`;
  s.lineHeight = `${model.lineHeightPx}px`;
  s.whiteSpace = "pre"; // honour our line breaks; never re-wrap
  return el;
}

function buttonEl(
  button: DrawButton,
  dir: "prev" | "next",
  model: PanelDrawModel,
): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = dir === "prev" ? "‹" : "›";
  const r = button.rectPx;
  positionBox(el.style, r);
  el.style.borderRadius = `${Math.min(r.w, r.h) * 0.28}px`;
  el.style.fontSize = `${Math.round(Math.min(r.w, r.h) * 0.6)}px`;
  el.style.background = button.enabled
    ? "rgba(79, 140, 255, 0.18)"
    : "rgba(57, 66, 79, 0.15)";
  el.style.color = button.enabled ? model.accentColor : model.mutedColor;
  return el;
}

function indicatorEl(model: PanelDrawModel): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = model.indicator.text;
  positionBox(el.style, model.indicator.rectPx);
  el.style.fontSize = `${Math.round(model.fontPx * 0.7)}px`;
  el.style.fontWeight = "600";
  return el;
}
