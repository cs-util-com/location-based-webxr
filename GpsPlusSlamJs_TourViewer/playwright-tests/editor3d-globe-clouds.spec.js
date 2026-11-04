// @ts-check
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { encodeRgbPng } from "../../scripts/e2e/terrarium-png.mjs";
import {
  afterFrames,
  answerHosts,
  keepRejections,
  rejections,
  reliefCarries,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the globe editor carries the globe lab's heavy
 * clouds, and at the landing (150 m over the tour, 50 degrees down) two
 * things were reported about them. Their shadow darkened everything, the
 * stations' markers, rings and titles as much as the ground; and they
 * looked static. Both are read here on the real page, with the clouds'
 * map answered by a white image (a full cloud overhead), so the readings
 * do not depend on the weather in the real map:
 *
 * - the shadow: the luma of the ground, a station's billboard (its number
 *   and title), a point of its found radius's ring and the tour's 3D model,
 *   with the clouds on and off. The shell's shadow is composited over the
 *   whole frame after the scene, so the interface is drawn after it
 *   (`globe-interface-pass.ts`) and must keep its brightness. The ratios
 *   are asserted only where the clouds change the canvas measurably; the
 *   software renderer draws no cloud shadow at the landing (measured), so
 *   there they are readings, and the phone's check is the real one.
 * - the motion: the drift's rate and the map's offset over about 3 s at
 *   the landing (the canvas's change is read too, 0 where no cloud shows),
 *   with the longest frame interval in the window and the seconds the
 *   drift could step (it steps at most 1 s a frame).
 *
 * Extra readings: `CLOUD_SHADOW_SWEEP=0.2,0.45,0.6` and
 * `CLOUD_WIND_SWEEP=10,80` (extra pages; the defaults, shadow 0.3 and wind
 * 40, are always measured, on one page);
 * `CLOUD_SHOTS=<dir>` saves each strength's pictures, clouds on and off.
 */

/** The clouds' map, whatever tile or size the page asks for. */
const CLOUD_MAP = /\/globe-assets\/equirect\/clouds-[^/]*\.webp$/;

/** A desktop canvas: the editor's own size. */
const DESKTOP = { width: 1280, height: 800 };

/** @param {string | undefined} text @param {number} min @param {number} max */
function sweepOf(text, min, max) {
  return (text ?? "")
    .split(",")
    .filter((t) => t.trim() !== "")
    .map(Number)
    .filter((v) => Number.isFinite(v) && v >= min && v <= max);
}

/**
 * A fresh page at the tour's landing (reduced motion: the view cuts to the
 * approach's end), with the clouds' map answered by a uniform `grey` and
 * the relief carrying the ground.
 * @param {import("@playwright/test").Browser} browser
 * @param {string} query
 * @param {number} grey
 */
async function landed(browser, query, grey) {
  const page = await browser.newPage({
    viewport: DESKTOP,
    reducedMotion: "reduce",
  });
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  const map = encodeRgbPng(64, 32, new Array(64 * 32 * 3).fill(grey));
  // Matched before `answerHosts`' own globe route (later routes go first).
  await page.route(CLOUD_MAP, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: map }),
  );
  await page.goto(`/edit.html?globe=1&${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect
    .poll(async () => (await view3d(page))?.globe?.approach?.ended ?? null, {
      timeout: 120_000,
    })
    .toBe("landed");
  await expect
    .poll(async () => (await view3d(page))?.globe?.air?.clouds?.on)
    .toBe(true);
  await reliefCarries(page);
  // The clouds' map is in and the views settle over a few frames.
  await afterFrames(page, 20);
  return page;
}

/**
 * The canvas as RGBA pixels (CSS px; a software-drawn WebGL keeps no
 * drawing buffer to read back, so from a screenshot).
 * @param {import("@playwright/test").Page} page
 */
async function canvasPixels(page) {
  const box = await page.locator("#view3d canvas").boundingBox();
  if (box === null) throw new Error("no canvas");
  const png = await page.screenshot({ clip: box });
  const data = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: Array.from(
        context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      ),
    };
  }, png.toString("base64"));
  return { ...data, scale: data.width / box.width };
}

/** @typedef {{ width: number, height: number, rgba: number[], scale: number }} Pixels */

/** @param {Pixels} p @param {number} i */
const lumaAt = (p, i) =>
  0.2126 * (p.rgba[4 * i] ?? 0) +
  0.7152 * (p.rgba[4 * i + 1] ?? 0) +
  0.0722 * (p.rgba[4 * i + 2] ?? 0);

/**
 * The pixel indices of a square patch (half side `half`, CSS px) at a
 * canvas point (CSS px).
 * @param {Pixels} p @param {readonly [number, number]} at @param {number} half
 */
function patch(p, at, half) {
  /** @type {number[]} */
  const out = [];
  const cx = Math.round(at[0] * p.scale);
  const cy = Math.round(at[1] * p.scale);
  const h = Math.round(half * p.scale);
  for (let y = cy - h; y <= cy + h; y++) {
    for (let x = cx - h; x <= cx + h; x++) {
      if (x >= 0 && y >= 0 && x < p.width && y < p.height) {
        out.push(y * p.width + x);
      }
    }
  }
  return out;
}

/** @param {number[]} values */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * The probes' pixels, chosen on the clouds-off picture: the ground (a
 * patch low on the left, away from the tour), the billboard (a patch over
 * its middle, 17 px above its anchor), the ring (the bluest pixel near its
 * point: the ring is about 2 px wide) and the model (the pixel near its
 * middle that differs most from the ground). Each is a list of indices,
 * read the same in the clouds-on picture.
 * @param {Pixels} off
 * @param {any} probes
 */
function probePixels(off, probes) {
  const w = off.width / off.scale;
  const h = off.height / off.scale;
  const ground = patch(off, [w * 0.12, h * 0.88], 6);
  const groundLuma = median(ground.map((i) => lumaAt(off, i)));
  /** @type {Record<string, number[]>} */
  const out = { ground };
  if (probes?.billboard) {
    out["billboard"] = patch(
      off,
      [probes.billboard[0], probes.billboard[1] - 17],
      5,
    );
  }
  if (probes?.ring) {
    const near = patch(off, probes.ring, 4);
    const blue = (/** @type {number} */ i) =>
      (off.rgba[4 * i + 2] ?? 0) - (off.rgba[4 * i] ?? 0);
    out["ring"] = [near.reduce((a, b) => (blue(b) > blue(a) ? b : a))];
  }
  if (probes?.model) {
    const near = patch(off, probes.model, 6);
    const apart = (/** @type {number} */ i) =>
      Math.abs(lumaAt(off, i) - groundLuma);
    const best = near.reduce((a, b) => (apart(b) > apart(a) ? b : a));
    // A model too small to cover a pixel there is not measured.
    if (apart(best) > 10) out["model"] = [best];
  }
  return out;
}

/** @param {Pixels} p @param {number[]} indices */
const lumaOf = (p, indices) => median(indices.map((i) => lumaAt(p, i)));

/** The clouds' toggle in the View menu. @param {import("@playwright/test").Page} page */
async function toggleClouds(page) {
  await page.locator("#view-menu-btn").click();
  await page.locator("#view-clouds").click();
  await page.keyboard.press("Escape");
}

/**
 * The canvas's mean absolute luma change between two pictures.
 * @param {Pixels} a @param {Pixels} b
 */
function meanLumaChange(a, b) {
  let sum = 0;
  const n = Math.min(a.rgba.length, b.rgba.length) / 4;
  for (let i = 0; i < n; i++) sum += Math.abs(lumaAt(a, i) - lumaAt(b, i));
  return Math.round((sum / Math.max(1, n)) * 100) / 100;
}

/**
 * The clouds' drift over about 3 s on a landed page: the canvas's change,
 * the seconds waited, the view's rate (deg/s) and the offset's change
 * (deg). The camera holds still meanwhile.
 * @param {import("@playwright/test").Page} page
 */
async function driftOver3s(page) {
  const first = await view3d(page);
  const a = await canvasPixels(page);
  const t0 = Date.now();
  await expect
    .poll(() => Date.now() - t0, { intervals: [500] })
    .toBeGreaterThan(3_000);
  await afterFrames(page, 2);
  const second = await view3d(page);
  const b = await canvasPixels(page);
  expect(second.camera).toEqual(first.camera);
  // The frame intervals inside the window (the last 60 are kept): the
  // drift steps at most 1 s a frame, so a longer frame drops time.
  /** @type {number[]} */
  const intervals = second.globe.frameTimesMs ?? [];
  const inWindow = intervals.slice(
    -Math.max(0, Math.min(intervals.length, second.frames - first.frames)),
  );
  return {
    longestFrameMs: Math.round(Math.max(0, ...inWindow)),
    framesInWindow: inWindow.length,
    // The seconds the drift could step: each interval capped at 1 s.
    cappedSeconds:
      Math.round(
        inWindow.reduce((sum, ms) => sum + Math.min(ms, 1000), 0) / 100,
      ) / 10,
    meanLumaChange: meanLumaChange(a, b),
    seconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
    // The view's rate is in degrees a second already.
    driftRateDegPerS: first.globe.clouds.driftRate,
    offsetChangeDeg:
      ((second.globe.clouds.lonOffsetRad - first.globe.clouds.lonOffsetRad) *
        180) /
      Math.PI,
  };
}

/**
 * The probes' luma with the clouds on over off (1: unchanged), each probe's
 * luma off, and what the clouds drew with: the shell's plan and counters
 * and the objects the interface pass lifted. The clouds end off.
 * @param {import("@playwright/test").Page} page
 * @param {string} name the pictures' name under `CLOUD_SHOTS`
 */
async function shadowRatios(page, name) {
  const stats = await view3d(page);
  const on = await canvasPixels(page);
  const shots = process.env["CLOUD_SHOTS"];
  const canvas = page.locator("#view3d canvas");
  if (shots)
    writeFileSync(join(shots, `${name}-on.png`), await canvas.screenshot());
  await toggleClouds(page);
  await expect
    .poll(async () => (await view3d(page))?.globe?.air?.clouds?.on)
    .toBe(false);
  await afterFrames(page, 10);
  const off = await canvasPixels(page);
  if (shots)
    writeFileSync(join(shots, `${name}-off.png`), await canvas.screenshot());
  /** @type {Record<string, number>} */
  const ratios = {};
  for (const [probe, indices] of Object.entries(
    probePixels(off, stats.globe.clouds.probes),
  )) {
    const lumaOff = lumaOf(off, indices);
    ratios[probe] =
      Math.round((lumaOf(on, indices) / Math.max(1, lumaOff)) * 100) / 100;
    ratios[`${probe}Off`] = Math.round(lumaOff);
  }
  return {
    ...ratios,
    ...drawnWith(stats),
    canvasChange: meanLumaChange(on, off),
  };
}

/**
 * What the clouds drew with (the stats with the clouds on): the shell's
 * plan and counters and the objects the interface pass lifted.
 * @param {any} stats
 */
function drawnWith(stats) {
  const plan = stats.globe.air.clouds;
  const shell = stats.globe.clouds.shell;
  return {
    shellOn: plan.shellOn ? 1 : 0,
    shellShadow: plan.shellShadow,
    surfaceShadow: plan.surfaceShadow,
    shellDrawn: shell.drawn,
    shellIn: shell.share,
    slabWeight: shell.slabWeight,
    lifted: stats.globe.clouds.interfaceLifted,
  };
}

/**
 * The canvas's mean luma change (0-255) between clouds on and off above
 * which the clouds show, and the shadow ratios are asserted.
 */
const SHADOW_VISIBLE_LUMA = 0.5;

/** Extra strengths (`CLOUD_SHADOW_SWEEP`) and winds (`CLOUD_WIND_SWEEP`). */
const SHADOW_SWEEP = sweepOf(process.env["CLOUD_SHADOW_SWEEP"], 0, 1);
const WIND_SWEEP = sweepOf(process.env["CLOUD_WIND_SWEEP"], 0, 1000);

test("at the landing the clouds drift on real time and their shadow leaves the interface undimmed", async ({
  browser,
}, testInfo) => {
  // A software-drawn page takes 6 to 10 min to land and settle under the
  // machine's load (measured 2026-11-03), and the drift and shadow
  // readings add about 2 min (a 600 s budget ran out after them on
  // 2026-11-04); one page by default.
  const extra = SHADOW_SWEEP.length + WIND_SWEEP.length;
  test.setTimeout(900_000 * (1 + extra));
  /** @type {Record<string, unknown>} */
  const readings = {};
  // The defaults (shadow 0.3, wind 40) on one page: the drift first, then
  // the clouds off.
  const page = await landed(browser, "", 255);
  try {
    readings["drift 40"] = await driftOver3s(page);
    readings["shadow 0.3"] = await shadowRatios(page, "clouds-0.3");
    expect(await rejections(page)).toEqual([]);
  } finally {
    await page.close();
  }
  for (const shadow of SHADOW_SWEEP) {
    const swept = await landed(browser, `cloudShadow=${shadow}`, 255);
    try {
      readings[`shadow ${shadow}`] = await shadowRatios(
        swept,
        `clouds-${shadow}`,
      );
    } finally {
      await swept.close();
    }
  }
  for (const wind of WIND_SWEEP) {
    const swept = await landed(browser, `cloudWind=${wind}`, 140);
    try {
      readings[`drift ${wind}`] = await driftOver3s(swept);
    } finally {
      await swept.close();
    }
  }
  const reading = JSON.stringify(readings);
  testInfo.annotations.push({ type: "cloud readings", description: reading });
  console.log(`cloud readings ${reading}`);

  // The drift runs on real time, not on the frames (a software-drawn page
  // draws 2 to 3 a second; 2026-11-03 at 10 m/s: 0.0060 of 0.0088 degrees
  // in 98 s, the rest before the first frame was read), at the wind
  // floor's rate near the ground: 40 m/s over 111 km a degree.
  for (const [key, value] of Object.entries(readings)) {
    if (!key.startsWith("drift ")) continue;
    const r = /** @type {Record<string, number>} */ (value);
    const expected = (r["driftRateDegPerS"] ?? 0) * (r["seconds"] ?? 0);
    expect(r["offsetChangeDeg"]).toBeGreaterThan(0.4 * expected);
    expect(r["offsetChangeDeg"]).toBeLessThan(1.2 * expected);
  }
  const drift = /** @type {Record<string, number>} */ (readings["drift 40"]);
  expect(drift["driftRateDegPerS"]).toBeCloseTo(40 / 111_195, 6);

  // The shadow: the shell runs and casts at the link's strength, and the
  // interface is drawn after it (lifted out of the scene's pass), so by
  // reading the code the billboards and rings keep their brightness; the
  // phone check confirms it.
  const shade = /** @type {Record<string, number>} */ (readings["shadow 0.3"]);
  expect(Object.keys(shade)).toEqual(
    expect.arrayContaining(["ground", "billboard", "ring"]),
  );
  expect(shade["shellOn"]).toBe(1);
  expect(shade["shellShadow"]).toBe(0.3);
  expect(shade["shellDrawn"]).toBeGreaterThan(0);
  expect(shade["lifted"]).toBeGreaterThan(0);
  // The ratios are asserted only where the clouds change the canvas
  // measurably: the software renderer draws no visible cloud shadow (the
  // canvas identical on and off), and there they pass with or without the
  // interface pass, so they are only readings (logged above).
  for (const [key, value] of Object.entries(readings)) {
    if (!key.startsWith("shadow ")) continue;
    const r = /** @type {Record<string, number>} */ (value);
    if ((r["canvasChange"] ?? 0) <= SHADOW_VISIBLE_LUMA) continue;
    expect(r["billboard"]).toBeGreaterThan(0.95);
    expect(r["ring"]).toBeGreaterThan(0.95);
    // Never brighter with the clouds: they only take light.
    expect(r["ground"]).toBeLessThan(1.05);
  }
  // NOT measured here: how much the ground and the models darken. The
  // software renderer draws no cloud shadow at the landing at all (the
  // canvas identical with the clouds on and off at every strength,
  // 2026-11-03, while the shell drew with its shadow on), so that is the
  // phone's check (`?cloudShadow=0.3 / 0.45 / 0.6`). Where a renderer
  // does draw it, the ground's ratio is in the readings.
});
