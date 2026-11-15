/**
 * The `?perf=1` "Copy perf log" button under the frame readout, and the
 * device probe its report reads.
 *
 * The button copies `perf-log.ts`'s report through the framework's shared
 * `copyWithFeedback` (busy, then "Copied" or the failure). A phone may
 * refuse the clipboard, so a failed copy shows the report in a read-only,
 * pre-selected text box with a line saying why: the text still gets out.
 *
 * Mounted only with `?perf=1`; without it nothing here exists.
 *
 * @see perf-log-panel.ts.md
 */

import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";

import type { PerfDevice, Size } from "./perf-log.js";

const log = createLogger("PerfLog");

export const COPY_PERF_LOG_LABELS = Object.freeze({
  idle: "Copy perf log",
  busy: "Copying…",
  done: "Copied",
  failed: "Copy failed - text below",
});

/** How long "Copied" stays before the idle label returns (ms). */
const CONFIRM_MS = 2500;

export interface PerfLogPanel {
  dispose(): void;
}

export interface PerfLogPanelOptions {
  /**
   * The clipboard write; defaults to `navigator.clipboard.writeText`, and
   * undefined where the page has no clipboard (an http page).
   */
  readonly write?: ((text: string) => Promise<void>) | undefined;
}

function defaultWrite(): ((text: string) => Promise<void>) | undefined {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  return clipboard ? (text) => clipboard.writeText(text) : undefined;
}

/**
 * The button, at the pane's top-left under the readout line. `report` is
 * called on each click, so the copy carries the session up to that moment.
 */
export function mountPerfLogPanel(
  container: HTMLElement,
  report: () => string,
  options: PerfLogPanelOptions = {},
): PerfLogPanel {
  const write = "write" in options ? options.write : defaultWrite();
  const panel = document.createElement("div");
  panel.dataset["testid"] = "perf-log";
  panel.style.cssText =
    "position:absolute;top:calc(var(--hud-bar-h, 0px) + 28px);left:4px;" +
    "z-index:5;display:flex;flex-direction:column;align-items:flex-start;" +
    "gap:4px;max-width:calc(100% - 8px);" +
    "font:11px/1.4 ui-monospace,monospace;color:#fff;";
  // The pane picks a building on pointer events: a tap here is the button's.
  for (const type of ["pointerdown", "pointerup", "click"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }
  const button = document.createElement("button");
  button.type = "button";
  button.dataset["testid"] = "perf-log-copy";
  button.textContent = COPY_PERF_LOG_LABELS.idle;
  button.style.cssText =
    "font:inherit;color:inherit;background:rgba(0,0,0,0.6);" +
    "border:1px solid rgba(255,255,255,0.4);border-radius:4px;" +
    "padding:4px 8px;min-height:28px;cursor:pointer;";
  panel.appendChild(button);
  container.appendChild(panel);

  let error: HTMLElement | undefined;
  let fallback: HTMLTextAreaElement | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const clearFallback = (): void => {
    error?.remove();
    fallback?.remove();
    error = undefined;
    fallback = undefined;
  };

  const showFallback = (text: string, cause: unknown): void => {
    log.warn("Could not copy the perf log:", cause);
    clearFallback();
    error = document.createElement("div");
    error.dataset["testid"] = "perf-log-error";
    error.setAttribute("role", "alert");
    error.style.cssText =
      "background:rgba(120,0,0,0.8);padding:2px 6px;border-radius:4px;";
    error.textContent =
      "The clipboard refused the copy: select the text below and copy it.";
    fallback = document.createElement("textarea");
    fallback.dataset["testid"] = "perf-log-fallback";
    fallback.readOnly = true;
    fallback.value = text;
    fallback.rows = 8;
    fallback.style.cssText =
      "width:min(90vw, 480px);font:inherit;color:#fff;" +
      "background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.4);";
    panel.append(error, fallback);
    fallback.focus();
    fallback.select();
  };

  const onClick = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
    let text: string;
    try {
      text = report();
    } catch (cause) {
      log.warn("Could not build the perf log:", cause);
      button.textContent = "Perf log failed";
      return;
    }
    void copyWithFeedback(button, text, write, {
      busy: COPY_PERF_LOG_LABELS.busy,
      done: COPY_PERF_LOG_LABELS.done,
      failed: COPY_PERF_LOG_LABELS.failed,
      onDone: () => {
        clearFallback();
        idleTimer = setTimeout(() => {
          idleTimer = undefined;
          button.textContent = COPY_PERF_LOG_LABELS.idle;
        }, CONFIRM_MS);
      },
      onFailed: (cause) => showFallback(text, cause),
    });
  };
  button.addEventListener("click", onClick);

  return {
    dispose() {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      button.removeEventListener("click", onClick);
      panel.remove();
    },
  };
}

/** The WebGL calls the probe makes, structurally (a fake in unit tests). */
interface GlLike {
  readonly RENDERER: number;
  readonly VENDOR: number;
  getExtension(name: string): unknown;
  getParameter(parameter: number): unknown;
}

/** What the device probe reads, structurally, so it runs in node. */
export interface PerfDeviceEnv {
  readonly navigator: {
    readonly userAgent: string;
    readonly hardwareConcurrency?: number | undefined;
    /** Chromium only: `navigator.deviceMemory` in GB. */
    readonly deviceMemory?: number | undefined;
  };
  readonly screen: { readonly width: number; readonly height: number } | null;
  readonly devicePixelRatio: number;
  readonly canvas: {
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly gl: GlLike | null;
  readonly matchMedia: (query: string) => { readonly matches: boolean };
}

const positive = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const scaled = (css: Size | null, ratio: number): Size | null =>
  css === null
    ? null
    : {
        width: Math.round(css.width * ratio),
        height: Math.round(css.height * ratio),
      };

/** `WEBGL_debug_renderer_info`'s constants, unchecked until read. */
interface DebugRendererInfo {
  readonly UNMASKED_RENDERER_WEBGL?: unknown;
  readonly UNMASKED_VENDOR_WEBGL?: unknown;
}

/** A GL string, or null when the context refuses or returns another type. */
function glString(gl: GlLike, parameter: number): string | null {
  try {
    const value = gl.getParameter(parameter);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function gpuNames(gl: GlLike | null): {
  renderer: string | null;
  vendor: string | null;
} {
  if (gl === null) return { renderer: null, vendor: null };
  let ext: DebugRendererInfo | null;
  try {
    ext = gl.getExtension(
      "WEBGL_debug_renderer_info",
    ) as DebugRendererInfo | null;
  } catch {
    ext = null;
  }
  const unmasked = (key: unknown, masked: number): string | null =>
    (typeof key === "number" ? glString(gl, key) : null) ??
    glString(gl, masked);
  return {
    renderer: unmasked(ext?.UNMASKED_RENDERER_WEBGL, gl.RENDERER),
    vendor: unmasked(ext?.UNMASKED_VENDOR_WEBGL, gl.VENDOR),
  };
}

function pointerKind(
  matchMedia: PerfDeviceEnv["matchMedia"],
): PerfDevice["pointer"] {
  try {
    if (matchMedia("(pointer: coarse)").matches) return "coarse";
    if (matchMedia("(pointer: fine)").matches) return "fine";
    return "none";
  } catch {
    return "unknown";
  }
}

/**
 * `readPerfDevice` on this page: the browser's navigator, screen and
 * pointer, with the 3D view's canvas and WebGL context.
 */
export function readBrowserDevice(
  canvas: HTMLCanvasElement,
  gl: GlLike | null,
): PerfDevice {
  return readPerfDevice({
    navigator,
    screen: window.screen,
    devicePixelRatio: window.devicePixelRatio,
    canvas,
    gl,
    matchMedia: (query) => window.matchMedia(query),
  });
}

/** The device facts the report carries; null wherever the browser hides one. */
export function readPerfDevice(env: PerfDeviceEnv): PerfDevice {
  const ratio = positive(env.devicePixelRatio) ?? 1;
  const screenCss =
    env.screen === null
      ? null
      : { width: env.screen.width, height: env.screen.height };
  const gpu = gpuNames(env.gl);
  return {
    userAgent: env.navigator.userAgent,
    devicePixelRatio: ratio,
    screenCss,
    screenDevice: scaled(screenCss, ratio),
    canvasCss:
      env.canvas === null
        ? null
        : { width: env.canvas.clientWidth, height: env.canvas.clientHeight },
    canvasDevice:
      env.canvas === null
        ? null
        : { width: env.canvas.width, height: env.canvas.height },
    hardwareConcurrency: positive(env.navigator.hardwareConcurrency),
    deviceMemoryGb: positive(env.navigator.deviceMemory),
    gpuRenderer: gpu.renderer,
    gpuVendor: gpu.vendor,
    pointer: pointerKind(env.matchMedia),
  };
}
