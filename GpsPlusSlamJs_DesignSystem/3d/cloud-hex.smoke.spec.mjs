// @ts-check
/**
 * Hex-tiled clouds on the look-dev page (hex-tiling plan 2026-10-07-0919,
 * H2; the owner, 2026-10-07: "the same cloud shapes again and again, in a
 * grid"). The big-shape octave repeats every tile (24 km); with
 * `cloudHex=1` it must not, in every cloud mode.
 *
 * Why this file matters: the cold review (finding 3) showed a pixel test in
 * the globe lab could not measure the repeat (the map, the light and the
 * frame do not cancel). Here the drift offset is pinned (`setCloudOffset`),
 * so between two frames only the noise moves: shifting it by one tile must
 * leave today's sky EXACTLY as it was (the repeat, made exact) and change
 * the hex-tiled one, while a shift by the hex field's period (13 tiles)
 * must leave both unchanged, which proves on the GPU that the drift can
 * wrap there. A seam check (finding 1: implicit derivatives across a cell
 * edge pick the coarsest level and draw the lattice) compares the sharpest
 * neighbour steps of the frame with and without hex.
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

const MODES = ["dome", "sheet", "slab"];
/** The noise's period with hex (CLOUD_NOISE_PERIOD_TILES). */
const PERIOD = 13;
/**
 * Several stretches of the field: this view sees about half a tile (a few
 * hex cells), so one stretch's frame difference swings with what happens to
 * be in view (measured 2026-10-08: 0.85-24 levels for "other clouds", 2.8-26
 * for the hex shift). Exact claims hold at every base; the hex one is an
 * average.
 */
const BASES = [
  [0.3, 0.6],
  [0.05, 0.2],
  [0.7, 0.9],
  [0.45, 0.33],
  [5.3, 2.1],
];

/**
 * Per base: the mean absolute difference (levels, over the colour channels
 * of every pixel) from the base frame of a shift by one tile, by the
 * period, and by half a tile (other clouds: the scale); and the 99.9th
 * percentile of the luminance step between horizontal neighbours at the
 * first base.
 */
async function measure(page, mode, hex) {
  await boot(
    page,
    `preset=hazy&tone=neutral&cloudMode=${mode}&cloudShadows=1&cloudHex=${hex ? 1 : 0}`,
  );
  return page.evaluate(
    ({ bases, period }) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setFloatingVisible(false);
      // From the ground, looking up and out over the clouds.
      d.placeCameraAt([0, 2, 0], [0, 60, -100]);
      const frameAt = (u, v) => {
        d.setCloudOffset(u, v);
        return d.readFrame();
      };
      const diff = (a, b) => {
        let total = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          total +=
            Math.abs(a.data[i] - b.data[i]) +
            Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2]);
        }
        return total / ((a.data.length / 4) * 3);
      };
      const steps = (f) => {
        const out = [];
        for (let y = 0; y < f.height; y += 2) {
          for (let x = 1; x < f.width; x++) {
            const i = 4 * (y * f.width + x);
            const l = (k) =>
              0.2126 * f.data[k] +
              0.7152 * f.data[k + 1] +
              0.0722 * f.data[k + 2];
            out.push(Math.abs(l(i) - l(i - 4)));
          }
        }
        out.sort((p, q) => p - q);
        return out[Math.floor(out.length * 0.999)];
      };
      const per = bases.map(([u, v]) => {
        const f0 = frameAt(u, v);
        return {
          one: [diff(f0, frameAt(u + 1, v)), diff(f0, frameAt(u, v + 1))],
          period: [
            diff(f0, frameAt(u + period, v)),
            diff(f0, frameAt(u, v + period)),
          ],
          half: [diff(f0, frameAt(u + 0.5, v)), diff(f0, frameAt(u, v + 0.5))],
        };
      });
      const all = (key) => per.flatMap((p) => p[key]);
      const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
      const [u, v] = bases[0];
      return {
        oneMax: Math.max(...all("one")),
        oneMean: mean(all("one")),
        periodMax: Math.max(...all("period")),
        halfMean: mean(all("half")),
        p999: steps(frameAt(u, v)),
      };
    },
    { bases: BASES, period: PERIOD },
  );
}

for (const mode of MODES) {
  test(`the ${mode} clouds no longer repeat at one tile with cloudHex=1, and still repeat at the period`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const off = await measure(page, mode, false);
    const on = await measure(page, mode, true);
    console.log(
      `${mode}: off one tile max ${off.oneMax.toFixed(2)}, other clouds mean ${off.halfMean.toFixed(2)}, p99.9 step ${off.p999.toFixed(1)}; ` +
        `on one tile mean ${on.oneMean.toFixed(2)}, period max ${on.periodMax.toFixed(2)}, p99.9 step ${on.p999.toFixed(1)}`,
    );
    // Today's repeat, made exact: one tile on, the same sky, everywhere.
    expect(off.oneMax).toBeLessThan(1);
    // The hex field repeats at its period, everywhere: the drift may wrap
    // there.
    expect(on.periodMax).toBeLessThan(1);
    // And at one tile the hex sky changes as much as other clouds do (at
    // least half as much, averaged over the bases and both axes).
    expect(on.oneMean).toBeGreaterThan(0.5 * off.halfMean);
    // No seam: the sharpest neighbour steps stay near today's.
    expect(on.p999).toBeLessThan(off.p999 * 1.5 + 2);
  });
}

/** Pearson's correlation of two equal-length lists. */
function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

// WHY (cold review finding 11): the shader twin and the CPU twin must be
// the same field; the CPU one sets the cover's thresholds and the sun's
// and the shadows' columns. Read back from the GPU at points over two
// periods, against the CPU at the same points.
test("the shader hex-tiles the texture exactly as the CPU twin does", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page, "preset=hazy&tone=neutral&cloudMode=dome");
  const uvs = [];
  for (let i = 0; i < 400; i++) {
    uvs.push([(i * 0.0653) % 26, (i * 0.1171) % 26]);
  }
  const shiftedX = uvs.map(([u, v]) => [u + 1, v]);
  const shiftedY = uvs.map(([u, v]) => [u, v + 1]);
  const [here, x, y] = await page.evaluate(
    (lists) => lists.map((l) => window.__lookdev.hexProbe(l)),
    [uvs, shiftedX, shiftedY],
  );
  const worst = Math.max(...here.map((p) => Math.abs(p.gpu - p.cpu)));
  const gpuX = correlation(
    here.map((p) => p.gpu),
    x.map((p) => p.gpu),
  );
  const gpuY = correlation(
    here.map((p) => p.gpu),
    y.map((p) => p.gpu),
  );
  const cpuX = correlation(
    here.map((p) => p.cpu),
    x.map((p) => p.cpu),
  );
  console.log(
    `hex twin: worst |gpu - cpu| ${worst.toFixed(4)}; one-tile correlation gpu x ${gpuX.toFixed(3)} y ${gpuY.toFixed(3)}, cpu x ${cpuX.toFixed(3)}`,
  );
  expect(worst).toBeLessThan(0.01);
});
