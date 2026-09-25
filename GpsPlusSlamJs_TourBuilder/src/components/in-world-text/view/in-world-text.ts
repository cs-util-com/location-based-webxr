/**
 * The in-world text label (view layer / composition unit).
 *
 * Composes the pure core into one Three.js object: a billboarded plane whose
 * texture is a paginated, styled text panel. It owns the page-navigation state
 * (hosted here, not in a store — plan D10), yaws to face the user (shared
 * billboard math), and renders through a swappable `TextSurface`.
 *
 * The fallback lives here: the primary HTML-in-3D backend is tried first, and if
 * a render throws or does not settle within `htmlRenderTimeoutMs` the label
 * swaps that surface to the Canvas backend and re-renders — at construction *or*
 * later (e.g. after entering an XR session), because every render is guarded
 * (plan R1/R2). The rendering surface and the width measurer are injectable so
 * the fallback wiring is unit-testable with no DOM/GPU (plan R5).
 */

import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Vector3,
} from "three";

import {
  computeBillboardYaw,
  type HorizontalPoint,
} from "../../shared/billboard-math.js";
import { describePanel, type PanelDrawModel } from "../core/describe-panel.js";
import {
  computePagePanelLayout,
  hitToPageIntent,
  type PageIntent,
  paginate,
} from "../core/page-layout.js";
import {
  canNext,
  canPrev,
  initialTextPageState,
  pageLabel as pageLabelOf,
  textPageReducer,
} from "../core/text-page-state.js";
import {
  DEFAULT_TEXT_STYLE,
  resolveTextStyle,
  type ResolvedTextStyle,
  type TextStyle,
} from "../core/text-style.js";
import { wrapText, type Measure } from "../core/text-wrap.js";
import { createCanvasTextSurface } from "./canvas-text-surface.js";
import { createHtmlTextSurface } from "./html-text-surface.js";
import {
  createMeasure,
  type SurfaceFactory,
  type SurfaceKind,
  type TextSurface,
} from "./text-surface.js";

const DEFAULT_HTML_TIMEOUT_MS = 400;
const DEFAULT_MAX_ANISOTROPY = 4;

/** Stamped onto the pickable mesh so a raycaster can resolve the label by id. */
export interface TextLabelUserData {
  readonly textLabelId: string;
}

export interface InWorldTextOptions {
  readonly text: string;
  readonly position: Vector3;
  readonly id?: string;
  readonly maxWidthMeters?: number;
  /** Cap, in metres, on how tall the panel may grow to fit its text. */
  readonly maxHeightMeters?: number;
  /** Floor, in metres, on the panel height (e.g. the adjacent visual's). */
  readonly minHeightMeters?: number;
  readonly style?: Partial<TextStyle>;
  /** 'canvas' forces the fallback; 'auto'/'html' try HTML with the runtime net. */
  readonly backend?: "auto" | "html" | "canvas";
  readonly htmlRenderTimeoutMs?: number;
  readonly maxAnisotropy?: number;
  readonly measure?: Measure; // DI seam (tests)
  readonly createSurface?: SurfaceFactory; // DI seam (tests)
}

export interface InWorldText {
  readonly id: string;
  readonly group: Group;
  /** The mesh a raycaster should test (carries `TextLabelUserData`). */
  readonly pickMesh: Mesh;
  /** Resolves after the initial render (and any fallback swap) has settled. */
  readonly ready: Promise<void>;
  readonly pageLabel: string;
  readonly activeBackend: SurfaceKind;
  faceCamera(cameraPos: HorizontalPoint): void;
  next(): void;
  prev(): void;
  setText(text: string): void;
  hitTest(uv: { readonly u: number; readonly v: number }): PageIntent;
  dispose(): void;
}

let autoId = 0;

const defaultSurfaceFactory: SurfaceFactory = (kind, deps) =>
  kind === "html" ? createHtmlTextSurface(deps) : createCanvasTextSurface(deps);

export function createInWorldText(options: InWorldTextOptions): InWorldText {
  const styleInput = resolveStyleInput(options);
  const measure =
    options.measure ?? createMeasure(styleInput.fontPx, styleInput.fontFamily);
  const surfaceFactory = options.createSurface ?? defaultSurfaceFactory;
  const timeoutMs = options.htmlRenderTimeoutMs ?? DEFAULT_HTML_TIMEOUT_MS;
  const maxAnisotropy = options.maxAnisotropy ?? DEFAULT_MAX_ANISOTROPY;
  const id = options.id ?? `in-world-text-${++autoId}`;

  const sized = sizeAndWrap(options.text, styleInput, measure);
  let style = sized.style;
  let pages = sized.pages;
  let state = initialTextPageState(pages.length);

  let geometry = new PlaneGeometry(style.planeW, style.planeH);
  const material = new MeshBasicMaterial({ transparent: true });
  const mesh = new Mesh(geometry, material);
  mesh.userData = { textLabelId: id } satisfies TextLabelUserData;
  const group = new Group();
  group.position.copy(options.position);
  group.add(mesh);

  let backend: SurfaceKind = options.backend === "canvas" ? "canvas" : "html";
  let deps = { canvasW: style.canvasW, canvasH: style.canvasH, maxAnisotropy };
  let surface: TextSurface = surfaceFactory(backend, deps);
  material.map = surface.texture;

  /** Rebuild the plane geometry + render surface if the resolved size changed. */
  function applySize(newStyle: ResolvedTextStyle): void {
    if (
      newStyle.planeH === style.planeH &&
      newStyle.canvasH === style.canvasH
    ) {
      style = newStyle;
      return;
    }
    style = newStyle;
    geometry.dispose();
    geometry = new PlaneGeometry(style.planeW, style.planeH);
    mesh.geometry = geometry;
    deps = { canvasW: style.canvasW, canvasH: style.canvasH, maxAnisotropy };
    const previous = surface;
    surface = surfaceFactory(backend, deps);
    material.map = surface.texture;
    material.needsUpdate = true;
    previous.dispose();
  }

  function model(): PanelDrawModel {
    const page = pages[state.pageIndex] ?? [];
    return describePanel(page, style, {
      canPrev: canPrev(state),
      canNext: canNext(state),
      label: pageLabelOf(state),
    });
  }

  function swapToCanvas(): void {
    if (backend === "canvas") {
      return;
    }
    backend = "canvas";
    const previous = surface;
    surface = surfaceFactory("canvas", deps);
    material.map = surface.texture;
    material.needsUpdate = true;
    surface.render(model()); // synchronous
    previous.dispose();
  }

  async function renderGuarded(): Promise<void> {
    try {
      surface.render(model());
      await withTimeout(surface.settled(), timeoutMs);
    } catch {
      swapToCanvas();
    }
  }

  const ready = renderGuarded();
  const refresh = (): void => {
    void renderGuarded();
  };

  return {
    id,
    group,
    pickMesh: mesh,
    ready,
    get pageLabel(): string {
      return pageLabelOf(state);
    },
    get activeBackend(): SurfaceKind {
      return backend;
    },
    faceCamera(cameraPos): void {
      group.rotation.set(0, computeBillboardYaw(group.position, cameraPos), 0);
    },
    next(): void {
      state = textPageReducer(state, { type: "next" });
      refresh();
    },
    prev(): void {
      state = textPageReducer(state, { type: "prev" });
      refresh();
    },
    setText(text): void {
      const result = sizeAndWrap(text, styleInput, measure);
      applySize(result.style);
      pages = result.pages;
      state = textPageReducer(state, {
        type: "setText",
        pageCount: pages.length,
      });
      refresh();
    },
    hitTest(uv): PageIntent {
      return hitToPageIntent(
        uv,
        { canPrev: canPrev(state), canNext: canNext(state) },
        computePagePanelLayout(style.planeH, style.floorPlaneH),
      );
    },
    dispose(): void {
      surface.dispose();
      geometry.dispose();
      material.dispose();
      if (group.parent !== null) {
        group.parent.remove(group);
      }
    },
  };
}

function resolveStyleInput(options: InWorldTextOptions): TextStyle {
  const merged: TextStyle = { ...DEFAULT_TEXT_STYLE, ...options.style };
  const withWidth: TextStyle =
    options.maxWidthMeters !== undefined
      ? { ...merged, maxWidthMeters: options.maxWidthMeters }
      : merged;
  const withMax: TextStyle =
    options.maxHeightMeters !== undefined
      ? { ...withWidth, maxHeightMeters: options.maxHeightMeters }
      : withWidth;
  return options.minHeightMeters !== undefined
    ? { ...withMax, minHeightMeters: options.minHeightMeters }
    : withMax;
}

/**
 * Wrap `text` once at the style's (height-independent) wrap width, then
 * resolve the final sized style from the resulting line count — so a panel
 * with `maxHeightMeters` set grows to fit its own text (see
 * `resolveTextStyle`) before being paginated at that final size.
 */
function sizeAndWrap(
  text: string,
  styleInput: TextStyle,
  measure: Measure,
): { style: ResolvedTextStyle; pages: string[][] } {
  const widthOnly = resolveTextStyle(styleInput);
  const lines = wrapText(text, widthOnly.wrapWidthPx, measure);
  const style =
    styleInput.maxHeightMeters === undefined
      ? widthOnly
      : resolveTextStyle(styleInput, lines.length);
  return { style, pages: paginate(lines, style.maxLinesPerPage) };
}

/** Reject if `promise` does not resolve within `ms`, so the factory can swap. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => reject(new Error("html text render timed out")),
      ms,
    );
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
