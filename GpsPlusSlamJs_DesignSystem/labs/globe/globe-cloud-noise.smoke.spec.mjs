// @ts-check
/**
 * The clouds' live per-octave noise in the globe lab (round-3 plan
 * 2026-10-08-2345, N1, DEC-R3-4; `cloud-live-noise.ts` in the framework).
 *
 * Why this file matters: the owner saw the volumetric clouds as "carpet
 * tiles that are all identical" (2026-10-08) and asked that a repeating
 * pattern must never be recognisable. The live noise's arithmetic and its
 * "no repetition" are measured on the CPU (the framework's unit and sweep
 * tests); what only a browser can show is held here:
 *
 * - **The shader is the twin.** The GPU's live noise against the CPU twin
 *   at the same points, within the 8-bit lattice tolerance (the bilinear
 *   weights are 8-bit: about 1/256 of a lattice step an octave).
 * - **Far anchors differ.** Two anchors 1,536 km apart (where a 256^2
 *   lattice repeated the base octave) and 6,144 km apart (where the 1,024^2
 *   one repeats it along its own axes): the GPU's patterns must not match.
 * - **It compiles and draws** in the ground sky's slab and the volume's
 *   shadow, with no console error, and its frame cost against the tile as a
 *   ratio within one page load (SwiftShader: relative only).
 * - **Screenshots for the owner** (tile, hex and live at the same pose,
 *   toward the horizon from about 12 and 26 km), written when
 *   `N1_SHOTS_DIR` names a folder; they are the owner's to judge.
 */
import { expect, test } from "@playwright/test";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

// A partly cloudy part of the map (56.5 N 9 E, Jutland; the cloud volume
// smokes' place), the volume's cover doubled so the deck is well filled.
const PLACE = "56.5,9.0";
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&detail=0&cloudVolumeCover=2";
/** A pose toward the horizon: the view's pitch below the horizontal. */
const view = (km) => `view=${PLACE},${km},0,-8`;

/**
 * The tolerance between the GPU and the CPU twin (noise units): each
 * octave's two bilinear weights are 8-bit, each off by at most 1/256 of a
 * lattice step, so an octave is off by at most twice its amplitude / 256
 * (the amplitudes sum to the contrast, 1.431), plus float32 rounding;
 * swept x0.5 / x1 / x2 in the log.
 */
const TWIN_TOLERANCE = (2 * 1.431) / 256 + 1e-3;
/** The largest correlation two far anchors' patterns may show. */
const FAR_CORRELATION = 0.5;
const SWEEP = [0.5, 1, 2];

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

test("the live noise's shader matches its CPU twin, and far anchors differ", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await bootGlobe(page, `${BASE}&${view(12)}&cloudNoise=live`, {
    phase: "user",
  });
  // A 24 x 24 grid over 96 km, off the lattice's axes.
  const points = [];
  for (let j = 0; j < 24; j++) {
    for (let i = 0; i < 24; i++) points.push([i * 4.003 - 48, j * 3.997 - 48]);
  }
  const anchors = [
    { originKm: [2_345.6, -7_123.4], rotationRad: 0.4 },
    { originKm: [2_345.6 + 1_536, -7_123.4], rotationRad: 0.4 },
    { originKm: [2_345.6 + 6_144, -7_123.4], rotationRad: 0.4 },
    { originKm: [2_345.6, -7_123.4 + 6_144], rotationRad: 0.4 },
  ];
  const probes = await page.evaluate(
    ({ points, anchors }) => window.__globeLab.cloudLiveProbe(points, anchors),
    { points, anchors },
  );
  let worst = 0;
  for (const { gpu, cpu } of probes) {
    for (let i = 0; i < gpu.length; i++) {
      worst = Math.max(worst, Math.abs(gpu[i] - cpu[i]));
    }
  }
  const far = probes.slice(1).map((p) => correlation(probes[0].gpu, p.gpu));
  console.log(
    `live noise: GPU against the CPU twin, worst ${worst.toFixed(5)} (bound ${TWIN_TOLERANCE.toFixed(5)}: ${SWEEP.map((k) => `x${k} ${worst <= TWIN_TOLERANCE * k ? "ok" : "NO"}`).join(" ")}); the pattern against anchors 1,536 km east, 6,144 km east and 6,144 km south: ${far.map((r) => r.toFixed(3)).join(" / ")} (bound ${FAR_CORRELATION})`,
  );
  expect(errors).toEqual([]);
  expect(worst).toBeLessThanOrEqual(TWIN_TOLERANCE);
  for (const r of far) expect(Math.abs(r)).toBeLessThan(FAR_CORRELATION);
});

test("cloudNoise=live compiles and draws in the volume, its cost against the tile stated", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await bootGlobe(page, `${BASE}&${view(12)}&cloudNoise=tile`, {
    phase: "user",
  });
  const cost = { tile: [], live: [] };
  let drawn = null;
  // Alternated, twice, within one page load: the ratio, not the times.
  for (const mode of ["tile", "live", "tile", "live"]) {
    await applyHash(page, `${BASE}&${view(12)}&cloudNoise=${mode}`);
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    cost[mode].push(
      await page.evaluate(() => window.__globeLab.timeFrames(10) / 10),
    );
    if (mode === "live") {
      drawn = await page.evaluate(() => ({
        volume: window.__globeLab.state().cloudVolume,
        coverage: window.__globeLab.cloudVolumeCoverage(),
      }));
    }
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const ratio = mean(cost.live) / mean(cost.tile);
  console.log(
    `live noise cost at 12 km toward the horizon: ${mean(cost.live).toFixed(0)} ms a frame against ${mean(cost.tile).toFixed(0)} with the tile (x${ratio.toFixed(2)}, SwiftShader, runs ${cost.tile.map((t, i) => `${t.toFixed(0)}/${cost.live[i].toFixed(0)}`).join(" ")}); the volume ${JSON.stringify(drawn.volume)}, its cover share ${drawn.coverage?.share.toFixed(3)}`,
  );
  expect(errors).toEqual([]);
  expect(drawn.volume.noise).toBe("live");
  expect(drawn.volume.drawn).toBeGreaterThan(0);
  expect(drawn.coverage.share).toBeGreaterThan(0);
  expect(Number.isFinite(ratio)).toBe(true);
});

test("tile, hex and live at the same poses, for the owner's eye", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const dir = process.env.N1_SHOTS_DIR ?? null;
  const errors = await bootGlobe(page, `${BASE}&${view(12)}&cloudNoise=tile`, {
    phase: "user",
  });
  const frames = {};
  for (const km of [12, 26]) {
    for (const mode of ["tile", "hex", "live"]) {
      await applyHash(page, `${BASE}&${view(km)}&cloudNoise=${mode}`);
      await page.waitForFunction(
        () => window.__globeLab.state().groundSky?.rebuildPending === false,
        null,
        { timeout: 60_000 },
      );
      await page.evaluate(() => window.__globeLab.timeFrames(3));
      frames[`${km}-${mode}`] = await page.evaluate(
        () => window.__globeLab.state().cloudVolume,
      );
      if (dir) {
        await page.screenshot({
          path: `${dir}/n1-${km}km-${mode}.png`,
        });
      }
    }
  }
  console.log(
    `owner shots ${dir ? `written to ${dir}` : "not written (no N1_SHOTS_DIR)"}: ${Object.entries(
      frames,
    )
      .map(([k, v]) => `${k} share ${v.share.toFixed(2)} drawn ${v.drawn}`)
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
  expect(frames["12-live"].noise).toBe("live");
});
