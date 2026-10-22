/**
 * The spherical cloud volume's two-field mix (round-4 plan 2026-10-11-0122,
 * R4d; `cloudShellFieldWeights` in the Globe package, the march's
 * `shellNoise` in `globe-cloud-shell-volume.js`).
 *
 * Why this file matters: between two stations the shell mixes two fields of
 * the live noise, each at its own fixed cell scale (a scale moving with the
 * altitude slid the ground-anchored clouds by tens of kilometres; the
 * browser measured it). A plain average of two fields halves their variance
 * at the middle of the mix, which would thin the clouds there (the cover is
 * drawn through the full field's thresholds). The weights keep the squares'
 * sum at 1; this holds, on the framework's own CPU twin of the field, that
 * the mixed field's spread and the cover the thresholds draw survive the
 * mix, at the default stations' scales.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  CLOUD_LIVE_NOISE,
  cloudLiveBasis,
  cloudLiveSample,
  liveCloudThreshold,
} from "/fw/visualization/atmosphere/cloud-live-noise.js";
import { cloudShellFieldWeights } from "/globe/globe-cloud-shell-volume.js";

const anchor = { originKm: [2345.6, -7123.4], rotationRad: 0.4 };
const basisFor = (s) =>
  cloudLiveBasis({
    originKm: [anchor.originKm[0] / s, anchor.originKm[1] / s],
    rotationRad: anchor.rotationRad,
  });

/** Points over 2,000 km (a seeded generator), the field at two scales. */
function samples(scales, n = 12_000) {
  let seed = 7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const [a, b] = scales.map(basisFor);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (next() - 0.5) * 2000;
    const z = (next() - 0.5) * 2000;
    out.push([
      cloudLiveSample(a, x / scales[0], z / scales[0]),
      cloudLiveSample(b, x / scales[1], z / scales[1]),
    ]);
  }
  return out;
}

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const std = (v) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

describe("the two-field mix", () => {
  for (const scales of [
    [4, 2],
    [2, 1],
  ]) {
    const pairs = samples(scales);
    const m = CLOUD_LIVE_NOISE.fieldMean;
    const mixed = (t) => {
      const [wa, wb] = cloudShellFieldWeights(t);
      return pairs.map(([a, b]) => m + wa * (a - m) + wb * (b - m));
    };
    const spread0 = std(pairs.map(([a]) => a));

    it(`keeps the spread through the mix of the x${scales[0]} and x${scales[1]} fields (within 12 %)`, () => {
      for (const t of [0.25, 0.5, 0.75]) {
        const s = std(mixed(t));
        assert.ok(
          Math.abs(s / spread0 - 1) < 0.12,
          `t ${t}: spread ${s.toFixed(4)} against ${spread0.toFixed(4)}`,
        );
      }
    });

    it(`keeps the cover the thresholds draw (within 0.06) for x${scales[0]} and x${scales[1]}`, () => {
      for (const cover of [0.3, 0.5, 0.7]) {
        const th = liveCloudThreshold(cover);
        for (const t of [0, 0.5, 1]) {
          const drawn = mean(mixed(t).map((v) => (v > th ? 1 : 0)));
          assert.ok(
            Math.abs(drawn - cover) < 0.06,
            `cover ${cover} at t ${t}: drawn ${drawn.toFixed(3)}`,
          );
        }
      }
    });
  }

  // The positive control: the plain average the weights replace thins the
  // field at the middle of the mix, so the spread test can fail.
  it("fails the spread with a plain average (the control)", () => {
    const pairs = samples([4, 2], 6_000);
    const m = CLOUD_LIVE_NOISE.fieldMean;
    const plain = pairs.map(([a, b]) => m + 0.5 * (a - m) + 0.5 * (b - m));
    assert.ok(std(plain) / std(pairs.map(([a]) => a)) < 0.85);
  });
});
