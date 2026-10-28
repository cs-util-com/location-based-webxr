// @ts-check
/**
 * The fixed-view sweep's ends that are not Done: a reload in the middle of
 * a sweep, and a device that drops the page's graphics (a lost WebGL
 * context).
 *
 * Why this file matters: on a phone both happen mid-sweep. iOS reloads a
 * tab it killed for memory, and an auto-starting link would then start
 * over and lose every run measured so far; a lost context keeps frames
 * coming (three.js keeps its animation loop), so a sweep that did not
 * notice it would time an empty canvas and export numbers that look fine.
 * Either way the tester must get what was measured, with Copy and
 * Download, and the export must say what happened and on which GPU.
 *
 * SwiftShader renders on the CPU, so nothing here asserts a time. The
 * relief and the city are off: nothing leaves 127.0.0.1.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const HASH = [
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0",
  "stars=0&milkyWay=0&atmo=0&groundSky=0&cloudVolume=0",
  "relief=0&city=0&cityWarm=0",
  "at=46.948,7.4474",
  "perf=1&perfAuto=1&perfItems=0,3&perfRepeats=1&perfHoldS=1&perfViewSettleS=5&perfQuietS=1&perfWarmup=0",
  // SwiftShader takes seconds a frame: the frame watchdog would stop it.
  "perfWatchdogS=600",
].join("&");

const status = (page) => page.evaluate(() => window.__globeLab.perf.status());
const runs = (page) => page.evaluate(() => window.__globeLab.perf.runs());
const waitRuns = (page, n) =>
  page.waitForFunction((want) => window.__globeLab.perf.runs() >= want, n, {
    timeout: 600_000,
    polling: 500,
  });

// WHY: a reload must never start the sweep over by itself, and must offer
// the cut-off sweep's runs; a lost context must stop the sweep at once,
// say where, and leave Copy and Download working with the GPU named. Run
// stays off after a loss: the graphics stay lost, so a new sweep would
// wipe the kept results and stop at once.
test("a reload offers the cut-off sweep, and a lost context stops a sweep with its results", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const errors = await bootGlobe(page, HASH, { plain: false });
  await page.waitForFunction(() => window.__globeLab.perf !== null, null, {
    timeout: 30_000,
  });
  await waitRuns(page, 1);

  // The page reloaded mid-sweep (same origin, same storage).
  await page.reload();
  await page.waitForFunction(
    () => window.__globeLab?.perf && window.__globeLab.perf.status() !== "idle",
    null,
    { timeout: 120_000 },
  );
  expect(await status(page)).toMatch(
    /^Previous sweep cut off after \d+ of 8 runs \(page reloaded\)/,
  );
  await expect(page.locator('[data-perf="run"]')).toHaveText("Start fresh");
  await expect(page.locator('[data-perf="copy"]')).toBeEnabled();
  await expect(page.locator('[data-perf="download"]')).toBeEnabled();
  // Not started by itself, though the link says perfAuto=1.
  await page.waitForTimeout(3_000);
  expect(await runs(page)).toBe(0);
  expect(await status(page)).toMatch(/^Previous sweep/);
  const kept = await page.evaluate(() => {
    const entry = JSON.parse(localStorage.getItem("globe-perf-sweep"));
    return { state: entry.state, runs: JSON.parse(entry.text).lab.length };
  });
  expect(kept.state).toBe("running");
  expect(kept.runs).toBeGreaterThanOrEqual(1);

  // A fresh sweep, then the device drops the graphics after its first run.
  await page.locator('[data-perf="run"]').click();
  await waitRuns(page, 1);
  await page.evaluate(() => window.__globeLab.perf.forceContextLoss());
  await page.waitForFunction(
    () => /^The device dropped/.test(window.__globeLab.perf.status()),
    null,
    { timeout: 120_000, polling: 250 },
  );
  expect(await status(page)).toMatch(
    /^The device dropped the page's graphics at .+; results up to there are kept\. Copy or Download them, then reload the page\.$/,
  );
  await expect(page.locator('[data-perf="run"]')).toBeDisabled();
  await expect(page.locator('[data-perf="copy"]')).toBeEnabled();
  await expect(page.locator('[data-perf="download"]')).toBeEnabled();
  const out = JSON.parse(
    await page.evaluate(() => window.__globeLab.perf.exportText()),
  );
  expect(out.outcome).toBe("stopped");
  expect(out.contextLost).not.toBeNull();
  expect(typeof out.contextLost.at).toBe("string");
  // The device block was read while the context was alive.
  expect(typeof out.device.gpuRenderer).toBe("string");
  expect(out.device.gpuRenderer.length).toBeGreaterThan(0);
  expect(out.lab.length).toBeGreaterThanOrEqual(1);
  expect(out.lab.length).toBeLessThan(8);
  // Kept for a reload too, as stopped.
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("globe-perf-sweep")).state,
    ),
  ).toBe("stopped");
  // three logs the loss itself ("THREE.WebGLRenderer: Context Lost.").
  expect(errors.filter((e) => !/Context Lost/i.test(e))).toEqual([]);
});
