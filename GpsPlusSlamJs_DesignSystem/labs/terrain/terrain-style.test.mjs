/**
 * Tests for style A, "Pastel atlas" (terrain plan 2026-09-27-0605 §4
 * "Styles", §5 T1; research 2026-09-27-0600 §6.1).
 *
 * Why this file matters: the shader mirrors these functions line for line,
 * and the smoke compares a rendered flat pixel with `landColour`, so this is
 * the reference the GPU is held to. A ramp that skips a stop, a green that
 * dips as the land gets more rugged, or a shade that darkens flat ground all
 * look deliberate on screen rather than broken, which is why they are
 * pinned here and not left to the eye.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  LUT,
  PASTEL_ATLAS,
  greenWeight,
  hexToRgb,
  landColour,
  multidirectionalShade,
  rampColour,
  rampLut,
  waterColour,
} from "./terrain-style.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const closeRgb = (a, b, eps, what) =>
  a.forEach((v, i) => close(v, b[i], eps, `${what}[${i}]`));

describe("hexToRgb", () => {
  it("reads #RRGGBB as 0-1 sRGB", () => {
    assert.deepEqual(hexToRgb("#FF8000"), [1, 128 / 255, 0]);
  });
  it("refuses anything else", () => {
    assert.throws(() => hexToRgb("red"), /#RRGGBB/);
  });
});

describe("the land ramp", () => {
  // Every stop the research designed, exactly at its height.
  it("hits every stop exactly", () => {
    for (const [h, hex] of PASTEL_ATLAS.land) {
      assert.deepEqual(
        rampColour(PASTEL_ATLAS.land, h),
        hexToRgb(hex),
        `${h} m`,
      );
    }
  });

  it("interpolates linearly between stops and clamps outside", () => {
    const [h0, c0] = PASTEL_ATLAS.land[1];
    const [h1, c1] = PASTEL_ATLAS.land[2];
    const mid = rampColour(PASTEL_ATLAS.land, (h0 + h1) / 2);
    const a = hexToRgb(c0);
    const b = hexToRgb(c1);
    closeRgb(
      mid,
      a.map((v, i) => (v + b[i]) / 2),
      1e-12,
      "midpoint",
    );
    assert.deepEqual(rampColour(PASTEL_ATLAS.land, 9000), hexToRgb("#F8F8F5"));
    assert.deepEqual(rampColour(PASTEL_ATLAS.land, 0), hexToRgb("#F3F0E4"));
  });

  it("has its stops in rising order", () => {
    const heights = PASTEL_ATLAS.land.map(([h]) => h);
    assert.deepEqual(
      [...heights].sort((a, b) => a - b),
      heights,
    );
  });
});

describe("the LUT the shader samples", () => {
  // The shader reads the ramp from a 256 x 1 texture over 0..LUT.maxM; each
  // texel must be the ramp at its centre's height, in sRGB bytes.
  it("stores the ramp at each texel centre", () => {
    const lut = rampLut(PASTEL_ATLAS.land);
    assert.equal(lut.length, LUT.size * 4);
    for (const i of [0, 7, 100, 255]) {
      const h = ((i + 0.5) / LUT.size) * LUT.maxM;
      const expected = rampColour(PASTEL_ATLAS.land, h).map((v) =>
        Math.round(v * 255),
      );
      assert.deepEqual(
        [...lut.subarray(i * 4, i * 4 + 3)],
        expected,
        `texel ${i}`,
      );
      assert.equal(lut[i * 4 + 3], 255);
    }
  });
});

describe("the relief-driven green", () => {
  // Research §6.1: g = smoothstep(40 m, 220 m, reliefStd) x 0.7.
  it("is 0 below R0, the full amount above R1", () => {
    assert.equal(greenWeight(0), 0);
    assert.equal(greenWeight(40), 0);
    close(greenWeight(220), PASTEL_ATLAS.greenAmount, 1e-12, "R1");
    close(greenWeight(5000), PASTEL_ATLAS.greenAmount, 1e-12, "far above");
  });

  it("never falls as the land gets more rugged", () => {
    let previous = -1;
    for (let std = 0; std <= 400; std += 2.5) {
      const g = greenWeight(std);
      assert.ok(g >= previous, `${std} m`);
      previous = g;
    }
  });

  // The swept thresholds (research §6.1): with R0 = 20 m the Piedmont
  // (under 100 m of spread) greens too; with R0 = 100 m it stays cream.
  for (const [r0, piedmontGreens] of [
    [20, true],
    [40, true],
    [100, false],
  ]) {
    it(`with R0 = ${r0} m a 70 m spread ${piedmontGreens ? "greens" : "stays cream"}`, () => {
      const g = greenWeight(70, { ...PASTEL_ATLAS, greenR0: r0 });
      assert.equal(g > 0, piedmontGreens);
    });
  }

  it("mixes the ramp toward the green by that weight", () => {
    const h = 800;
    const flat = landColour(PASTEL_ATLAS, h, 0);
    assert.deepEqual(flat, rampColour(PASTEL_ATLAS.land, h));
    const rugged = landColour(PASTEL_ATLAS, h, 1000);
    const green = hexToRgb(PASTEL_ATLAS.green);
    const w = PASTEL_ATLAS.greenAmount;
    closeRgb(
      rugged,
      flat.map((v, i) => v + (green[i] - v) * w),
      1e-12,
      "rugged",
    );
  });
});

describe("water", () => {
  it("runs from the shore colour at 0 m to the deep colour at -200 m", () => {
    assert.deepEqual(waterColour(PASTEL_ATLAS, 0), hexToRgb("#AFCFE3"));
    assert.deepEqual(waterColour(PASTEL_ATLAS, -200), hexToRgb("#9CC3DB"));
    assert.deepEqual(waterColour(PASTEL_ATLAS, -5000), hexToRgb("#9CC3DB"));
  });
});

describe("multidirectionalShade", () => {
  // Patterson's "no grey in flat areas": flat ground reads exactly 1, so
  // the shadow and highlight terms leave it untouched.
  it("is exactly 1 on flat ground", () => {
    assert.equal(multidirectionalShade(0, 0), 1);
  });

  // The lights sit in the north-west quadrant (225-360°): a slope facing
  // north-west (rising to the south-east) is lit, its opposite shaded.
  it("lights a north-west-facing slope and shades a south-east-facing one", () => {
    const facingNw = multidirectionalShade(0.3, -0.3);
    const facingSe = multidirectionalShade(-0.3, 0.3);
    assert.ok(facingNw > 1, `nw ${facingNw}`);
    assert.ok(facingSe < 1, `se ${facingSe}`);
  });

  // The shade grows away from 1 with the slope: the boost makes wrinkles
  // visible at 250 km only if a steeper normal really does shade more.
  it("moves further from 1 as the slope steepens", () => {
    let previous = 1;
    for (const s of [0.05, 0.1, 0.2, 0.4]) {
      const shade = multidirectionalShade(-s, s);
      assert.ok(shade < previous, `${s}`);
      previous = shade;
    }
  });
});
