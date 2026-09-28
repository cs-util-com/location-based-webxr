// @ts-check
/**
 * The sun through clouds on the look-dev page (round-3 plan 2026-09-27-0532,
 * stream D; DEC-FB3-6): the disc behind a cloud, and the glow of thin cloud
 * around the sun.
 *
 * Why this file matters: a check that passes today proves nothing (the
 * plan's §8, finding 7), so every claim here is measured AGAINST THE
 * NO-EFFECT BASELINE at the same pixels, in the same page load: the effect
 * off, then on, with the clouds pinned. Where the clouds stand in front of
 * the sun comes from the framework's CPU twins (`sun-clouds.js`), so a test
 * picks a sky with a cloud of a known thickness there instead of hoping for
 * one. Colour claims are relative (lessons-learned: golden images were
 * rejected for this package).
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

const sum = (px) => px[0] + px[1] + px[2];
const DEG = Math.PI / 180;
/** The "straight at the sun" camera (lookdev.js placeCamera "atsun"). */
const EYE = [-20, 18, 60];

/** Unit directions `deg` from `sun`, at `n` azimuths around it. */
function ring(sun, deg, n = 8) {
  const [x, y, z] = sun;
  // A basis perpendicular to the sun.
  const a = Math.abs(y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]];
  const lu = Math.hypot(...u);
  u = u.map((c) => c / lu);
  const v = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
  const out = [];
  for (let k = 0; k < n; k++) {
    const phi = (2 * Math.PI * k) / n;
    const c = Math.cos(deg * DEG);
    const s = Math.sin(deg * DEG);
    out.push(
      [0, 1, 2].map(
        (i) => c * sun[i] + s * (Math.cos(phi) * u[i] + Math.sin(phi) * v[i]),
      ),
    );
  }
  return out;
}

/**
 * Boot at a preset with both effects named off, the floating parts hidden
 * (they stand against the sky), the loop paused, the camera straight at the
 * sun; returns the console errors and the sun direction.
 */
async function bootAtSun(page, preset, mode) {
  const errors = await boot(
    page,
    `preset=${preset}&tone=neutral&cloudMode=${mode}&sunDisc=0&sunGlow=0`,
  );
  const sun = await page.evaluate((eye) => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    const s = d.sunDirection();
    d.placeCameraAt(eye, [
      eye[0] + s[0] * 100,
      eye[1] + s[1] * 100,
      eye[2] + s[2] * 100,
    ]);
    return s;
  }, EYE);
  return { errors, sun };
}

/** Screen points of directions from the eye (far, so the sky's). */
const screenOf = (page, dirs) =>
  page.evaluate(
    ([eye, list]) =>
      list.map((d) =>
        window.__lookdev.project([
          eye[0] + d[0] * 5000,
          eye[1] + d[1] * 5000,
          eye[2] + d[2] * 5000,
        ]),
      ),
    [EYE, dirs],
  );

/**
 * The cloud offsets (a grid over the tile) at which the column in front of
 * the sun has an effective optical depth tau·drawn in [lo, hi]; the CPU
 * twin, so no frame is rendered for the search.
 */
const offsetsWith = (page, lo, hi, count = 3) =>
  page.evaluate(
    ([lo, hi, count]) => {
      const d = window.__lookdev;
      const found = [];
      for (let i = 0; i < 48 && found.length < count; i++) {
        for (let j = 0; j < 48 && found.length < count; j++) {
          // Spread the picks over the tile rather than a corner of it.
          const u = ((i * 29) % 48) / 48;
          const v = ((j * 31) % 48) / 48;
          d.setCloudOffset(u, v);
          const c = d.sunCloud();
          const eff = c.tau * c.drawn;
          if (eff >= lo && eff <= hi) found.push({ u, v, tau: c.tau, eff });
        }
      }
      return found;
    },
    [lo, hi, count],
  );

/** Render with the given raw effect values and read the points. */
const readWith = (page, raw, offset, points) =>
  page.evaluate(
    ([raw, offset, points]) => {
      const d = window.__lookdev;
      d.setCloudOffset(offset.u, offset.v);
      d.setSunThroughCloudsRaw(raw);
      return d.readPixels(points);
    },
    [raw, offset, points],
  );

const mean = (a) => a.reduce((t, px) => t + sum(px), 0) / a.length;
const OFF = { discExponent: 0, forward: 0 };

/**
 * The declared bounds, from the first measurement (2026-09-27, SwiftShader,
 * 1280×800, noon, cover 0.5, Neutral), each with the value that would
 * reverse it (the owner's sweep rule; the full sweep over presets and k is
 * in the record, 2026-09-27 sun-through-clouds results).
 *
 * DISC (dome): behind a column of tau·drawn 2-6 the baseline disc reads 765
 * (saturated white: 15 000x the sky, dimmed only by the cloud's opacity);
 * at k = 4 it drops by 21-41 levels to the cloud's own ~724. Over k: 1
 * drops 0-9, 2 drops 0-37, 8 drops 31-41. The ring 4° out moves by 0 at
 * every k (the term touches disc pixels only). 15 sits between k = 1 and
 * k = 4 at every depth measured; it reverses where the sun's surroundings
 * saturate (the drop is bounded by white minus the cloud).
 *
 * DISC (slab): the slab blends over the sky in display space, so its alpha
 * already hides most of the disc behind tau ≥ 2 (the baseline reads the
 * cloud's ~722 there); k = 4 moves it by 0-4, k = 8 by 0-17. Asserted:
 * never brighter, the sky around unchanged; the size is logged.
 *
 * GLOW: through thin cloud (tau·drawn 0.3-1.5) the ring 2-4° out gains 15-30
 * levels (dome and slab), through thick cloud (3-6) 0-16. 8 sits under the
 * thin gains; thick below thin is the model's τ·e^(-τ).
 */
const BOUNDS = { discDrop: 15, ringStill: 1, glowGain: 8 };

test("the disc behind a dome cloud dims to the cloud, the sky around it does not", async ({
  page,
}) => {
  const { errors, sun } = await bootAtSun(page, "noon", "dome");
  await page.evaluate(() => window.__lookdev.setCloudCover(0.5));
  const [disc] = await screenOf(page, [sun]);
  const points = [disc, ...(await screenOf(page, ring(sun, 4)))];
  const offsets = await offsetsWith(page, 2, 6, 3);
  expect(offsets.length).toBeGreaterThan(0);
  for (const o of offsets) {
    const base = await readWith(page, OFF, o, points);
    const on = await readWith(page, { discExponent: 4, forward: 0 }, o, points);
    const ring4 = Math.max(
      ...on.slice(1).map((px, i) => Math.abs(sum(px) - sum(base[i + 1]))),
    );
    console.log(
      `dome disc, tau·drawn ${o.eff.toFixed(2)}: ${sum(base[0])} -> ${sum(on[0])} at k 4; ring ±${ring4}`,
    );
    expect(sum(base[0]) - sum(on[0])).toBeGreaterThanOrEqual(BOUNDS.discDrop);
    expect(ring4).toBeLessThanOrEqual(BOUNDS.ringStill);
  }
  // A clear sky: the disc and the sky are the baseline's.
  await page.evaluate(() => window.__lookdev.setCloudCover(0));
  const clearOff = await readWith(page, OFF, offsets[0], points);
  const clearOn = await readWith(
    page,
    { discExponent: 4, forward: 1 },
    offsets[0],
    points,
  );
  clearOn.forEach((px, i) =>
    expect(Math.abs(sum(px) - sum(clearOff[i]))).toBeLessThanOrEqual(
      BOUNDS.ringStill,
    ),
  );
  expect(errors).toEqual([]);
});

test("the disc behind the slab is never brighter, the sky around it unchanged", async ({
  page,
}) => {
  const { errors, sun } = await bootAtSun(page, "noon", "slab");
  await page.evaluate(() => window.__lookdev.setCloudCover(0.5));
  const [disc] = await screenOf(page, [sun]);
  const points = [disc, ...(await screenOf(page, ring(sun, 4)))];
  const offsets = await offsetsWith(page, 1, 6, 3);
  expect(offsets.length).toBeGreaterThan(0);
  for (const o of offsets) {
    const base = await readWith(page, OFF, o, points);
    const line = [];
    let previous = sum(base[0]);
    for (const k of [4, 8]) {
      const on = await readWith(
        page,
        { discExponent: k, forward: 0 },
        o,
        points,
      );
      expect(sum(on[0])).toBeLessThanOrEqual(previous);
      previous = sum(on[0]);
      const ring4 = Math.max(
        ...on.slice(1).map((px, i) => Math.abs(sum(px) - sum(base[i + 1]))),
      );
      expect(ring4).toBeLessThanOrEqual(BOUNDS.ringStill);
      line.push(`k ${k}: ${sum(on[0])}`);
    }
    console.log(
      `slab disc, tau·drawn ${o.eff.toFixed(2)}: ${sum(base[0])} -> ${line.join(", ")}`,
    );
  }
  expect(errors).toEqual([]);
});

for (const mode of ["dome", "slab"]) {
  test(`thin cloud glows around the sun, thick cloud and a clear sky far less (${mode})`, async ({
    page,
  }) => {
    const { errors, sun } = await bootAtSun(page, "noon", mode);
    await page.evaluate(() => window.__lookdev.setCloudCover(0.5));
    const near = await screenOf(page, [...ring(sun, 2), ...ring(sun, 4)]);
    const far = await screenOf(page, ring(sun, 30));
    const gain = async (o, points) =>
      mean(await readWith(page, { discExponent: 0, forward: 1 }, o, points)) -
      mean(await readWith(page, OFF, o, points));
    const thin = await offsetsWith(page, 0.3, 1.5, 2);
    const thick = await offsetsWith(page, 3, 6, 2);
    expect(thin.length).toBeGreaterThan(0);
    expect(thick.length).toBeGreaterThan(0);
    let thinGain = 0;
    for (const o of thin) {
      const g = await gain(o, near);
      console.log(
        `${mode} glow, thin (tau·drawn ${o.eff.toFixed(2)}): +${g.toFixed(1)} at 2-4°, +${(await gain(o, far)).toFixed(1)} at 30°`,
      );
      expect(g).toBeGreaterThanOrEqual(BOUNDS.glowGain);
      thinGain += g / thin.length;
    }
    let thickGain = 0;
    for (const o of thick) {
      const g = await gain(o, near);
      console.log(
        `${mode} glow, thick (tau·drawn ${o.eff.toFixed(2)}): +${g.toFixed(1)} at 2-4°`,
      );
      thickGain += g / thick.length;
    }
    expect(thickGain).toBeLessThan(thinGain);
    // A clear sky: nothing to scatter.
    await page.evaluate(() => window.__lookdev.setCloudCover(0));
    const clear = await gain(thin[0], [...near, ...far]);
    expect(Math.abs(clear)).toBeLessThanOrEqual(BOUNDS.ringStill);
    expect(errors).toEqual([]);
  });
}

// The page opens with both effects on (the owner judges them), the
// switches reach the framework, and the hash carries them.
test("the page opens with the sun through clouds on, and its switches drive it", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=dome", {
    pageDefaults: true,
  });
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  const fx = () =>
    page.evaluate(() => window.__lookdev.stats().sunThroughClouds);
  expect(await fx()).toEqual({ discExponent: 4, forward: 1 });
  await expect(page.locator("#sun-disc")).toBeChecked();
  await expect(page.locator("#sun-glow")).toBeChecked();
  await page.locator("#sun-disc").uncheck({ force: true });
  expect(await fx()).toEqual({ discExponent: 0, forward: 1 });
  await page.locator("#sun-glow").uncheck({ force: true });
  expect(await fx()).toEqual({ discExponent: 0, forward: 0 });
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain("sunDisc=0");
  expect(hash).toContain("sunGlow=0");
  expect(errors).toEqual([]);
});

// The cost, as on/off ratios within one page load (SwiftShader times are
// relative only): the disc term runs for disc pixels, the glow once per
// cloud pixel (the dome) or once after the march (the slab).
test("the sun through clouds costs little (on/off ratios, logged)", async ({
  page,
}) => {
  const { errors } = await bootAtSun(page, "noon", "dome");
  const ratios = {};
  for (const mode of ["dome", "slab"]) {
    ratios[mode] = await page.evaluate((m) => {
      const d = window.__lookdev;
      d.setCloudMode(m);
      d.setCloudCover(0.5);
      const time = (raw) => {
        d.setSunThroughCloudsRaw(raw);
        return d.timeFrames(5).medianMs;
      };
      const off1 = time({ discExponent: 0, forward: 0 });
      const on = time({ discExponent: 4, forward: 1 });
      const off2 = time({ discExponent: 0, forward: 0 });
      const off = (off1 + off2) / 2;
      return { on, off, ratio: on / off };
    }, mode);
  }
  console.log(
    `sun through clouds cost: ${Object.entries(ratios)
      .map(
        ([m, r]) =>
          `${m} ${r.on.toFixed(0)}/${r.off.toFixed(0)} ms = x${r.ratio.toFixed(3)}`,
      )
      .join(", ")}`,
  );
  // A disaster bound only (a second per-pixel march would be x2 and more).
  for (const r of Object.values(ratios)) expect(r.ratio).toBeLessThan(1.3);
  expect(errors).toEqual([]);
});

// --- Cloud shadows on the ground (DEC-FB3-7) ----------------------------------

/**
 * The ground under a grid of screen points, from the view above the block
 * (3.2 km up; the dome draws no clouds below the horizon, so the ground
 * shows), with the CPU twin's transmittance at each for a set of offsets.
 */
async function groundSamples(page) {
  const grid = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) grid.push([0.36 + i * 0.08, 0.3 + j * 0.1]);
  }
  const hits = await page.evaluate((g) => window.__lookdev.groundAt(g), grid);
  return grid
    .map((uv, i) => ({ uv, point: hits[i] }))
    .filter((s) => s.point !== null);
}

/** The CPU twin's transmittance toward the sun at each sample, per offset. */
const twinAt = (page, samples, offset) =>
  page.evaluate(
    ([points, o]) => {
      const d = window.__lookdev;
      d.setCloudOffset(o[0], o[1]);
      return points.map((p) => d.cloudShadowAt(p));
    },
    [samples.map((s) => s.point), offset],
  );

/** Pixels at the samples with the cloud shadows off and on, one offset. */
const shadedPair = (page, samples, offset) =>
  page.evaluate(
    ([points, o]) => {
      const d = window.__lookdev;
      d.setCloudOffset(o[0], o[1]);
      d.setCloudShadows(false);
      const off = d.readPixels(points);
      d.setCloudShadows(true);
      const on = d.readPixels(points);
      return { off, on };
    },
    [samples.map((s) => s.uv), offset],
  );

/**
 * The declared bounds (first measurement 2026-09-28, SwiftShader, noon,
 * cover 0.5, the dome, the view above the block, 6 offsets × 48 points):
 * ground whose column toward the sun passes less than 20 % of the light
 * darkened by 90-130 levels (sum of RGB, median 116) with the patch on;
 * ground under a clear column (more than 95 %) moved by 0-2. darkMin 45 is
 * half the weakest; it reverses only if the direct sun were under half the
 * ground's light. clearMax 3 sits above the 2 measured (8-bit rounding of
 * a 0.95-1 transmittance). The drop per transmittance bin is logged and
 * must fall as the transmittance rises (the pattern is where the twin says).
 */
const SHADOW = { darkMin: 45, clearMax: 3 };

const OFFSETS = [
  [0, 0],
  [0.13, 0.41],
  [0.29, 0.07],
  [0.47, 0.62],
  [0.71, 0.33],
  [0.9, 0.85],
];

test("clouds shadow the ground where the column toward the sun is thick, and the shadows follow the drift", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&cloudMode=dome&cloudShadows=0",
  );
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    d.setCloudCover(0.5);
    d.setView("above");
  });
  const samples = await groundSamples(page);
  expect(samples.length).toBeGreaterThan(20);
  const dark = [];
  const clear = [];
  // The same ground point shadowed at one offset and clear at another: the
  // pattern moves with the clouds.
  const shadedAt = new Map();
  const clearAt = new Map();
  // The drop per band of the twin's transmittance (the sweep).
  const BANDS = [0, 0.1, 0.3, 0.6, 0.9, 1.0001];
  const byBand = BANDS.slice(1).map(() => []);
  for (const offset of OFFSETS) {
    const twin = await twinAt(page, samples, offset);
    const { off, on } = await shadedPair(page, samples, offset);
    samples.forEach((s, i) => {
      const drop = sum(off[i]) - sum(on[i]);
      byBand[
        BANDS.findIndex((b, k) => twin[i] >= b && twin[i] < BANDS[k + 1])
      ].push(drop);
      if (twin[i] < 0.2) {
        dark.push(drop);
        shadedAt.set(i, (shadedAt.get(i) ?? 0) + 1);
      } else if (twin[i] > 0.95) {
        clear.push(Math.abs(drop));
        clearAt.set(i, (clearAt.get(i) ?? 0) + 1);
      }
    });
  }
  const moved = [...shadedAt.keys()].filter((i) => clearAt.has(i)).length;
  const stat = (a) =>
    a.length
      ? `n ${a.length}, min ${Math.min(...a)}, median ${[...a].sort((x, y) => x - y)[a.length >> 1]}, max ${Math.max(...a)}`
      : "n 0";
  console.log(
    `cloud shadows: under thick columns drop ${stat(dark)}; under clear ${stat(clear)}; ${moved} points both shadowed and clear across the offsets`,
  );
  const medians = byBand.map((a) =>
    a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null,
  );
  console.log(
    `drop by transmittance band ${BANDS.slice(0, -1)
      .map(
        (b, k) =>
          `[${b}, ${Math.min(1, BANDS[k + 1])}): ${medians[k]} (n ${byBand[k].length})`,
      )
      .join(", ")}`,
  );
  const present = medians.filter((m) => m !== null);
  for (let k = 1; k < present.length; k++) {
    expect(present[k]).toBeLessThanOrEqual(present[k - 1]);
  }
  expect(dark.length).toBeGreaterThan(10);
  expect(clear.length).toBeGreaterThan(10);
  expect(Math.min(...dark)).toBeGreaterThanOrEqual(SHADOW.darkMin);
  expect(Math.max(...clear)).toBeLessThanOrEqual(SHADOW.clearMax);
  expect(moved).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

// The patch chains with the haze and the page's ring-shadow rewrite of
// three's light loop: with sun shadows and a dense city (two directional
// shadows, so the rewrite is live) every program compiles and the clouds
// still darken the open ground.
test("cloud shadows compose with the sun shadows' ring rewrite and the haze", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&cloudMode=dome&cloudShadows=0&shadows=1&city=2500&pitch=42",
  );
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    d.setCloudCover(0.5);
    d.setView("above");
  });
  const samples = await groundSamples(page);
  let darker = 0;
  let checked = 0;
  for (const offset of OFFSETS.slice(0, 3)) {
    const twin = await twinAt(page, samples, offset);
    const { off, on } = await shadedPair(page, samples, offset);
    samples.forEach((s, i) => {
      if (twin[i] >= 0.2) return;
      checked += 1;
      // A point in a building's own shadow has no direct sun to dim.
      if (sum(off[i]) - sum(on[i]) >= SHADOW.darkMin) darker += 1;
    });
  }
  console.log(
    `with sun shadows: ${darker}/${checked} thick-column points darker`,
  );
  expect(checked).toBeGreaterThan(5);
  expect(darker / checked).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test("the cloud shadows cost little (on/off ratio, logged)", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&cloudMode=dome&cloudShadows=1",
  );
  const r = await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudCover(0.5);
    d.setView("city");
    const time = (on) => {
      d.setCloudShadows(on);
      return d.timeFrames(5).medianMs;
    };
    const off1 = time(false);
    const on = time(true);
    const off2 = time(false);
    const off = (off1 + off2) / 2;
    return { on, off, ratio: on / off };
  });
  console.log(
    `cloud shadows cost (city view): ${r.on.toFixed(0)}/${r.off.toFixed(0)} ms = x${r.ratio.toFixed(3)}`,
  );
  expect(r.ratio).toBeLessThan(1.3);
  expect(errors).toEqual([]);
});
