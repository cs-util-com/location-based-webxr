/**
 * Tests for the terrain lab's relief coloured from the globe imagery
 * (globe round-5 plan 2026-10-01-0945 §3.3: `globe-albedo`, C1, and
 * `globe-bands`, C3).
 *
 * Why this file matters: the owner's core idea is that the relief takes its
 * colour from the Blue Marble pixels the globe already shows, so that the
 * relief and the globe agree where they meet. Each approach therefore has
 * one property that makes it that approach, and each is pinned here before
 * any pixel is drawn: C1's detail is a luminance-only high-pass (it moves
 * no hue and, averaged over an imagery pixel, nothing at all), C3's ramp is
 * the imagery's own mean colour per height band. The box means and the
 * colour difference are the measuring tools the comparison page reports
 * with, so they are held to hand-computable values.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { srgbToLinear } from "./terrain-far-field.js";
import { sunLitColour } from "./terrain-sun.js";
import {
  GLOBE_ALBEDO,
  bandRamp,
  bandRampColour,
  bandRampLut,
  bandSweep,
  boxMeanAt,
  deltaE76,
  detailRatio,
  foldOf,
  footprintLuminanceGrid,
  footprintM,
  globeAlbedoColour,
  globeAlbedoLinear,
  linearLuminance,
  rampFitError,
  summedArea,
} from "./terrain-globe-colour.js";

const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/** A seeded generator, so a failing property case can be replayed. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("linearLuminance", () => {
  it("is Rec. 709 luminance of the decoded colour: white 1, black 0", () => {
    assert.equal(linearLuminance([1, 1, 1]), 1);
    assert.equal(linearLuminance([0, 0, 0]), 0);
    close(linearLuminance([0, 1, 0]), 0.7152, 1e-12, "green");
    close(linearLuminance([0.5, 0.5, 0.5]), srgbToLinear(0.5), 1e-12, "grey");
  });
});

describe("C1 globe-albedo: the detail ratio", () => {
  it("is 1 with no detail, and 1 where the fine ramp equals its footprint mean", () => {
    assert.equal(detailRatio(0.2, 0.1, 0), 1);
    assert.equal(detailRatio(0.1, 0.1, 1), 1);
  });

  it("follows the fine ramp's contrast to its footprint mean, scaled by the weight", () => {
    close(detailRatio(0.12, 0.1, 1), 1.2, 1e-12, "full");
    close(detailRatio(0.12, 0.1, 0.5), 1.1, 1e-12, "half");
    close(detailRatio(0.08, 0.1, 0.5), 0.9, 1e-12, "darker");
  });

  it("is clamped to its range and safe on a black footprint", () => {
    const [lo, hi] = GLOBE_ALBEDO.ratioRange;
    assert.equal(detailRatio(1, 0.01, 1), hi);
    assert.equal(detailRatio(0, 0.5, 1), lo);
    assert.equal(detailRatio(0.3, 0, 1), 1);
    assert.equal(detailRatio(Number.NaN, 0.2, 1), 1);
  });

  it("refuses a weight outside 0-1", () => {
    assert.throws(() => detailRatio(0.1, 0.1, 1.5), RangeError);
    assert.throws(() => detailRatio(0.1, 0.1, -0.1), RangeError);
  });
});

describe("C1 globe-albedo: the colour", () => {
  const next = random(11);

  // With no detail the relief IS the globe: the imagery pixel under the
  // same sun term, so open flat ground matches the globe's own pixel.
  it("is the sun-lit imagery with no detail", () => {
    for (let k = 0; k < 100; k++) {
      const albedo = [next(), next(), next()];
      const light = next();
      assert.deepEqual(
        globeAlbedoColour({
          albedo,
          light,
          fineLum: next(),
          coarseLum: 0.3,
          detail: 0,
        }),
        sunLitColour(albedo, light),
      );
    }
  });

  // "Luminance-only": the detail is a scalar on the light, so the imagery's
  // colour is the same albedo, only lit more or less. Whatever the tone
  // curve's toe then does to the hue (measured: up to 0.03 saturation) is
  // what the globe itself does to a brighter or darker pixel of it.
  it("is the same albedo under a scaled light: no hue of its own (property)", () => {
    for (let k = 0; k < 300; k++) {
      const albedo = [next(), next(), next()];
      const light = next();
      const fineLum = next() * 0.3;
      const coarseLum = 0.05 + next() * 0.3;
      const detail = next();
      assert.deepEqual(
        globeAlbedoColour({ albedo, light, fineLum, coarseLum, detail }),
        sunLitColour(albedo, light * detailRatio(fineLum, coarseLum, detail)),
        `case ${k}`,
      );
    }
  });

  // Review 2026-10-01-1650 m5: "luminance-only" in the light the globe
  // draws, before its tone curve: the radiance's chromaticity is the
  // albedo's own for any light, ramp and weight.
  it("keeps the albedo's linear chromaticity whatever the detail (property)", () => {
    const chroma = (rgb) => {
      const sum = rgb[0] + rgb[1] + rgb[2];
      return rgb.map((v) => v / sum);
    };
    for (let k = 0; k < 300; k++) {
      const albedo = [0.05 + next(), 0.05 + next(), 0.05 + next()].map((v) =>
        Math.min(1, v),
      );
      const lin = globeAlbedoLinear({
        albedo,
        light: 0.1 + next(),
        fineLum: next() * 0.3,
        coarseLum: 0.05 + next() * 0.3,
        detail: next(),
      });
      const want = chroma(albedo.map(srgbToLinear));
      chroma(lin).forEach((v, i) => close(v, want[i], 1e-12, `case ${k}`));
    }
  });

  it("brightens where the fine ramp is lighter than its footprint, darkens where darker", () => {
    const base = {
      albedo: [0.3, 0.35, 0.2],
      light: 0.6,
      coarseLum: 0.1,
      detail: 0.5,
    };
    const y = (c) => linearLuminance(c);
    const flat = y(globeAlbedoColour({ ...base, fineLum: 0.1 }));
    assert.ok(y(globeAlbedoColour({ ...base, fineLum: 0.14 })) > flat);
    assert.ok(y(globeAlbedoColour({ ...base, fineLum: 0.06 })) < flat);
  });
});

describe("box means over a grid (the imagery pixel's footprint)", () => {
  // A 5 x 5 post grid, 100 m spacing, centred on 0: posts at -200..200.
  const grid = { side: 5, spacingM: 100, extentM: 200 };
  const values = Float64Array.from({ length: 25 }, (_, i) => i);
  const sat = summedArea(values, grid.side);

  it("is the plain mean of the posts inside the box", () => {
    // Posts at x, y in {-100, 0, 100}: rows 1-3, columns 1-3.
    let sum = 0;
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) sum += r * 5 + c;
    close(boxMeanAt(sat, grid, 0, 0, 250, 250), sum / 9, 1e-12, "3x3");
    // One post: the box is narrower than the spacing.
    close(boxMeanAt(sat, grid, 100, -100, 50, 50), 1 * 5 + 3, 1e-12, "one");
  });

  it("is clipped to the grid at its edge, and null outside it", () => {
    // Posts at x in {-200, -100}, y in {-200, -100}: rows 0-1, columns 0-1.
    close(
      boxMeanAt(sat, grid, -200, -200, 250, 250),
      (0 + 1 + 5 + 6) / 4,
      1e-12,
      "corner",
    );
    assert.equal(boxMeanAt(sat, grid, 1000, 0, 100, 100), null);
  });

  it("equals a brute-force mean for random boxes (property)", () => {
    const next = random(3);
    const big = { side: 41, spacingM: 500, extentM: 10_000 };
    const v = Float64Array.from({ length: 41 * 41 }, () => next() * 1000);
    const s = summedArea(v, 41);
    for (let k = 0; k < 200; k++) {
      const x = (next() - 0.5) * 18_000;
      const y = (next() - 0.5) * 18_000;
      const wx = 300 + next() * 4000;
      const wy = 300 + next() * 4000;
      let sum = 0;
      let n = 0;
      for (let r = 0; r < 41; r++) {
        for (let c = 0; c < 41; c++) {
          const px = -10_000 + c * 500;
          const py = -10_000 + r * 500;
          if (Math.abs(px - x) <= wx / 2 && Math.abs(py - y) <= wy / 2) {
            sum += v[r * 41 + c];
            n += 1;
          }
        }
      }
      const got = boxMeanAt(s, big, x, y, wx, wy);
      if (n === 0) assert.equal(got, null, `case ${k}`);
      else close(got, sum / n, 1e-6, `case ${k}`);
    }
  });
});

describe("C1's coarse luminance (review 2026-10-01-1650 m5)", () => {
  // "Mean-preserving" is what makes the detail a high-pass: over the
  // imagery pixel's footprint the light it adds and takes cancel, so the
  // footprint keeps the imagery's (the globe's) brightness. At a texel
  // centre this is exact for the UNCLAMPED ratio; the clamp and the
  // shader's bilinear read make it approximate in between.
  it("makes the footprint mean of the unclamped detail ratio 1 at every texel (property)", () => {
    const next = random(29);
    const grid = { side: 41, spacingM: 500, extentM: 10_000 };
    const fineLum = Float64Array.from(
      { length: 41 * 41 },
      () => 0.02 + next() * 0.5,
    );
    const footprint = [1700, 2450];
    const side = 8;
    const halfM = 8000;
    const coarse = footprintLuminanceGrid({
      fineLum,
      grid,
      halfM,
      side,
      footprint,
    });
    assert.equal(coarse.length, side * side);
    const step = (2 * halfM) / side;
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        const x = -halfM + (c + 0.5) * step;
        const y = -halfM + (r + 0.5) * step;
        const inside = [];
        for (let j = 0; j < 41; j++) {
          for (let i = 0; i < 41; i++) {
            const px = -10_000 + i * 500;
            const py = -10_000 + j * 500;
            if (
              Math.abs(px - x) <= footprint[0] / 2 &&
              Math.abs(py - y) <= footprint[1] / 2
            ) {
              inside.push(fineLum[j * 41 + i]);
            }
          }
        }
        const cl = coarse[r * side + c];
        for (const detail of [0.3, 1]) {
          const ratios = inside.map((f) => 1 + detail * (f / cl - 1));
          const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
          close(mean, 1, 1e-6, `texel ${r},${c} detail ${detail}`);
        }
      }
    }
  });

  it("is 0 where no post lies under the footprint", () => {
    const grid = { side: 3, spacingM: 1000, extentM: 1000 };
    const out = footprintLuminanceGrid({
      fineLum: new Float64Array(9).fill(0.5),
      grid,
      halfM: 10_000,
      side: 2,
      footprint: [100, 100],
    });
    assert.deepEqual([...out], [0, 0, 0, 0]);
  });
});

describe("footprintM: an imagery pixel on the ground", () => {
  it("is 180 / 2^level / 256 degrees, about 2.45 km north-south at level 5", () => {
    const [wx, wy] = footprintM(5, 0);
    close(wy, 2446, 5, "level 5 north-south");
    close(wx, wy, 1e-9, "equator: square");
    const [ax] = footprintM(5, 60);
    close(ax, wy / 2, 1, "60°: half as wide");
    close(footprintM(4, 0)[1], 2 * wy, 1e-9, "level 4: twice");
  });
});

describe("C3 globe-bands: the ramp", () => {
  const green = [0.3, 0.45, 0.2];
  const grey = [0.55, 0.55, 0.55];
  const sea = [0.05, 0.1, 0.3];

  it("is each band's mean imagery colour, in linear light", () => {
    const ramp = bandRamp(
      [
        { heightM: 100, rgb: [0.2, 0.4, 0.2] },
        { heightM: 150, rgb: [0.4, 0.6, 0.2] },
        { heightM: 1500, rgb: grey },
        { heightM: -20, rgb: sea },
      ],
      { widthM: 500 },
    );
    assert.equal(ramp.bands.length, 2);
    const low = ramp.bands[0];
    assert.equal(low.count, 2);
    close(low.heightM, 125, 1e-9, "the band's mean height");
    const want = [0.2, 0.4, 0.2].map(
      (v, i) => (srgbToLinear(v) + srgbToLinear([0.4, 0.6, 0.2][i])) / 2,
    );
    // 1e-4: three's sRGB encoding (exponent 0.41666) is not the exact
    // inverse of its decoding.
    low.rgb
      .map(srgbToLinear)
      .forEach((v, i) => close(v, want[i], 1e-4, `[${i}]`));
    sea.forEach((v, i) => close(ramp.sea[i], v, 1e-4, `sea[${i}]`));
  });

  it("interpolates between populated bands and holds its ends", () => {
    const ramp = bandRamp(
      [
        { heightM: 500, rgb: green },
        { heightM: 2500, rgb: grey },
      ],
      { widthM: 200 },
    );
    assert.deepEqual(bandRampColour(ramp, 0), bandRampColour(ramp, 500));
    assert.deepEqual(bandRampColour(ramp, 4000), bandRampColour(ramp, 2500));
    const mid = bandRampColour(ramp, 1500).map(srgbToLinear);
    const want = green.map(
      (v, i) => (srgbToLinear(v) + srgbToLinear(grey[i])) / 2,
    );
    mid.forEach((v, i) => close(v, want[i], 1e-4, `mid[${i}]`));
  });

  it("has no sea without sea samples, and refuses a band width outside 10-5000 m", () => {
    const ramp = bandRamp([{ heightM: 10, rgb: green }], { widthM: 300 });
    assert.equal(ramp.sea, null);
    assert.throws(() => bandRamp([], { widthM: 5 }), RangeError);
    assert.throws(() => bandRamp([], { widthM: Number.NaN }), RangeError);
  });

  it("refuses an empty land set when asked for a colour", () => {
    const ramp = bandRamp([{ heightM: -5, rgb: sea }], { widthM: 300 });
    assert.equal(bandRampColour(ramp, 100), null);
  });

  it("fits a ramp that IS a function of height exactly, at any band width (property)", () => {
    const next = random(17);
    const truth = (h) => [0.2 + h / 10_000, 0.4 - h / 20_000, 0.25];
    const samples = Array.from({ length: 2000 }, () => {
      const h = next() * 4000;
      return { heightM: h, rgb: truth(h) };
    });
    for (const widthM of [100, 200, 400, 800]) {
      const ramp = bandRamp(samples, { widthM });
      // Linear in sRGB is not linear in light, and the ramp interpolates
      // between band means: under half a just-noticeable difference (2.3).
      const err = rampFitError(ramp, samples);
      assert.ok(err.mean < 1, `${widthM} m: mean ΔE ${err.mean}`);
    }
  });

  it("writes its LUT as rampLut does: the ramp at each texel's centre", () => {
    const ramp = bandRamp(
      [
        { heightM: 300, rgb: green },
        { heightM: 3000, rgb: grey },
      ],
      { widthM: 300 },
    );
    const lut = bandRampLut(ramp, { size: 8, maxM: 4000 });
    assert.equal(lut.length, 32);
    const at = bandRampColour(ramp, ((5 + 0.5) / 8) * 4000);
    at.forEach((v, i) => assert.equal(lut[5 * 4 + i], Math.round(v * 255)));
    assert.equal(lut[5 * 4 + 3], 255);
  });
});

describe("C3 globe-bands: the band-width sweep", () => {
  // The sweep is how the band width is chosen (plan §3.3: 100-800 m). Its
  // honest number is the CROSS-VALIDATED error: a ramp fitted on one half
  // of the pixels, judged on the other, so narrow bands cannot win by
  // fitting their own noise.
  it("reports in-sample and two-fold cross-validated errors per width", () => {
    const next = random(23);
    const truth = (h) => [
      0.25 + h / 12_000,
      0.45 - h / 15_000,
      0.2 + h / 20_000,
    ];
    const samples = Array.from({ length: 4000 }, (_, i) => {
      const h = next() * 3500;
      const noise = () => (next() - 0.5) * 0.1;
      return {
        heightM: h,
        rgb: truth(h).map((v) => Math.min(1, Math.max(0, v + noise()))),
        gx: i % 64,
        gy: Math.floor(i / 64),
      };
    });
    const rows = bandSweep(samples, [50, 200, 800]);
    assert.deepEqual(
      rows.map((r) => r.widthM),
      [50, 200, 800],
    );
    for (const r of rows) {
      assert.ok(r.fit.mean > 0 && r.cv.mean > 0, `${r.widthM}`);
      // Judged on unseen pixels, a ramp never does better than on its own.
      assert.ok(
        r.cv.mean >= r.fit.mean - 0.05,
        `${r.widthM}: ${r.cv.mean} vs ${r.fit.mean}`,
      );
      assert.ok(r.bands > 0 && r.minCount > 0);
    }
    // Narrow bands fit their own pixels at least as well as wide ones.
    assert.ok(rows[0].fit.mean <= rows[2].fit.mean + 1e-9);
  });

  // PR #531 review: a ramp fitted on sea-only samples has no land band, so
  // `bandRampColour` returns its documented null, and the error measure
  // passed that null to deltaE76 (a TypeError). Low ground whose one fold
  // is all sea does exactly this. A ramp that cannot colour a land sample
  // has no error for it: the sample is skipped and counted.
  it("skips the land samples a ramp cannot colour, and counts them", () => {
    const sea = [0.05, 0.1, 0.3];
    const seaOnly = bandRamp([{ heightM: -10, rgb: sea }], { widthM: 300 });
    const land = [
      { heightM: 120, rgb: [0.3, 0.4, 0.2] },
      { heightM: 900, rgb: [0.4, 0.4, 0.3] },
    ];
    const err = rampFitError(seaOnly, land);
    assert.equal(err.n, 0);
    assert.equal(err.skipped, 2);
    assert.ok(Number.isNaN(err.mean));
    // A ramp with land bands (an empty band between them interpolated)
    // colours every land sample and skips none.
    const ramp = bandRamp(land, { widthM: 100 });
    assert.equal(rampFitError(ramp, land).skipped, 0);
    assert.equal(rampFitError(ramp, land).n, 2);
  });

  // The two folds fail together: a fold with no land fits a sea-only ramp
  // that colours none of the other fold's land, AND gives the other fold's
  // ramp no land to be judged on. So the cross-validated error is NaN when
  // either fold has no land, and otherwise the plain average of both.
  it("is NaN when either fold has no land, and the folds' plain average otherwise", () => {
    // Fold 0 (even gx + gy) is all sea, so its ramp colours no land sample
    // of fold 1, and fold 1's ramp has no land of fold 0 to be judged on.
    const samples = [
      { heightM: -5, rgb: [0.05, 0.1, 0.3], gx: 0, gy: 0 },
      { heightM: -8, rgb: [0.05, 0.1, 0.3], gx: 1, gy: 1 },
      { heightM: 150, rgb: [0.3, 0.4, 0.2], gx: 1, gy: 0 },
      { heightM: 260, rgb: [0.32, 0.41, 0.22], gx: 0, gy: 1 },
    ];
    const [row] = bandSweep(samples, [100]);
    assert.ok(Number.isNaN(row.cv.mean));
    assert.equal(row.cv.skipped, 2);
    // With land in both folds, the folds' errors are averaged as before.
    const both = [
      ...samples,
      { heightM: 140, rgb: [0.31, 0.4, 0.21], gx: 2, gy: 0 },
      { heightM: 270, rgb: [0.3, 0.42, 0.2], gx: 3, gy: 0 },
    ];
    const [r2] = bandSweep(both, [100]);
    const folds = [0, 1].map((f) =>
      both.filter((s) => foldOf(s.gx, s.gy) === f),
    );
    const cross = [0, 1].map((f) =>
      rampFitError(bandRamp(folds[f], { widthM: 100 }), folds[1 - f]),
    );
    assert.ok(cross.every((c) => Number.isFinite(c.mean)));
    close(r2.cv.mean, (cross[0].mean + cross[1].mean) / 2, 1e-12, "cv mean");
    close(r2.cv.p95, (cross[0].p95 + cross[1].p95) / 2, 1e-12, "cv p95");
  });

  it("needs both folds", () => {
    const samples = [{ heightM: 100, rgb: [0.3, 0.3, 0.3], gx: 0, gy: 0 }];
    assert.throws(() => bandSweep(samples, [100]), RangeError);
  });

  // Review 2026-10-01-1650 m2: a one-pixel checkerboard puts every pixel's
  // four neighbours in the other fold; blocks keep most of them together.
  it("folds by checkerboard blocks of blockPx pixels", () => {
    assert.equal(foldOf(0, 0), 0);
    assert.equal(foldOf(1, 0), 1);
    assert.equal(foldOf(3, 0, 4), 0);
    assert.equal(foldOf(4, 0, 4), 1);
    assert.equal(foldOf(4, 4, 4), 0);
    const sameFold = (block) => {
      let same = 0;
      let all = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 63; x++) {
          all += 1;
          if (foldOf(x, y, block) === foldOf(x + 1, y, block)) same += 1;
        }
      }
      return same / all;
    };
    assert.equal(sameFold(1), 0);
    close(sameFold(4), 48 / 63, 1e-12, "4 px blocks");
    assert.ok(sameFold(16) > 0.9);
  });

  // Why the blocks matter: imagery whose colour follows the POSITION (as
  // real land cover does) and has nothing to do with the height. A narrow
  // band's pixels lie along a contour line, so with one-pixel folds each
  // judged pixel has fitted neighbours on the same contour, and the
  // cross-validated error flatters the height model; blocks remove that.
  it("shows the one-pixel folds' leak on autocorrelated imagery", () => {
    const samples = [];
    for (let gy = 0; gy < 96; gy++) {
      for (let gx = 0; gx < 96; gx++) {
        const h = 2000 + 1400 * Math.sin(gx / 9) * Math.cos(gy / 11);
        const g = 0.35 + 0.25 * Math.sin(gx / 6 + 1) * Math.sin(gy / 7 + 2);
        samples.push({ heightM: h, rgb: [g * 0.8, g, g * 0.6], gx, gy });
      }
    }
    const cv = (blockPx) => bandSweep(samples, [10], { blockPx })[0].cv.mean;
    // Measured 12.72 against 12.16 (4 px blocks 12.36): small on this
    // synthetic, where a 10 m band still holds about 30 pixels; the smoke
    // measures it on the real imagery, where the top bands hold a handful.
    assert.ok(cv(16) > cv(1) + 0.2, `blocks 16: ${cv(16)}, 1: ${cv(1)}`);
  });
});

describe("deltaE76", () => {
  it("is 0 for equal colours, 100 from black to white, and symmetric", () => {
    assert.equal(deltaE76([0.3, 0.4, 0.5], [0.3, 0.4, 0.5]), 0);
    close(deltaE76([0, 0, 0], [1, 1, 1]), 100, 1e-6, "black-white");
    const next = random(8);
    for (let k = 0; k < 50; k++) {
      const a = [next(), next(), next()];
      const b = [next(), next(), next()];
      close(deltaE76(a, b), deltaE76(b, a), 1e-12, `case ${k}`);
    }
  });

  it("is the L* step between two greys (hand-computed)", () => {
    // sRGB 0.5 decodes to Y 0.2140, L* 53.39; 0.52 to Y 0.2330, L* 55.38.
    close(deltaE76([0.5, 0.5, 0.5], [0.52, 0.52, 0.52]), 1.99, 0.01, "grey");
  });
});
