/**
 * The water polish smoke's pixel metrics (round-3 stream W).
 *
 * Why this test matters: every verdict on a water trick rests on these
 * numbers. A metric that reads the wrong rows, counts an edge as texture,
 * or calls a smooth gradient "glitter" would pass or fail a trick for the
 * wrong reason, and on the GPU nobody would see it. Each is checked here on
 * a synthetic frame whose answer is known.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bands,
  changed,
  channelFrame,
  diffMask,
  erode,
  identical,
  laplacian,
  meanAbsDiff,
  patchiness,
  repetition,
  sparkles,
  stats,
} from "./water-metrics.mjs";

/** A grey frame from a luminance function f(x, y), y = 0 the bottom row. */
function frame(width, height, f) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
      const i = 4 * (y * width + x);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
const full = (w, h) => new Uint8Array(w * h).fill(1);
/** A deterministic pseudo-random value in [0, 1) per pixel. */
const noise = (x, y) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
};

describe("masks", () => {
  it("marks exactly the pixels that differ, and erodes their edge", () => {
    const a = frame(20, 10, () => 100);
    const b = frame(20, 10, (x, y) => (x >= 5 && x < 15 && y >= 2 ? 200 : 100));
    const mask = diffMask(a, b);
    assert.equal(
      mask.reduce((s, v) => s + v, 0),
      10 * 8,
    );
    const inner = erode(mask, 20, 10, 1);
    assert.equal(inner[5 * 20 + 5], 0);
    assert.equal(inner[5 * 20 + 6], 1);
    assert.equal(inner[9 * 20 + 10], 0); // the frame's top row
  });

  // Band 0 must be the NEAR water: the LOWEST rows of the image, which come
  // first in readPixels' bottom-up data.
  it("splits into equal-share bands from the bottom of the image up", () => {
    const mask = full(10, 40);
    const [near, far] = bands(mask, 10, 2);
    assert.equal(near[0], 1);
    assert.equal(near[39 * 10], 0);
    assert.equal(far[39 * 10], 1);
    assert.equal(
      near.reduce((s, v) => s + v, 0),
      far.reduce((s, v) => s + v, 0),
    );
  });
});

describe("texture metrics", () => {
  it("reads a smooth gradient as no texture and noise as texture", () => {
    const w = 64;
    const smooth = frame(w, w, (x) => 50 + x);
    const rough = frame(w, w, (x, y) => 50 + 100 * noise(x, y));
    const mask = full(w, w);
    assert.ok(laplacian(smooth, mask) < 0.5);
    assert.ok(laplacian(rough, mask) > 30);
    assert.equal(stats(smooth, mask).n, w * w);
    assert.ok(Math.abs(stats(smooth, mask).mean - 81.5) < 0.6);
  });

  it("counts isolated glints, not bright areas", () => {
    const w = 40;
    const glints = frame(w, w, (x, y) =>
      x % 8 === 3 && y % 8 === 3 ? 250 : 60,
    );
    const block = frame(w, w, (x, y) => (x < 20 ? 250 : 60));
    const mask = full(w, w);
    const share = sparkles(glints, mask);
    assert.ok(Math.abs(share - 25 / (36 * 36)) < 1e-9, String(share));
    assert.equal(sparkles(block, mask), 0);
    // A glint two pixels wide still counts (both pixels).
    const pairs = frame(w, w, (x, y) =>
      (x === 10 || x === 11) && y === 10 ? 250 : 60,
    );
    assert.ok(Math.abs(sparkles(pairs, mask) - 2 / (36 * 36)) < 1e-9);
  });

  it("measures shimmer as the mean luminance change", () => {
    const a = frame(10, 10, () => 100);
    const b = frame(10, 10, (x) => (x < 5 ? 110 : 100));
    assert.ok(Math.abs(meanAbsDiff(a, b, full(10, 10)) - 5) < 1e-9);
  });

  // The normal view encodes x in red: the metrics must read that channel.
  it("reads one channel as the grey value", () => {
    const f = { width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) };
    assert.deepEqual([...channelFrame(f, 0).data], [10, 10, 10, 255]);
    assert.deepEqual([...channelFrame(f, 2).data], [30, 30, 30, 255]);
  });

  // Gusts make texture vary across the surface; a uniform texture does not.
  it("reads patchy texture as patchy", () => {
    const w = 128;
    const uniform = frame(w, w, (x, y) => 100 + 60 * (noise(x, y) - 0.5));
    const patchy = frame(
      w,
      w,
      (x, y) => 100 + (x < 64 ? 100 : 10) * (noise(x, y) - 0.5),
    );
    const mask = full(w, w);
    assert.ok(patchiness(uniform, mask, 32) < 0.1);
    assert.ok(patchiness(patchy, mask, 32) > 0.5);
    assert.ok(patchiness(uniform, mask, 32, "std") < 0.1);
    assert.ok(patchiness(patchy, mask, 32, "std") > 0.5);
  });
});

describe("repetition", () => {
  // A pattern that repeats every 16 px reads close to 1; the same pattern
  // with its phase broken by noise reads far lower. The high-pass keeps a
  // long gradient from reading as a repeat.
  it("finds an exact repeat, and not one in noise or a long gradient", () => {
    const w = 160;
    const mask = full(w, w);
    const periodic = frame(w, w, (x, y) => 100 + 80 * noise(x % 16, y % 16));
    const random = frame(w, w, (x, y) => 100 + 80 * noise(x, y));
    const ramp = frame(w, w, (x, y) => x + 20 * noise(x, y));
    const opts = { size: 128, minLag: 8, step: 1, highpass: 4 };
    assert.ok(repetition(periodic, mask, opts) > 0.9);
    assert.ok(repetition(random, mask, opts) < 0.3);
    // Without the high-pass the gradient reads as a near-perfect repeat.
    assert.ok(repetition(ramp, mask, { ...opts, highpass: 0 }) > 0.9);
    assert.ok(repetition(ramp, mask, opts) < 0.3);
    assert.equal(repetition(periodic, new Uint8Array(w * w), opts), null);
    // Several windows average: a frame periodic on the left half only
    // reads lower over windows spread across it than at its first window.
    const half = frame(w * 2, w, (x, y) =>
      x < w ? 100 + 80 * noise(x % 16, y % 16) : 100 + 80 * noise(x, y),
    );
    const wide = full(w * 2, w);
    const first = repetition(half, wide, opts);
    const spread = repetition(half, wide, { ...opts, windows: 3 });
    assert.ok(first > 0.9);
    assert.ok(spread < first - 0.2, `${spread} vs ${first}`);
  });
});

describe("frame comparisons", () => {
  it("measures the changed share and byte identity", () => {
    const a = frame(10, 10, () => 100);
    const b = frame(10, 10, (x) => (x < 3 ? 110 : 100));
    const mask = full(10, 10);
    assert.equal(changed(a, b, mask), 0.3);
    assert.equal(changed(a, a, mask), 0);
    assert.equal(identical(a, a), true);
    assert.equal(identical(a, b), false);
  });
});
