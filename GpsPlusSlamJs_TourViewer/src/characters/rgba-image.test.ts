import { describe, expect, it } from "vitest";

import {
  blankImage,
  drawScaled,
  scaledImage,
  type RgbaImage,
} from "./rgba-image.js";

function image(w: number, h: number, pixels: number[][]): RgbaImage {
  const img = blankImage(w, h);
  pixels.forEach((p, i) => img.data.set(p, i * 4));
  return img;
}

// Why these tests matter: the cut scales poses with this resampler instead
// of a canvas, so it must average by area and never let the colour under a
// transparent pixel bleed into a figure's edge (a dark or white fringe).
describe("scaledImage", () => {
  it("averages a 2 x 2 block into one pixel", () => {
    const img = image(2, 2, [
      [0, 0, 0, 255],
      [200, 200, 200, 255],
      [100, 100, 100, 255],
      [100, 100, 100, 255],
    ]);
    const out = scaledImage(img, 0.5);
    expect(out.width).toBe(1);
    expect([...out.data]).toEqual([100, 100, 100, 255]);
  });

  it("keeps the colour of the opaque pixels next to transparent ones", () => {
    const img = image(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 0],
    ]);
    const out = scaledImage(img, 0.5);
    expect([...out.data]).toEqual([255, 0, 0, 128]);
  });

  it("enlarges by repeating, area-weighted", () => {
    const img = image(1, 1, [[10, 20, 30, 255]]);
    const out = scaledImage(img, 3);
    expect(out.width).toBe(3);
    for (let i = 0; i < 9; i++) {
      expect([...out.data.subarray(i * 4, i * 4 + 4)]).toEqual([
        10, 20, 30, 255,
      ]);
    }
  });
});

describe("drawScaled", () => {
  it("covers a target pixel only partly at a fractional edge", () => {
    const src = image(1, 1, [[0, 0, 0, 255]]);
    const dst = blankImage(2, 1);
    drawScaled(src, 0, 0, 1, 1, dst, 0.5, 0, 1, 1);
    expect(dst.data[3]).toBe(128);
    expect(dst.data[7]).toBe(128);
  });

  it("skips an empty rectangle and pixels outside the target", () => {
    const src = image(1, 1, [[9, 9, 9, 255]]);
    const dst = blankImage(1, 1);
    drawScaled(src, 0, 0, 0, 1, dst, 0, 0, 1, 1);
    drawScaled(src, 0, 0, 1, 1, dst, 5, 5, 1, 1);
    expect([...dst.data]).toEqual([0, 0, 0, 0]);
  });
});
