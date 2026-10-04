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
    `preset=${preset}&tone=neutral&cloudMode=${mode}&sunDisc=0&sunAureole=0&sunSilver=0`,
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
const OFF = { discExponent: 0, aureole: 0, silverLining: 0 };
/** Both forward lobes at the model's strength. */
const GLOW = { discExponent: 0, aureole: 1, silverLining: 1 };

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
    const on = await readWith(page, { ...OFF, discExponent: 4 }, o, points);
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
    { ...GLOW, discExponent: 4 },
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
  // The thin band too (round-3 review, finding 2): a thick band alone is
  // vacuous in the slab, whose own alpha already hides the disc there.
  const offsets = [
    ...(await offsetsWith(page, 0.2, 0.5, 2)),
    ...(await offsetsWith(page, 0.5, 1, 2)),
    ...(await offsetsWith(page, 1, 2, 2)),
    ...(await offsetsWith(page, 2, 6, 2)),
  ];
  expect(offsets.length).toBeGreaterThan(0);
  for (const o of offsets) {
    const base = await readWith(page, OFF, o, points);
    const line = [];
    let previous = sum(base[0]);
    for (const k of [4, 8]) {
      const on = await readWith(page, { ...OFF, discExponent: k }, o, points);
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
    const nearPoints = near;
    const far = await screenOf(page, ring(sun, 30));
    const gain = async (o, points, raw = GLOW) =>
      mean(await readWith(page, raw, o, points)) -
      mean(await readWith(page, OFF, o, points));
    const thin = await offsetsWith(page, 0.3, 1.5, 2);
    const thick = await offsetsWith(page, 3, 6, 2);
    expect(thin.length).toBeGreaterThan(0);
    expect(thick.length).toBeGreaterThan(0);
    let thinGain = 0;
    for (const o of thin) {
      const g = await gain(o, nearPoints);
      console.log(
        `${mode} glow, thin (tau·drawn ${o.eff.toFixed(2)}): +${g.toFixed(1)} at 2-4°, +${(await gain(o, far)).toFixed(1)} at 30°`,
      );
      expect(g).toBeGreaterThanOrEqual(BOUNDS.glowGain);
      thinGain += g / thin.length;
      // Each lobe alone (one switch each): the aureole carries the glow
      // near the sun, the silver lining the edges further out.
      const aureole = { ...OFF, aureole: 1 };
      const silver = { ...OFF, silverLining: 1 };
      const near = {
        aureole: await gain(o, nearPoints, aureole),
        silver: await gain(o, nearPoints, silver),
      };
      const out = {
        aureole: await gain(o, far, aureole),
        silver: await gain(o, far, silver),
      };
      console.log(
        `${mode} lobes alone, thin: aureole +${near.aureole.toFixed(1)} near / +${out.aureole.toFixed(1)} at 30°; silver lining +${near.silver.toFixed(1)} near / +${out.silver.toFixed(1)} at 30°`,
      );
      // Each lobe does something on its own. The relation between them is
      // asserted in the dome only: in the slab the 30° gains are 3-6 levels
      // and their order sat within 1-3 levels of 8-bit rounding (round-3
      // review, finding 6); it is logged there.
      expect(near.aureole).toBeGreaterThan(0);
      expect(Math.max(near.silver, out.silver)).toBeGreaterThan(0);
      if (mode === "dome") {
        expect(near.aureole).toBeGreaterThan(near.silver);
        expect(out.silver).toBeGreaterThanOrEqual(out.aureole);
      }
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

// The owner's requirement: every effect has its own switch and hash key,
// so each can be judged alone. The page opens with the sun-through-cloud
// effects and the cloud shadows on and the whole-scene dimming off; each
// switch turns exactly its own effect and writes exactly its own key.
test("each cloud-and-sun effect has its own switch and hash key, with the page's defaults", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=dome", {
    pageDefaults: true,
  });
  await page.evaluate(() => window.__lookdev.pauseLoop(true));
  const now = () =>
    page.evaluate(() => {
      const s = window.__lookdev.stats();
      return {
        fx: s.sunThroughClouds,
        cloudShadows: s.state.cloudShadows,
        sunLightDim: s.state.sunLightDim,
      };
    });
  expect(await now()).toEqual({
    fx: { discExponent: 4, aureole: 1, silverLining: 1 },
    cloudShadows: true,
    sunLightDim: false,
  });
  const switches = [
    ["#sun-disc", "sunDisc", (v) => v.fx.discExponent === 0],
    ["#sun-aureole", "sunAureole", (v) => v.fx.aureole === 0],
    ["#sun-silver", "sunSilver", (v) => v.fx.silverLining === 0],
    ["#cloud-shadows", "cloudShadows", (v) => v.cloudShadows === false],
  ];
  let before = await now();
  for (const [id, key, off] of switches) {
    await expect(page.locator(id)).toBeChecked();
    await page.locator(id).uncheck({ force: true });
    const after = await now();
    expect(off(after), id).toBe(true);
    // Nothing else moved: only this switch's own value changed.
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    expect(changed).toBe(true);
    const others = switches.filter(([other]) => other !== id);
    for (const [, , otherOff] of others) {
      expect(otherOff(after)).toBe(otherOff(before));
    }
    expect(await page.evaluate(() => location.hash)).toContain(`${key}=0`);
    before = after;
  }
  await expect(page.locator("#sun-light-dim")).not.toBeChecked();
  await page.locator("#sun-light-dim").check({ force: true });
  expect((await now()).sunLightDim).toBe(true);
  expect(await page.evaluate(() => location.hash)).toContain("sunLightDim=1");
  expect(errors).toEqual([]);
});

// The sun light dimmed as a whole: against the switch off at the same
// pixels, sunlit ground darkens where the column over the scene's centre
// is thick, and nothing changes under a clear one (the cloud shadows off,
// so only this effect is measured).
test("the sun light dims under a thick column over the scene, and not under a clear one", async ({
  page,
}) => {
  const errors = await boot(
    page,
    "preset=noon&tone=neutral&cloudMode=dome&cloudShadows=0&sunLightDim=0",
  );
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    d.setCloudCover(0.5);
    d.setView("city");
  });
  const lit = await page.evaluate(() => {
    const d = window.__lookdev;
    return d.project(d.shadowProbe().lit);
  });
  const found = await page.evaluate(() => {
    const d = window.__lookdev;
    const out = { thick: null, clear: null };
    for (let i = 0; i < 64 && !(out.thick && out.clear); i++) {
      const o = [((i * 29) % 64) / 64, ((i * 37) % 64) / 64];
      d.setCloudOffset(o[0], o[1]);
      const t = d.sunLightDimInfo().transmittance;
      if (t < 0.3 && !out.thick) out.thick = { o, t };
      if (t > 0.97 && !out.clear) out.clear = { o, t };
    }
    return out;
  });
  expect(found.thick).not.toBeNull();
  expect(found.clear).not.toBeNull();
  const pair = (o) =>
    page.evaluate(
      ([o, point]) => {
        const d = window.__lookdev;
        d.setCloudOffset(o[0], o[1]);
        d.setSunLightDim(false);
        const [off] = d.readPixels([point]);
        d.setSunLightDim(true);
        const [on] = d.readPixels([point]);
        const info = d.sunLightDimInfo();
        d.setSunLightDim(false);
        return { off, on, info };
      },
      [o, lit],
    );
  const thick = await pair(found.thick.o);
  const clear = await pair(found.clear.o);
  console.log(
    `sun light dim: thick column T ${found.thick.t.toFixed(3)} ground ${sum(thick.off)} -> ${sum(thick.on)} (intensity x${(thick.info.intensity / thick.info.base).toFixed(3)}); clear T ${found.clear.t.toFixed(3)} ground ${sum(clear.off)} -> ${sum(clear.on)}`,
  );
  expect(thick.info.intensity / thick.info.base).toBeCloseTo(found.thick.t, 6);
  expect(sum(thick.off) - sum(thick.on)).toBeGreaterThanOrEqual(20);
  expect(Math.abs(sum(clear.off) - sum(clear.on))).toBeLessThanOrEqual(3);
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
      // Interleaved off/on/off rounds, the median ratio: other sessions
      // load this machine, and one round read x0.89 and x1.44 back to back.
      const rounds = [];
      for (let k = 0; k < 3; k++) {
        const off1 = time({ discExponent: 0, aureole: 0, silverLining: 0 });
        const on = time({ discExponent: 4, aureole: 1, silverLining: 1 });
        const off2 = time({ discExponent: 0, aureole: 0, silverLining: 0 });
        rounds.push({ on, off: (off1 + off2) / 2 });
      }
      rounds.sort((x, y) => x.on / x.off - y.on / y.off);
      const { on, off } = rounds[1];
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
const SHADOW = { darkMin: 45, clearMax: 3, thickShare: 0.8 };

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
    // Interleaved rounds, the median ratio (the machine is shared).
    const rounds = [];
    for (let k = 0; k < 3; k++) {
      const off1 = time(false);
      const on = time(true);
      const off2 = time(false);
      rounds.push({ on, off: (off1 + off2) / 2 });
    }
    rounds.sort((x, y) => x.on / x.off - y.on / y.off);
    const { on, off } = rounds[1];
    return { on, off, ratio: on / off };
  });
  console.log(
    `cloud shadows cost (city view): ${r.on.toFixed(0)}/${r.off.toFixed(0)} ms = x${r.ratio.toFixed(3)}`,
  );
  expect(r.ratio).toBeLessThan(1.3);
  expect(errors).toEqual([]);
});

// WHY (owner bug report 2026-09-28): a cloud's shadow on the ground must
// not depend on the camera. The r758 review fix weighted the column by what
// the camera's sky draws, so with a low sun (the crossing ~22 km out, past
// the slab's far fade) every ground shadow vanished, and came back when the
// camera moved toward the sun. Swept over the sun's elevation, the two
// cloud modes and three street-level cameras (the city view, and looking
// toward and away from the sun): the GPU's shadow must follow the
// view-free twin (clear columns change nothing, thick ones darken), and the
// thick columns must darken at a low sun too (the case that used to vanish).
// Every camera is below the cloud base (1,800 m): the check reads the
// ground's pixels, so a camera inside or above the deck (the "aloft" view
// at 2,150 m, used first) sees the cloud in front of the ground instead and
// measures the deck, not the shadow (owner decision 2026-10-04).
test("cloud shadows are the column alone, the same from every viewpoint, at every sun elevation", async ({
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
    d.setCloudCover(0.6);
  });
  const lines = [];
  const results = [];
  for (const view of ["city", "sun", "antisun"]) {
    for (const mode of ["dome", "slab"]) {
      for (const elevation of [2, 5, 10, 20, 58]) {
        await page.evaluate(
          ([v, m, e]) => {
            const d = window.__lookdev;
            d.setCloudMode(m);
            const slider = document.querySelector("#elevation");
            slider.value = String(e);
            slider.dispatchEvent(new Event("input"));
            d.setView(v);
          },
          [view, mode, elevation],
        );
        const samples = await groundSamples(page);
        let clear = 0;
        let clearMoved = 0;
        let thick = 0;
        let thickDark = 0;
        for (const offset of OFFSETS.slice(0, 3)) {
          const twin = await twinAt(page, samples, offset);
          const { off, on } = await shadedPair(page, samples, offset);
          samples.forEach((s, i) => {
            const drop = sum(off[i]) - sum(on[i]);
            if (twin[i] > 0.95) {
              clear += 1;
              if (Math.abs(drop) > SHADOW.clearMax) clearMoved += 1;
            } else if (twin[i] < 0.2) {
              thick += 1;
              if (drop >= SHADOW.darkMin / 3) thickDark += 1;
            }
          });
        }
        lines.push(
          `${view} ${mode} ${elevation}°: ${samples.length} points, clear ${clear} (moved ${clearMoved}), thick ${thick} (dark ${thickDark})`,
        );
        results.push({ view, mode, elevation, clearMoved, thick, thickDark });
      }
    }
  }
  console.log(
    `cloud shadows by view and elevation (cover 0.6): ${lines.join("; ")}`,
  );
  for (const r of results) {
    const at = `${r.view} ${r.mode} ${r.elevation}°`;
    // Clear columns change nothing, from every camera and at every sun.
    expect(r.clearMoved, at).toBe(0);
    // Thick columns darken from 5° up (at 2° the direct sun itself is too
    // dim to show a shadow; logged only). A view weight fails this at 5°.
    if (r.elevation >= 5 && r.thick > 0) {
      expect(r.thickDark / r.thick, at).toBeGreaterThan(SHADOW.thickShare);
    }
  }
  // The owner's case: a low sun in the slab, from the city view, has thick
  // columns, and they shade the ground.
  const low = results.find(
    (r) => r.view === "city" && r.mode === "slab" && r.elevation === 5,
  );
  expect(low.thick).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Round-3 review, finding 4: a lobe switch re-bakes the environment, whose
// dome clouds then carry the glow, so the glow also reaches every lit
// surface's image-based light. Measured on the lit ground and objects
// (never the sky) against the lobes off, at the same pixels.
test("the glow's share of the scene's image-based light, lobes on against off (logged)", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=dome");
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudCover(0.5);
    d.setCloudOffset(0.13, 0.41);
    d.setView("city");
  });
  const grid = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 8; j++) grid.push([0.36 + i * 0.065, 0.3 + j * 0.09]);
  }
  const hits = await page.evaluate((g) => window.__lookdev.groundAt(g), grid);
  const lit = grid.filter((_, i) => hits[i] !== null);
  expect(lit.length).toBeGreaterThan(20);
  const results = {};
  for (const preset of ["noon", "golden"]) {
    const r = await page.evaluate(
      ([p, points]) => {
        const d = window.__lookdev;
        d.setPreset(p);
        d.setCloudCover(0.5);
        d.setCloudOffset(0.13, 0.41);
        d.setView("city");
        d.setSunThroughCloudsRaw({
          discExponent: 0,
          aureole: 0,
          silverLining: 0,
        });
        const off = d.readPixels(points);
        d.setSunThroughCloudsRaw({
          discExponent: 0,
          aureole: 1,
          silverLining: 1,
        });
        const on = d.readPixels(points);
        return { off, on };
      },
      [preset, lit],
    );
    const diffs = r.on.map((px, i) => sum(px) - sum(r.off[i]));
    results[preset] = {
      max: Math.max(...diffs.map(Math.abs)),
      mean: diffs.reduce((t, x) => t + x, 0) / diffs.length,
    };
  }
  console.log(
    `glow in the bake, lit ground (sum of RGB): ${Object.entries(results)
      .map(([p, v]) => `${p} max ${v.max}, mean ${v.mean.toFixed(2)}`)
      .join("; ")}`,
  );
  // Declared: 2 levels is below what the eye tells apart on lit ground.
  for (const v of Object.values(results)) expect(v.max).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

// Round-3 review, finding 5: the cost in the page's OPENING state (the dense
// city, shadows, the catalog, the slab, the phone tier), the cloud shadows
// and the sun-through-cloud terms each on against off, interleaved rounds,
// the median ratio. SwiftShader on a shared machine: relative only.
test("the cost in the page's opening state, each effect on against off (logged)", async ({
  page,
}) => {
  // The opening state is the page's heaviest (a slab frame over 42,000
  // buildings with two shadow maps): 36 frames need more than the default.
  test.setTimeout(600_000);
  const errors = await boot(page, "preset=noon&tone=neutral", {
    pageDefaults: true,
  });
  const ratios = await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    const ratio = (set) => {
      const rounds = [];
      for (let k = 0; k < 3; k++) {
        set(false);
        const off1 = d.timeFrames(1).medianMs;
        set(true);
        const on = d.timeFrames(1).medianMs;
        set(false);
        const off2 = d.timeFrames(1).medianMs;
        rounds.push({ on, off: (off1 + off2) / 2 });
      }
      set(true);
      rounds.sort((a, b) => a.on / a.off - b.on / b.off);
      return rounds[1];
    };
    return {
      cloudShadows: ratio((on) => d.setCloudShadows(on)),
      sunThroughClouds: ratio((on) =>
        d.setSunThroughClouds({ disc: on, aureole: on, silver: on }),
      ),
      state: d.stats().state,
    };
  });
  expect([
    ratios.state.city,
    ratios.state.cloudMode,
    ratios.state.tier,
  ]).toEqual([100000, "slab", "phone"]);
  console.log(
    `opening-state cost (phone tier): cloud shadows ${ratios.cloudShadows.on.toFixed(0)}/${ratios.cloudShadows.off.toFixed(0)} ms = x${(ratios.cloudShadows.on / ratios.cloudShadows.off).toFixed(3)}; sun through clouds ${ratios.sunThroughClouds.on.toFixed(0)}/${ratios.sunThroughClouds.off.toFixed(0)} ms = x${(ratios.sunThroughClouds.on / ratios.sunThroughClouds.off).toFixed(3)}`,
  );
  expect(errors).toEqual([]);
});

// --- The horizon shimmer (DEC-FB3-8), measured --------------------------------

/**
 * The shimmer at the horizon: the camera yaws by a quarter of a pixel per
 * frame, and the mean absolute frame-to-frame change (sum of RGB) is taken
 * over the low sky, about 5-15° up. A well-filtered cloud moves smoothly;
 * an under-filtered one flickers.
 */
const shimmer = (page, frames = 6) =>
  page.evaluate((frames) => {
    const d = window.__lookdev;
    const eye = [-20, 18, 60];
    const pitch = (8 * Math.PI) / 180;
    const pixelAngle = (55 * Math.PI) / 180 / 800;
    let previous = null;
    let total = 0;
    let count = 0;
    for (let f = 0; f <= frames; f++) {
      const yaw = Math.PI * 0.25 + f * 0.25 * pixelAngle;
      d.placeCameraAt(eye, [
        eye[0] + Math.cos(yaw) * Math.cos(pitch) * 100,
        eye[1] + Math.sin(pitch) * 100,
        eye[2] - Math.sin(yaw) * Math.cos(pitch) * 100,
      ]);
      const { width, height, data } = d.readFrame();
      // Rows from the bottom: pitch 8°, a 55° field, so 5-15° up is about
      // 0.445-0.627 of the height.
      const band = [];
      for (
        let y = Math.floor(height * 0.445);
        y < Math.floor(height * 0.627);
        y += 2
      ) {
        for (let x = Math.floor(width * 0.35); x < width; x += 2) {
          const i = (y * width + x) * 4;
          band.push(data[i] + data[i + 1] + data[i + 2]);
        }
      }
      if (previous) {
        for (let k = 0; k < band.length; k++) {
          total += Math.abs(band[k] - previous[k]);
          count += 1;
        }
      }
      previous = band;
    }
    return total / count;
  }, frames);

// DEC-FB3-8 asked for a resolution-aware noise ("octaves finer than the
// pixel become their mean"). Our clouds are a MIPMAPPED texture: the dome
// and the sheet read it with the GPU's own level (from the derivatives),
// the slab with an explicit level from the larger of the pixel's footprint
// and the ground a march step skips, and at the default 8 steps the step
// term is the larger one everywhere the clouds are drawn (the record's
// sweep: the pixel's footprint projected on the slab's planes changes the
// level only past about 5° up, where the far fade has hidden the clouds;
// a candidate that did so measured the same shimmer to two decimals). So
// this logs the shimmer per mode and asserts only that a still camera
// reads a still sky (the slab's per-pixel jitter is static).
test("the horizon shimmer per cloud mode under a quarter-pixel pan (logged)", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&cloudMode=dome");
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setFloatingVisible(false);
    d.setCloudCover(0.5);
    d.setCloudOffset(0, 0);
  });
  const results = {};
  for (const mode of ["dome", "sheet", "slab"]) {
    await page.evaluate((m) => {
      const d = window.__lookdev;
      d.setCloudMode(m);
      d.setCloudOffset(0, 0);
    }, mode);
    const still = await page.evaluate(() => {
      const d = window.__lookdev;
      const a = d.readFrame().data;
      const b = d.readFrame().data;
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
      return n;
    });
    expect(still, mode).toBe(0);
    results[mode] = await shimmer(page);
  }
  console.log(
    `horizon shimmer (mean |dL| per quarter-pixel pan, 5-15° up): ${Object.entries(
      results,
    )
      .map(([m, v]) => `${m} ${v.toFixed(2)}`)
      .join(", ")}`,
  );
  expect(errors).toEqual([]);
});
