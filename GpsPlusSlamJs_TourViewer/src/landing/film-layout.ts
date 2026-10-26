/**
 * Where the drawn phone sits in the film's box, the free space left of it
 * that a close view is fitted into, and each view's camera angles. Ported
 * from the prototype's `layout()`, laid out against the film's own box instead of
 * the prototype's sticky stage.
 *
 * Pure: sizes in, rectangles out (CSS pixels, origin top left).
 *
 * @see film-layout.ts.md
 */
import { AZ, AZ2 } from "./film-park.js";
import type { ViewName } from "./film-story.js";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface FilmLayout {
  readonly W: number;
  readonly H: number;
  readonly portrait: boolean;
  readonly phone: Rect;
  /** The phone's screen, inside its 9 px bezel. */
  readonly screen: Rect;
  /** Room for a close view, left of the phone. */
  readonly free: {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
  };
  /** The old photo: its width and where its top left sits (it is drawn turned -4 deg). */
  readonly polaroid: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
  };
}

/** The phone's width share on an upright phone (the prototype's `ph`, 0.47). */
export const PHONE_SHARE = 0.47;
const PHONE_ASPECT = 1.83;
/** The soft top and bottom edge of the picture the phone keeps clear of. */
const EDGE = 52;
/** A close view never larger than this, so a wide box shows more park, not a bigger one. */
const CLOSE_MAX = [400, 470] as const;
const DEG = Math.PI / 180;

const size = (v: number) => (Number.isFinite(v) && v >= 1 ? v : 1);

/**
 * @param w the film box's width, px
 * @param h its height, px
 * @param viewportW the window's width (an upright phone is narrower than 700)
 */
export function filmLayout(
  w: number,
  h: number,
  viewportW: number,
): FilmLayout {
  const W = size(w);
  const H = size(h);
  const portrait = W / H < 1.05 && size(viewportW) < 700;
  let pw = portrait ? W * PHONE_SHARE : Math.min(W * 0.4, 290);
  let ph = pw * PHONE_ASPECT;
  if (ph > H - EDGE) {
    ph = Math.max(1, H - EDGE);
    pw = ph / PHONE_ASPECT;
  }
  const mr = portrait ? 12 : Math.max(14, W * 0.04);
  const x = Math.round(W - pw - mr);
  const y = Math.round((H - ph) / 2);
  pw = Math.round(pw);
  ph = Math.round(ph);
  const pol = Math.min(pw * 0.95, 190);
  return {
    W,
    H,
    portrait,
    phone: { x, y, w: pw, h: ph },
    screen: { x: x + 9, y: y + 9, w: pw - 18, h: ph - 18 },
    free: { x0: 40, x1: Math.max(90, x - 14), y0: 26, y1: H - 10 },
    polaroid: {
      x: Math.round(x + (pw - pol) / 2),
      y: Math.round(y + ph * 0.24),
      w: pol,
    },
  };
}

/** The rectangle a close view is fitted into: the free space, capped, centred. */
export function closeRect(ly: FilmLayout): {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
} {
  const f = ly.free;
  const w = Math.min(f.x1 - f.x0, CLOSE_MAX[0]);
  const h = Math.min(f.y1 - f.y0, CLOSE_MAX[1]);
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

/** A view's target rectangle in normalised device coordinates [x0, x1, y0, y1] (-1..1, y up). */
export function ndcRect(
  view: ViewName,
  ly: FilmLayout,
): readonly [number, number, number, number] {
  if (view === "over") return [-0.91, 0.91, -0.9, 0.86];
  const f = closeRect(ly);
  return [
    (f.x0 / ly.W) * 2 - 1,
    (f.x1 / ly.W) * 2 - 1,
    1 - (f.y1 / ly.H) * 2,
    1 - (f.y0 / ly.H) * 2,
  ];
}

/** A view's camera: azimuth and elevation (radians) and vertical field of view (degrees). */
export function viewParams(
  view: ViewName,
  ly: FilmLayout,
): { az: number; el: number; fov: number } {
  if (view === "over") {
    return { az: AZ * DEG, el: (ly.W / ly.H < 1.2 ? 56 : 40) * DEG, fov: 15 };
  }
  return { az: AZ2 * DEG, el: 40 * DEG, fov: 18 };
}
