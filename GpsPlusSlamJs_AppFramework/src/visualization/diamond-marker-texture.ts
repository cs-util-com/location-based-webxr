/**
 * The diamond marker drawn into a canvas texture, one entrance state at a
 * time.
 *
 * The drawer behind the seam in `diamond-entrance.ts`: it takes a
 * `DiamondEntranceState` and paints the design system's diamond at that
 * moment — the outline as a dashed stroke whose offset is the undrawn
 * share, the accent dot scaled and faded by `dot` — into a canvas that a
 * `THREE.CanvasTexture` uploads. Geometry is the demo's
 * `wayfinding-diamond.svg` verbatim (itself the catalog's `.diamond`,
 * guarded attribute-for-attribute by the webxr root's
 * `design-accent-copies.test.js`): a 44 × 44, rx 4 rect rotated 45° about
 * (32, 32) inside a `viewBox="-4 -4 72 72"`, an r 4.5 dot, ink stroke 2
 * on the outline and 0.5 on the dot, a single drop shadow on the GROUP.
 *
 * Two canvases on purpose: the shapes go on a scratch canvas without any
 * shadow, and the texture canvas composites that ONCE with the shadow
 * triple — so the dot does not cast its own shadow onto the outline, which
 * is what one `feDropShadow` on the SVG group produces. The plan's spike
 * measured the second canvas at well under 0.05 ms per redraw on desktop.
 *
 * Change-detection freeze, as in `text-sprite.ts`: `apply` redraws only when
 * the state differs from the last one drawn, and `needsUpdate` is set only
 * then — a settled marker costs no upload. Tolerates a null 2D context
 * (jsdom, no canvas backend): the texture exists, `apply` returns false,
 * `dispose` is safe. Plan:
 * `GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md`
 * (M2).
 *
 * @see diamond-marker-texture.ts.md
 */
import * as THREE from 'three';
import {
  DIAMOND_ENTRANCE,
  type DiamondEntranceState,
} from './diamond-entrance.js';

/**
 * The SVG's numbers, in its own 72-unit space (`viewBox="-4 -4 72 72"`).
 * The drift guard in the webxr root compares these with the asset.
 */
export const DIAMOND_GEOMETRY = Object.freeze({
  /** The viewBox is 72 units wide and starts at −4: the marker's own padding for stroke and halo. */
  viewBoxSize: 72,
  viewBoxOrigin: -4,
  /** `<rect x y width height rx>` before the rotation. */
  rectOffset: 10,
  rectSide: 44,
  rectRadius: 4,
  /** `rotate(45 32 32)`: the rect and the dot share this centre. */
  centre: 32,
  rotationDeg: 45,
  /** `<circle r>` and the two stroke widths (`--line-strong`, `--line`). */
  dotRadius: 4.5,
  outlineStrokeWidth: 2,
  dotStrokeWidth: 0.5,
  /** `feDropShadow dy="1" stdDeviation="1"`: the canvas's blur is 2σ, as CSS's `2px` is. */
  haloBlur: 2,
  haloOffsetY: 1,
});

/** `flood-color="#000" flood-opacity="0.8"` — the SVG's and the sheet's halo. */
export const DEFAULT_DIAMOND_HALO = 'rgba(0, 0, 0, 0.8)';

export interface DiamondMarkerTextureOptions {
  /** Canvas edge in pixels; the SVG rasterises at 256. Positive integer. */
  readonly size?: number;
  /** The outline and dot-stroke colour (`--ink`). Non-empty CSS colour. */
  readonly ink: string;
  /** The dot's fill (`--accent`). Non-empty CSS colour. */
  readonly accent: string;
  /** The shadow colour; defaults to {@link DEFAULT_DIAMOND_HALO}. */
  readonly halo?: string;
}

export interface DiamondMarkerTexture {
  /** sRGB-tagged, like the URL-loaded sprites; bind it to a SpriteMaterial. */
  readonly texture: THREE.CanvasTexture;
  /**
   * Draw `state` if it differs from the last state drawn. Returns whether it
   * redrew (and therefore set `texture.needsUpdate`). False without a 2D
   * context.
   */
  apply(state: DiamondEntranceState): boolean;
  /** Wall-clock milliseconds of the last redraw (0 before the first, or where `performance` is absent). */
  readonly lastDrawMs: number;
  /** Release the texture. Idempotent. */
  dispose(): void;
}

const DEFAULT_SIZE = 256;

function assertColour(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(
      `createDiamondMarkerTexture: ${name} must be a non-empty CSS colour string, got ${JSON.stringify(value)}`
    );
  }
}

function resolveSize(size: number | undefined): number {
  if (size === undefined) return DEFAULT_SIZE;
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(
      `createDiamondMarkerTexture: size must be a positive integer, got ${size}`
    );
  }
  return size;
}

/** `roundRect` where the engine has it; the same path by hand elsewhere. */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The shapes at `state`, in SVG units, no shadow: the scratch canvas. */
function drawShapes(
  ctx: CanvasRenderingContext2D,
  size: number,
  state: DiamondEntranceState,
  ink: string,
  accent: string
): void {
  const g = DIAMOND_GEOMETRY;
  const s = size / g.viewBoxSize;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // The viewBox starts at −4: shift by the inset, then scale. A bare scale
  // would land everything 4 units (14 px at 256) up and left.
  ctx.translate(-g.viewBoxOrigin * s, -g.viewBoxOrigin * s);
  ctx.scale(s, s);

  ctx.save();
  ctx.translate(g.centre, g.centre);
  ctx.rotate((g.rotationDeg * Math.PI) / 180);
  ctx.translate(-g.centre, -g.centre);
  ctx.beginPath();
  roundedRectPath(
    ctx,
    g.rectOffset,
    g.rectOffset,
    g.rectSide,
    g.rectSide,
    g.rectRadius
  );
  ctx.setLineDash([DIAMOND_ENTRANCE.dashLength, DIAMOND_ENTRANCE.dashLength]);
  ctx.lineDashOffset = DIAMOND_ENTRANCE.dashLength * (1 - state.outline);
  ctx.strokeStyle = ink;
  ctx.lineWidth = g.outlineStrokeWidth;
  ctx.stroke();
  ctx.restore();

  if (state.dot > 0) {
    ctx.globalAlpha = state.dot;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(g.centre, g.centre, g.dotRadius * state.dot, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = g.dotStrokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/** One group shadow of the scratch canvas onto the texture canvas. */
function composite(
  ctx: CanvasRenderingContext2D,
  scratch: HTMLCanvasElement,
  size: number,
  halo: string
): void {
  const s = size / DIAMOND_GEOMETRY.viewBoxSize;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.shadowColor = halo;
  ctx.shadowBlur = DIAMOND_GEOMETRY.haloBlur * s;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = DIAMOND_GEOMETRY.haloOffsetY * s;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : 0;

function sameState(a: DiamondEntranceState, b: DiamondEntranceState): boolean {
  return a.outline === b.outline && a.dot === b.dot && a.settled === b.settled;
}

/**
 * Create the marker texture. Nothing is drawn until the first `apply`.
 *
 * Throws `TypeError` on a missing/empty colour and `RangeError` on a
 * non-positive or fractional `size` — at creation, never per frame.
 */
export function createDiamondMarkerTexture(
  options: DiamondMarkerTextureOptions
): DiamondMarkerTexture {
  assertColour('ink', options.ink);
  assertColour('accent', options.accent);
  if (options.halo !== undefined) assertColour('halo', options.halo);
  const size = resolveSize(options.size);
  const halo = options.halo ?? DEFAULT_DIAMOND_HALO;
  const { ink, accent } = options;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  const ctx = canvas.getContext('2d');
  const scratchCtx = scratch.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  let last: DiamondEntranceState | null = null;
  let lastDrawMs = 0;
  let disposed = false;

  function apply(state: DiamondEntranceState): boolean {
    if (last !== null && sameState(last, state)) return false;
    last = { outline: state.outline, dot: state.dot, settled: state.settled };
    if (!ctx || !scratchCtx || disposed) return false;
    const t0 = now();
    drawShapes(scratchCtx, size, state, ink, accent);
    composite(ctx, scratch, size, halo);
    lastDrawMs = now() - t0;
    texture.needsUpdate = true;
    return true;
  }

  return {
    texture,
    apply,
    get lastDrawMs() {
      return lastDrawMs;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
    },
  };
}
