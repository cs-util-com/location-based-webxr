import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  drawMatches,
  pickLines,
  sideBySide,
  type DrawContext,
} from "./bench-draw";

// Why these tests matter: the result pictures are how a method's matches
// are judged by eye on a phone; both frames must share one scale (or the
// lines lean), the canvas must stay small enough for a phone to keep a
// dozen of them, and a method with a thousand matches must not paint the
// pair solid.
describe("sideBySide", () => {
  it("puts both frames at one scale within the width, never enlarged", () => {
    const l = sideBySide(
      { width: 549, height: 1280 },
      { width: 549, height: 1280 },
      640,
      8,
    );
    expect(l.scale).toBeCloseTo(632 / 1098, 9);
    expect(l.width).toBeLessThanOrEqual(640);
    expect(l.bx).toBe(Math.round(549 * l.scale) + 8);
    expect(l.height).toBe(Math.round(1280 * l.scale));
    const small = sideBySide(
      { width: 40, height: 30 },
      { width: 40, height: 30 },
      640,
      8,
    );
    expect(small.scale).toBe(1);
    expect([small.width, small.height, small.bx]).toEqual([88, 30, 48]);
  });

  it("always fits the width for any pair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 64, max: 2000 }),
        (aw, ah, bw, bh, max) => {
          const l = sideBySide(
            { width: aw, height: ah },
            { width: bw, height: bh },
            max,
            8,
          );
          expect(l.width).toBeLessThanOrEqual(max);
          expect(l.scale).toBeLessThanOrEqual(1);
          expect(l.height).toBeGreaterThanOrEqual(1);
        },
      ),
    );
  });
});

describe("pickLines", () => {
  it("keeps every line under the cap", () => {
    expect(pickLines(3, 200)).toEqual([0, 1, 2]);
  });

  it("spreads the cap evenly over many lines, first and distinct", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 400 }),
        (n, cap) => {
          const picked = pickLines(n, cap);
          expect(picked).toHaveLength(Math.min(n, cap));
          expect(new Set(picked).size).toBe(picked.length);
          expect(picked.every((i) => i >= 0 && i < n)).toBe(true);
          expect(picked[0]).toBe(n > 0 ? 0 : undefined);
        },
      ),
    );
  });
});

/** A context that records what is drawn. */
function recorder(): DrawContext & {
  images: number[][];
  lines: number[][];
  dots: number;
} {
  let from: number[] = [];
  const r = {
    images: [] as number[][],
    lines: [] as number[][],
    dots: 0,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      r.images.push([x, y, w, h]);
    },
    fillRect: () => {
      r.dots++;
    },
    beginPath: () => undefined,
    moveTo: (x: number, y: number) => {
      from = [x, y];
    },
    lineTo: (x: number, y: number) => {
      r.lines.push([...from, x, y]);
    },
    stroke: () => undefined,
  };
  return r;
}

describe("drawMatches", () => {
  it("draws both frames, every keypoint and capped lines between matched points", () => {
    const ctx = recorder();
    const layout = sideBySide(
      { width: 8, height: 4 },
      { width: 8, height: 4 },
      100,
      4,
    );
    const shown = drawMatches(ctx, {
      layout,
      imageA: {},
      imageB: {},
      frameA: { width: 8, height: 4 },
      frameB: { width: 8, height: 4 },
      size: { width: 4, height: 2 },
      sample: {
        a: { x: new Float32Array([0, 3]), y: new Float32Array([0, 1]) },
        b: { x: new Float32Array([1.5]), y: new Float32Array([0.5]) },
        pairs: new Int32Array([1, 0, 0, 0]),
      },
      lineCap: 1,
    });
    expect(ctx.images).toEqual([
      [0, 0, 8, 4],
      [12, 0, 8, 4],
    ]);
    expect(ctx.dots).toBe(3);
    expect(shown).toBe(1);
    // Match 0 is A's keypoint 1 (size 3,1 -> frame 6.5,2.5) to B's 0
    // (size 1.5,0.5 -> frame 3.5,1.5), drawn at pixel centres (+0.5).
    expect(ctx.lines).toEqual([[7, 3, 12 + 4, 2]]);
  });
});
