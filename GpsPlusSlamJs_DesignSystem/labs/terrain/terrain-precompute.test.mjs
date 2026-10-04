/**
 * Tests for the terrain lab's per-region precompute (terrain plan
 * 2026-09-27-0605 §4 "Precompute", §9 findings 13 and 14).
 *
 * Why this file matters: the shader never re-derives a slope. It reads the
 * gradient, the local relief and the sky view from textures this module
 * fills, because half floats are too coarse to difference at 500 m posts
 * (research §4.3). So an error here is an error in every pixel's shade and
 * every relief-driven green, with nothing downstream able to notice.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  AUX_ENCODING,
  gaussianBlur,
  gradient,
  localRelief,
  packTerrain,
  reliefStd,
  skyView,
} from "./terrain-precompute.js";

/** A side x side grid with h(col, row); row 0 is the SOUTH edge (ENU y up). */
function grid(side, h) {
  const out = new Float32Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) out[row * side + col] = h(col, row);
  }
  return out;
}

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

describe("gradient", () => {
  // A plane's slope must come back exactly, in metres per metre, east and
  // north, everywhere including the edges (one-sided there).
  it("recovers a plane's slope in m/m, edges included", () => {
    const side = 9;
    const spacing = 500;
    const h = grid(side, (c, r) => 0.2 * c * spacing - 0.05 * r * spacing + 7);
    const { gx, gy } = gradient(h, side, spacing);
    for (let i = 0; i < side * side; i++) {
      close(gx[i], 0.2, 1e-6, `gx[${i}]`);
      close(gy[i], -0.05, 1e-6, `gy[${i}]`);
    }
  });
});

describe("gaussianBlur, localRelief and reliefStd", () => {
  const side = 41;

  it("leaves a constant field constant, and its relief zero", () => {
    const h = grid(side, () => 612);
    const blurred = gaussianBlur(h, side, 3);
    for (const v of blurred) close(v, 612, 1e-9, "blur");
    for (const v of localRelief(h, side, 3)) close(v, 0, 1e-9, "relief");
    for (const v of reliefStd(h, side, 3)) close(v, 0, 1e-6, "std");
  });

  // A lone peak stands ABOVE its blurred surroundings, a pit below: the sign
  // the relief-driven shading reads.
  it("gives a peak positive relief and a pit negative", () => {
    const peak = grid(side, (c, r) => (c === 20 && r === 20 ? 300 : 0));
    const pit = grid(side, (c, r) => (c === 20 && r === 20 ? -300 : 0));
    const at = 20 * side + 20;
    assert.ok(localRelief(peak, side, 3)[at] > 0);
    assert.ok(localRelief(pit, side, 3)[at] < 0);
  });

  // The standard deviation of a two-level field sits between 0 and half the
  // step, and grows with the step: the ranges are greener than the valleys.
  it("grows the relief spread with the relief, monotonically", () => {
    const at = 20 * side + 20;
    let previous = -1;
    for (const step of [0, 50, 200, 800]) {
      const ridges = grid(side, (c) => (c % 4 < 2 ? step : 0));
      const std = reliefStd(ridges, side, 3)[at];
      assert.ok(std >= previous, `step ${step}`);
      assert.ok(std <= step / 2 + 1e-6, `step ${step}: ${std}`);
      previous = std;
    }
    assert.ok(previous > 300);
  });
});

describe("skyView", () => {
  const side = 33;
  const spacing = 500;

  it("is exactly 1 on flat ground", () => {
    const svf = skyView(
      grid(side, () => 100),
      side,
      spacing,
      {
        directions: 8,
        steps: 8,
      },
    );
    for (const v of svf) assert.equal(v, 1);
  });

  // A valley floor sees less sky than a ridge top; more walls, less sky.
  it("is lower in a valley than on a ridge", () => {
    const h = grid(side, (c) => 400 * Math.abs(c - 16));
    const svf = skyView(h, side, spacing, { directions: 8, steps: 8 });
    const valley = svf[16 * side + 16];
    const slope = svf[16 * side + 24];
    assert.ok(valley < 0.9, `valley ${valley}`);
    assert.ok(valley < slope, `valley ${valley} vs slope ${slope}`);
    for (const v of svf) assert.ok(v >= 0 && v <= 1);
  });
});

describe("packTerrain", () => {
  // The RGBA8 encodings are specified (plan §9 finding 13): the relief spread
  // up to 1000 m, the small relief signed about 128 at 2 m a step, the sky
  // view 0-1, and validity in alpha. Decoding with AUX_ENCODING (what the
  // shader uses) must round-trip within one step.
  it("packs half floats and the auxiliary bytes as the shader decodes them", () => {
    const side = 2;
    const fields = {
      height: Float32Array.of(-12.5, 0, 800, 1500),
      gx: Float32Array.of(0.1, -0.2, 0, 0.5),
      gy: Float32Array.of(0, 0, -1, 2),
      relief: Float32Array.of(3, -4, 0, 12),
      reliefStd: Float32Array.of(0, 40, 999, 5000),
      reliefSmall: Float32Array.of(-300, -2, 0, 17),
      svf: Float32Array.of(1, 0.5, 0, 0.25),
      valid: Uint8Array.of(1, 1, 0, 1),
    };
    // A stand-in for three's `DataUtils.toHalfFloat` (16 bits out), so the
    // test sees which value went into which channel.
    const toHalf = (v) => Math.round(v * 8) & 0xffff;
    const { rgba16, rgba8 } = packTerrain(fields, side, toHalf);
    assert.ok(rgba16 instanceof Uint16Array);
    assert.equal(rgba16.length, side * side * 4);
    assert.deepEqual([...rgba16.subarray(8, 12)], [800 * 8, 0, -8 & 0xffff, 0]);
    const decode = (i) => ({
      std: (rgba8[i * 4] / 255) * AUX_ENCODING.reliefStdSpanM,
      small: (rgba8[i * 4 + 1] - 128) * AUX_ENCODING.reliefSmallMPerStep,
      svf: rgba8[i * 4 + 2] / 255,
      valid: rgba8[i * 4 + 3] === 255,
    });
    close(decode(1).std, 40, 2, "std");
    close(decode(2).std, 999, 2, "std near span");
    close(decode(3).std, 1000, 1e-9, "std clamps at the span");
    close(decode(1).small, -2, 1e-9, "small");
    close(decode(3).small, 17, 1, "small rounds to a step");
    close(decode(0).small, -256, 1e-9, "small clamps");
    close(decode(1).svf, 0.5, 1 / 255, "svf");
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => decode(i).valid),
      [true, true, false, true],
    );
  });

  it("writes a sky view of 1 when none was computed yet", () => {
    const { rgba8 } = packTerrain(
      {
        height: new Float32Array(1),
        gx: new Float32Array(1),
        gy: new Float32Array(1),
        relief: new Float32Array(1),
        reliefStd: new Float32Array(1),
        reliefSmall: new Float32Array(1),
        svf: null,
        valid: Uint8Array.of(1),
      },
      1,
      (v) => v,
    );
    assert.equal(rgba8[2], 255);
  });
});
