/**
 * Test-only: a recording stand-in for `CanvasRenderingContext2D`, and the
 * `document.createElement` patch that hands it to every canvas a module
 * creates under jsdom (which has no canvas backend — `getContext` returns
 * null there).
 *
 * ONE copy for the four canvas-drawing test files of this directory
 * (`text-sprite`, `diamond-marker-texture`, the two `wayfinding-hud.entrance`
 * files). They each carried their own until 2026-09-06; a wrong canvas index
 * copied between two of them made a property test vacuous, which is the
 * failure a shared helper removes (follow-up
 * `2026-09-06-0215-recording-canvas-test-helper-copies-followup.md`).
 * Imported only by tests, so it carries no sidecar (test-only files are
 * exempt) and knip counts the test imports as its use.
 */
import { vi, type Mock } from 'vitest';

/** The recorder's shape, named so the inferred type stays portable. */
export interface RecordingContext {
  clearRect: Mock;
  save: Mock;
  restore: Mock;
  translate: Mock;
  scale: Mock;
  rotate: Mock;
  beginPath: Mock;
  roundRect: Mock;
  rect: Mock;
  moveTo: Mock;
  arcTo: Mock;
  closePath: Mock;
  setLineDash: Mock;
  stroke: Mock;
  arc: Mock;
  fill: Mock;
  fillText: Mock;
  drawImage: Mock;
  lineDashOffset: number;
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}

/**
 * Every call a spy, every property a plain field; `overrides` win (an
 * override of `undefined` models an engine that lacks the method — the
 * `roundRect` fallback tests — hence the cast).
 */
export function makeRecordingContext(
  overrides: Record<string, unknown> = {}
): RecordingContext {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    lineDashOffset: 0,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    ...overrides,
  };
}

/**
 * Patch `document.createElement` so EVERY canvas created from now on gets
 * its own recorder (from `make`), collected in creation order — the order
 * is how a test tells a module's canvases apart (e.g. the marker's texture
 * canvas, then its scratch canvas, then a label's). `make` may return null
 * to model a missing canvas backend. Undo with `vi.restoreAllMocks()`.
 */
export function injectContexts(
  make: () => RecordingContext | null = makeRecordingContext
): RecordingContext[] {
  const contexts: RecordingContext[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string): HTMLElement => {
      const el = original(tagName);
      if (tagName === 'canvas') {
        const ctx = make();
        if (ctx) contexts.push(ctx);
        (el as HTMLCanvasElement).getContext = vi.fn(
          () => ctx
        ) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    }
  );
  return contexts;
}

/** The one-recorder form: every canvas shares `ctx` (or gets null). */
export function injectContext(ctx: RecordingContext | null): void {
  injectContexts(() => ctx);
}
