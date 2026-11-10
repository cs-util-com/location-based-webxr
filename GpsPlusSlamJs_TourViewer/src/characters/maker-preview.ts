/**
 * The character maker's previews: the four outdoor backdrops, the talking
 * and pointing timings, and drawing a cut frame onto a canvas. The timings
 * are pure and tested; the drawing is the device seam, checked in the
 * browser.
 */

import type { BackdropId } from "./maker-draft.js";
import type { RgbaImage } from "./rgba-image.js";

export type Backdrop = BackdropId | "checks";

export const BACKDROPS: readonly {
  id: BackdropId;
  label: string;
  css: string;
}[] = [
  {
    id: "meadow",
    label: "Meadow",
    css: "linear-gradient(#cfe3ee 50%, #8fb36b 50%)",
  },
  {
    id: "autumn",
    label: "Autumn path",
    css: "linear-gradient(#f3d9b8 50%, #c0763a 50%)",
  },
  {
    id: "city",
    label: "City stone",
    css: "linear-gradient(#c9d1d8 50%, #a9aaa8 50%)",
  },
  {
    id: "snow",
    label: "Snow and sky",
    css: "linear-gradient(#9cc4e8 50%, #f6f9fc 50%)",
  },
];

/** Sky gradient, horizon band and ground gradient per backdrop. */
const SKY_GROUND: Record<
  BackdropId,
  readonly [readonly [string, string], string, readonly [string, string]]
> = {
  meadow: [["#cfe3ee", "#eef3e6"], "#9aa77e", ["#8fb36b", "#5f8a45"]],
  autumn: [["#f3d9b8", "#f7ecd9"], "#b0794a", ["#c0763a", "#7a4524"]],
  city: [["#c9d1d8", "#e9ecee"], "#8a8d90", ["#a9aaa8", "#6f7174"]],
  snow: [["#9cc4e8", "#dcebf7"], "#c9d6e2", ["#f6f9fc", "#dbe4ee"]],
};

/** The mouth pattern while talking: 0 closed, 1 half open, 2 wide open. */
const TALK = [1, 2, 1, 2, 2, 1, 0, 1, 2, 1, 2, 0, 1, 2, 2, 1] as const;
const TALK_PERIOD_MS = 2800;
const TALK_FROM_MS = 900;
const TALK_TO_MS = 2620;
const TALK_STEP_MS = 110;
const BECKON_PERIOD_MS = 3200;

/** The frame shown at time `t` (ms) of the talking preview. */
export function talkIndex(t: number): number {
  const p = ((t % TALK_PERIOD_MS) + TALK_PERIOD_MS) % TALK_PERIOD_MS;
  if (p < TALK_FROM_MS || p > TALK_TO_MS) return 0;
  return TALK[Math.floor((p - TALK_FROM_MS) / TALK_STEP_MS) % TALK.length]!;
}

/** The frame shown at time `t` (ms) of the pointing preview. */
export function beckonIndex(t: number): number {
  const p = ((t % BECKON_PERIOD_MS) + BECKON_PERIOD_MS) % BECKON_PERIOD_MS;
  return p > 1000 && p < 2900 ? 3 : 0;
}

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: Backdrop,
): void {
  if (kind === "checks") {
    const s = 16;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = (x / s + y / s) % 2 ? "#d9d9d9" : "#f4f4f4";
        ctx.fillRect(x, y, s, s);
      }
    }
    return;
  }
  const [sky, horizon, ground] = SKY_GROUND[kind];
  const g1 = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  g1.addColorStop(0, sky[0]);
  g1.addColorStop(1, sky[1]);
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = horizon;
  ctx.fillRect(0, h * 0.6, w, h * 0.06);
  const g2 = ctx.createLinearGradient(0, h * 0.62, 0, h);
  g2.addColorStop(0, ground[0]);
  g2.addColorStop(1, ground[1]);
  ctx.fillStyle = g2;
  ctx.fillRect(0, h * 0.64, w, h);
}

/** An RgbaImage as a canvas, for drawing and for writing a PNG. */
export function canvasOf(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      0,
      0,
    );
  }
  return c;
}

/** A canvas as PNG bytes. */
export function pngOf(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("the picture could not be written")),
      "image/png",
    ),
  );
}

/** The figure standing on the backdrop, with a soft ground shadow. */
export function drawFigure(
  canvas: HTMLCanvasElement,
  frame: HTMLCanvasElement | null,
  kind: Backdrop,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  paintBackdrop(ctx, w, h, kind);
  const base = h * 0.95;
  ctx.fillStyle =
    kind === "checks" ? "rgb(0 0 0 / 12%)" : "rgb(20 30 10 / 26%)";
  ctx.beginPath();
  ctx.ellipse(w / 2, base, w * 0.17, h * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!frame) return;
  const s = (h * 0.9) / frame.height;
  ctx.drawImage(
    frame,
    w / 2 - (frame.width * s) / 2,
    base - frame.height * 0.96 * s,
    frame.width * s,
    frame.height * s,
  );
}

/** The bottom of a frame enlarged, without smoothing, so stray dots show. */
export function drawFeet(
  canvas: HTMLCanvasElement,
  frame: HTMLCanvasElement | null,
  kind: Backdrop,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.translate(0, -2 * h);
  paintBackdrop(ctx, w, 3 * h, kind);
  ctx.restore();
  if (!frame) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 156, 899, 200, 125, 0, 0, w, h);
}

/** Preview animations kept by slot (a canvas's id). */
export interface AnimSet<T> {
  /** Keeps `anim` under `slot`, replacing the one there. */
  put(slot: string, anim: T): void;
  all(): IterableIterator<T>;
  readonly size: number;
}

/** Preview animations by slot: a preview drawn again (each re-cut rebuilds
 *  the talk-style canvases) replaces its earlier animation, so the old
 *  canvases and the frames they drew are let go. */
export function createAnimSet<T>(): AnimSet<T> {
  const bySlot = new Map<string, T>();
  return {
    put(slot, anim) {
      bySlot.set(slot, anim);
    },
    all: () => bySlot.values(),
    get size() {
      return bySlot.size;
    },
  };
}
