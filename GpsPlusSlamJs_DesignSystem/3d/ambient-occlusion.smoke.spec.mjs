// @ts-check
/**
 * The look-dev page's screen-space ambient occlusion (round-3 plan
 * 2026-09-27-0532, stream C; round-2 plan 2026-09-26-2055 M2e). Parameters
 * and the swept tolerances: ambient-occlusion.js.md and the record
 * GpsPlusSlamJs_Docs/docs/2026-09-27-0716-lookdev-gtao-results.md and its
 * review-fixes addendum.
 *
 * Why this file matters: the owner looked for the AO in the plate and did
 * not find it, and its known failure modes are all silent: a darkened sky
 * or cloud layer (the sky and clouds drawn into the AO's depth), darkened
 * hazed distance, AO on the phone tier, or a pass that draws nothing. Each
 * check below but the open-ground bound is shown to fail on its mutation IN
 * THE SAME RUN (AO off, the page's exclusions off, the depth fade off), so
 * a check that can no longer fail is caught.
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

/** In-page luminance helpers over `readFrame()` frames. */
async function installHelpers(page) {
  await page.evaluate(() => {
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    window.__aoCheck = {
      /** Mean luminance over a (2r+1)^2 window at normalised [u, v]. */
      at(frame, [u, v], r = 1) {
        const x0 = Math.floor(u * frame.width);
        const y0 = Math.floor((1 - v) * frame.height);
        let sum = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = Math.min(frame.width - 1, Math.max(0, x0 + dx));
            const y = Math.min(frame.height - 1, Math.max(0, y0 + dy));
            sum += lum(frame.data, (y * frame.width + x) * 4);
            n += 1;
          }
        }
        return sum / n;
      },
      /**
       * The largest darkening (off minus on) of any 3x3 window centred
       * within ±dx, ±dy pixels of [u, v], in steps of 2 pixels.
       */
      worst(off, on, [u, v], dx, dy) {
        let worst = -Infinity;
        for (let y = -dy; y <= dy; y += 2) {
          for (let x = -dx; x <= dx; x += 2) {
            const p = [u + x / off.width, v + y / off.height];
            worst = Math.max(worst, this.at(off, p) - this.at(on, p));
          }
        }
        return worst;
      },
      /** A frame with the AO off and one with it on, same state. */
      pair() {
        const api = window.__lookdev;
        api.setAo(false);
        const off = api.readFrame();
        api.setAo(true);
        const on = api.readFrame();
        return { off, on };
      },
    };
  });
}

// DECLARED TOLERANCES (8-bit luminance levels, 3x3 windows unless named;
// the record doc sweeps each and gives the measured margins).
/** The crease must darken by at least this (measured 11.1-15.8). */
const CREASE_MIN = 3;
/**
 * Open ground 25 m from the nearest wall (measured <= 0.13). A larger
 * radius does NOT reach it (radius = thickness 40 and 80 m: 0; the AO
 * stays within ~4 m of a wall), but a distance exponent of 3 does: its
 * samples crowd the pixel and the ground occludes itself (7.2 levels).
 * That is the in-run mutation (review addendum).
 */
const OPEN_MAX = 0.5;
/** The sky and the clouds (measured 0). */
const SKY_MAX = 0.5;
/**
 * Hazed distance: the dense city 800 m out, the ridge foot at 2.5 km. Set
 * from a sweep over the denoise noise's seeds (2026-09-30, follow-up "the AO
 * far-city flake"), not from the one seed the page ships. The far city read:
 * - hazy, seeds 1-6: 0.420, 0.516, 0.436, 0.388, 0.388, 0.428;
 * - golden, seeds 1-6: 0.159, 0.183, 0.270, 0.278, 0.135, 0.191;
 * - the in-run mutation (the fade off), every seed and preset: 3.13-5.51.
 * The ridge foot at the shipped seed read 0 / 0.111 / 0.191 (golden, noon,
 * hazy), its mutation 5.4-24.9. 1.0 sits 1.94x above the worst seed (0.516)
 * and 3.1x below the weakest mutation (3.13). Swept: 0.5 fails seed 2; 0.6
 * passes every seed but leaves only 1.16x headroom; 1.5 leaves only 2.1x to
 * the mutation. (Before the seed, the noise came from Math.random and the
 * hazy reading moved 0.365-0.571 between page loads.)
 */
const FAR_MAX = 1.0;
/** The dense-city probe's distance: past the fade's end (700 m). */
const FAR_CITY_M = 800;
/**
 * The denoise noise's seeds the far-city bound is held to, the shipped one
 * (ambient-occlusion.js AO_NOISE_SEED) first. The noise was once drawn from
 * Math.random per page load and the reading moved with it (0.365-0.571
 * across loads, follow-up 2026-09-30), so the bound is set on a sweep over
 * seeds, never on the one seed the page ships. `AO_SEED_SWEEP=1` runs the
 * wider sweep the bound was set from.
 */
const FAR_SEEDS = process.env.AO_SEED_SWEEP ? [1, 2, 3, 4, 5, 6] : [1, 2, 3];

test("AO darkens the crease, and leaves open ground and the hazed distance alone", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral&tier=desktop");
  await installHelpers(page);
  for (const preset of ["golden", "noon", "hazy"]) {
    const r = await page.evaluate((preset) => {
      const api = window.__lookdev;
      const H = window.__aoCheck;
      api.pauseLoop(true);
      api.setPreset(preset);
      api.setCloudOffset(0, 0);
      api.setView("city");
      const probe = api.aoProbe();
      const c = api.project(probe.crease);
      const o = api.project(probe.open);
      const { off, on } = H.pair();
      const crease = H.at(off, c) - H.at(on, c);
      const open = Math.abs(H.at(off, o) - H.at(on, o));
      api.setView("sun");
      const f = api.project(api.aoProbe().ridgeFoot);
      const sun = H.pair();
      const ridge = H.worst(sun.off, sun.on, f, 60, 14);
      // THE MUTATIONS, same page, each a rendered pair: the blend at
      // intensity 0 (the pass runs, draws nothing: the crease cannot
      // darken), a distance exponent of 3 (open ground occludes itself),
      // and the depth fade off (the hazed ridge foot darkens).
      const saved = api.setAoParams({}).params;
      api.setView("city");
      api.setAoParams({ params: { intensity: 0 } });
      const blank = H.pair();
      const noAo = H.at(blank.off, c) - H.at(blank.on, c);
      api.setAoParams({
        params: { intensity: saved.intensity, distanceExponent: 3 },
      });
      const crowded = H.pair();
      const openCrowded = H.at(crowded.off, o) - H.at(crowded.on, o);
      api.setAoParams({
        params: {
          distanceExponent: saved.distanceExponent,
          fadeStartM: 1e6,
          fadeEndM: 2e6,
        },
      });
      api.setView("sun");
      const noFade = H.pair();
      const ridgeNoFade = H.worst(noFade.off, noFade.on, f, 60, 14);
      api.setAoParams({
        params: { fadeStartM: saved.fadeStartM, fadeEndM: saved.fadeEndM },
      });
      return { crease, open, ridge, noAo, openCrowded, ridgeNoFade };
    }, preset);
    console.log(`ao ${preset}: ${JSON.stringify(r)}`);
    expect(r.crease, preset).toBeGreaterThanOrEqual(CREASE_MIN);
    expect(r.open, preset).toBeLessThanOrEqual(OPEN_MAX);
    expect(r.ridge, preset).toBeLessThanOrEqual(FAR_MAX);
    expect(r.noAo, `${preset} mutation: intensity 0`).toBeLessThan(CREASE_MIN);
    expect(
      r.openCrowded,
      `${preset} mutation: distance exponent 3`,
    ).toBeGreaterThan(OPEN_MAX);
    expect(r.ridgeNoFade, `${preset} mutation: no fade`).toBeGreaterThan(
      FAR_MAX,
    );
  }
  expect(errors).toEqual([]);
});

// The round-2 concern (plan 2026-09-26-2055 M2e): AO darkening the hazed
// dense city. Named explicitly (`city=`), since the smoke pins the block.
// At 800 m, just past the fade: the shipped AO unfaded darkens creases
// there by ~3 levels, so the fade itself is what this check sees (at
// 1.5 km the shipped AO is ~0.3 levels even unfaded: nothing to detect).
test("AO leaves the hazed dense city past the fade alone", async ({ page }) => {
  test.setTimeout(process.env.AO_SEED_SWEEP ? 240_000 : 180_000);
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&tier=desktop&city=100000&pitch=20",
  );
  await installHelpers(page);
  for (const preset of ["golden", "hazy"]) {
    const r = await page.evaluate(
      ([preset, farM, seeds]) => {
        const api = window.__lookdev;
        const H = window.__aoCheck;
        api.pauseLoop(true);
        api.setPreset(preset);
        api.setCloudOffset(0, 0);
        api.setView("city");
        const f = api.project(api.aoProbe({ farM }).far);
        const bySeed = [];
        for (const seed of seeds) {
          api.setAoParams({ noiseSeed: seed });
          const { off, on } = H.pair();
          const far = H.worst(off, on, f, 12, 6);
          // THE MUTATION: the fade off, at the shipped parameters.
          const saved = api.setAoParams({}).params;
          api.setAoParams({ params: { fadeStartM: 1e6, fadeEndM: 2e6 } });
          const noFade = H.pair();
          const farNoFade = H.worst(noFade.off, noFade.on, f, 12, 6);
          api.setAoParams({
            params: { fadeStartM: saved.fadeStartM, fadeEndM: saved.fadeEndM },
          });
          bySeed.push({ seed, far, farNoFade });
        }
        api.setAoParams({ noiseSeed: seeds[0] });
        return { f, bySeed };
      },
      [preset, FAR_CITY_M, FAR_SEEDS],
    );
    console.log(
      `ao far city ${preset}: f ${JSON.stringify(r.f)}; ${r.bySeed
        .map(
          (q) =>
            `seed ${q.seed} ${q.far.toFixed(3)} (no fade ${q.farNoFade.toFixed(2)})`,
        )
        .join(", ")}`,
    );
    expect(r.f[0]).toBeGreaterThan(0.3);
    expect(r.f[0]).toBeLessThan(1);
    for (const q of r.bySeed) {
      expect(q.far, `${preset} seed ${q.seed}`).toBeLessThanOrEqual(FAR_MAX);
      expect(
        q.farNoFade,
        `${preset} seed ${q.seed} mutation: no fade`,
      ).toBeGreaterThan(FAR_MAX);
    }
  }
  expect(errors).toEqual([]);
});

// The sky and the clouds stay out of the AO's normal/depth pass. three
// draws every mesh there but points and lines, with one opaque material:
// the slab and the sheet would be opaque surfaces (ambient-occlusion.js.md).
test("AO leaves the sky and the clouds alone, which three's own rule does not", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral&tier=desktop");
  await installHelpers(page);
  const SKY = [
    [0.7, 0.06],
    [0.9, 0.2],
    [0.5, 0.1],
  ];
  const DECK = [
    [0.6, 0.7],
    [0.8, 0.9],
  ];
  // Two cases, each with the mutation that shows there (record doc):
  // - the sheet seen from just above it (150 m): within the fade, so three's
  //   rule alone darkens the deck by ~98 levels;
  // - the slab seen from the city: its underside is 2 km away, past the
  //   fade, so the exclusions are shown with the fade off (three's rule
  //   darkens the sky by ~200 levels there; the exclusions keep it at 0).
  const CASES = [
    { mode: "sheet", view: "aloft", points: [...SKY, ...DECK], fade: true },
    { mode: "slab", view: "city", points: SKY, fade: false },
  ];
  for (const c of CASES) {
    const r = await page.evaluate(({ mode, view, points, fade }) => {
      const api = window.__lookdev;
      const H = window.__aoCheck;
      api.pauseLoop(true);
      api.setCloudMode(mode);
      api.setCloudOffset(0, 0);
      api.setView(view);
      const { off, on } = H.pair();
      const worst = (frame) =>
        Math.max(...points.map((p) => Math.abs(H.at(off, p) - H.at(frame, p))));
      const saved = api.setAoParams({}).params;
      if (!fade) {
        api.setAoParams({ params: { fadeStartM: 1e6, fadeEndM: 2e6 } });
      }
      const kept = api.readFrame();
      // THE MUTATION: three's own rule.
      api.setAoExclusions(false);
      const mutated = api.readFrame();
      api.setAoExclusions(true);
      api.setAoParams({
        params: { fadeStartM: saved.fadeStartM, fadeEndM: saved.fadeEndM },
      });
      return { shipped: worst(on), kept: worst(kept), mutated: worst(mutated) };
    }, c);
    const label = `${c.mode}/${c.view}`;
    console.log(`ao sky ${label}: ${JSON.stringify(r)}`);
    expect(r.shipped, label).toBeLessThanOrEqual(SKY_MAX);
    expect(r.kept, `${label}, fade ${c.fade}`).toBeLessThanOrEqual(SKY_MAX);
    expect(r.mutated, `${label} mutation`).toBeGreaterThan(SKY_MAX);
  }
  expect(errors).toEqual([]);
});

// The phone tier (the page's default) has no composer: the switch is a
// state there, and nothing is drawn.
test("the phone tier draws no AO, with the switch on", async ({ page }) => {
  const errors = await boot(page, "preset=golden&tone=neutral&ao=1");
  const r = await page.evaluate(() => {
    const api = window.__lookdev;
    api.pauseLoop(true);
    api.setView("city");
    const same = (a, b) => a.data.every((x, i) => x === b.data[i]);
    const on = api.readFrame();
    api.setAo(false);
    const off = api.readFrame();
    const phone = { same: same(on, off), active: api.stats().aoActive };
    // THE MUTATION: the desktop tier does draw it.
    api.setTier("desktop");
    api.setAo(false);
    const dOff = api.readFrame();
    api.setAo(true);
    const dOn = api.readFrame();
    return {
      phone,
      desktop: { same: same(dOff, dOn), active: api.stats().aoActive },
    };
  });
  expect(r.phone).toEqual({ same: true, active: false });
  expect(r.desktop).toEqual({ same: false, active: true });
  expect(errors).toEqual([]);
});

// The owner looked for the AO in the plate and did not find it (round-3
// feedback 9). The switch shows on the page's default tier, says what it
// needs, and offers the switch; the state travels in the address.
test("the AO switch is in the plate on the phone tier, and offers the Desktop tier", async ({
  page,
}) => {
  const errors = await boot(page, "preset=golden&tone=neutral");
  const note = page.locator("[data-ao-tier]");
  await expect(page.locator("#ao")).toBeVisible();
  await expect(note).toBeVisible();
  await expect(note).toContainText("Desktop tier only");
  await page.locator("#ao").check();
  await expect(page).toHaveURL(/ao=1/);
  await expect(page.locator("[data-stats]")).toContainText(
    "AO on (desktop tier only)",
  );
  await page.locator("#ao-desktop").click();
  await expect(page.locator("#tier")).toHaveValue("desktop");
  await expect(note).toBeHidden();
  await expect(page).toHaveURL(/tier=desktop/);
  expect(await page.evaluate(() => window.__lookdev.stats().aoActive)).toBe(
    true,
  );
  await expect(page.locator("[data-stats]")).toContainText("AO on ·");
  // The page's hash rule (round 3, lookdev.js readHash): a key the hash does
  // not name keeps its current value, so a link without `ao` leaves it on...
  await page.evaluate(() => {
    location.hash = "preset=golden&tone=neutral&tier=desktop";
  });
  await expect(page.locator("#ao")).toBeChecked();
  // ...and a link that names it off turns it off.
  await page.evaluate(() => {
    location.hash = "preset=golden&tone=neutral&tier=desktop&ao=0";
  });
  await expect(page.locator("#ao")).not.toBeChecked();
  expect(await page.evaluate(() => window.__lookdev.stats().aoActive)).toBe(
    false,
  );
  expect(errors).toEqual([]);
});

// With the AO on, the scene must still be drawn into the multisampled
// target EVERY frame: a swapping AO pass would make it every other frame
// (ambient-occlusion.test.mjs pins the no-swap; this checks the composer).
// Consecutive frames are compared byte for byte; each frame against the
// no-MSAA frame counts pixels more than 20 levels apart (the edges). This
// test has no in-run mutation: the swapping pass it guards against was run
// against it once by hand (record doc 2026-09-27 GTAO review fixes).
test("with AO on, every frame keeps the desktop tier's MSAA", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&tier=desktop&ao=1",
  );
  const r = await page.evaluate(() => {
    const api = window.__lookdev;
    api.pauseLoop(true);
    api.setCloudCover(0);
    api.setView("sun");
    const differ = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const d =
          Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]);
        if (d > 20) n += 1;
      }
      return n;
    };
    const bytesDiffer = (a, b) =>
      a.data.filter((x, i) => x !== b.data[i]).length;
    const frames = [api.readFrame(), api.readFrame(), api.readFrame()];
    api.setSceneMsaa(false);
    const plain = api.readFrame();
    api.setSceneMsaa(true);
    return {
      consecutive: [
        bytesDiffer(frames[0], frames[1]),
        bytesDiffer(frames[1], frames[2]),
      ],
      vsPlain: frames.map((f) => differ(f, plain)),
    };
  });
  console.log(`ao msaa: ${JSON.stringify(r)}`);
  expect(r.consecutive).toEqual([0, 0]);
  for (const n of r.vsPlain) expect(n).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

// Cost, logged: SwiftShader timings are relative only (one page load, AO
// on against off). On a real GPU the readout's "GPU ms" is the number.
test("the AO's frame cost, relative (logged)", async ({ page }) => {
  const errors = await boot(
    page,
    "preset=golden&tone=neutral&tier=desktop&city=100000&pitch=20",
  );
  const r = await page.evaluate(() => {
    const api = window.__lookdev;
    api.pauseLoop(true);
    api.setCloudOffset(0, 0);
    api.setView("city");
    const time = (on) => {
      api.setAo(on);
      api.readPixels([[0.5, 0.5]]);
      const t0 = performance.now();
      api.readPixels([[0.5, 0.5]]);
      return performance.now() - t0;
    };
    const off = [];
    const on = [];
    for (let k = 0; k < 3; k++) {
      off.push(time(false));
      on.push(time(true));
    }
    const median = (a) => [...a].sort((x, y) => x - y)[1];
    return { ratio: median(on) / median(off), gpuTimer: api.stats().gpuTimer };
  });
  console.log(
    `ao cost: on/off ${r.ratio.toFixed(2)} (gpu timer ${r.gpuTimer})`,
  );
  expect(Number.isFinite(r.ratio)).toBe(true);
  expect(errors).toEqual([]);
});
