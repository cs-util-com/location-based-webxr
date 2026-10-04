// @ts-check
/**
 * The globe lab's frame-hitch recorder (globe zoom frame-hitch plan
 * 2026-10-03-2017 §4, PERF-1; `globe-perf.js`).
 *
 * Why this file matters: the recorder runs once on a phone and its
 * export is pasted into a chat; a recorder that missed an event, mislabelled a run or
 * could not get its text off the phone would waste that run. So these
 * smokes check the recorder itself (§4.6): it does nothing without
 * `#perf=1`; a frame-stepped path through the band records each event
 * where it must occur (a band crossing yields E steps, relief loads, band
 * edges, a new program and the controls' raycasts); the export has the
 * framework's shape plus the lab's counts; the overlay is usable at phone
 * width and Copy and Download each reach the text or fall back to a box;
 * the overhead sweep runs its hooks off and on.
 *
 * SwiftShader renders on the CPU, so nothing here asserts a time: every
 * assertion is a count, a shape or a presence. The counts are logged as
 * the baseline the plan's count-only factors are decided on (§4.3).
 * Heights are synthetic and the city data is routed by the helper: nothing
 * leaves 127.0.0.1.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0&reliefHeights=synthetic";

/** Boots with the recorder and waits for its API. */
async function bootPerf(page, hash) {
  const errors = await bootGlobe(page, hash);
  await page.waitForFunction(() => window.__globeLab.perf !== null, null, {
    timeout: 30_000,
  });
  return errors;
}

/** Presses Run and waits for the end (Done or Failed), bounded. */
async function runToEnd(page, timeout) {
  await page.locator('[data-perf="run"]').click();
  await page.waitForFunction(
    () => /^(Done|Failed)/.test(window.__globeLab.perf.status()),
    null,
    { timeout, polling: 500 },
  );
  expect(await page.evaluate(() => window.__globeLab.perf.status())).toMatch(
    /^Done/,
  );
  return JSON.parse(
    await page.evaluate(() => window.__globeLab.perf.exportText()),
  );
}

// WHY (§4.1 "off, the page does no extra work"): without the flag the
// recorder's module is never fetched and no overlay is drawn.
test("without #perf=1 the recorder is neither loaded nor shown", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = await bootGlobe(page, `${BASE}&relief=1`);
  const seen = await page.evaluate(() => ({
    api: window.__globeLab.perf,
    panel: document.getElementById("globe-perf") !== null,
    fetched: performance
      .getEntriesByType("resource")
      .filter((e) => /globe-perf/.test(e.name))
      .map((e) => e.name),
  }));
  expect(errors).toEqual([]);
  expect(seen).toEqual({ api: null, panel: false, fetched: [] });
});

// WHY (§4.2, §4.6): the frame-stepped path is how SwiftShader measures, so
// it must cross the band and record what a band crossing causes: E steps
// with a node walk on a later frame, relief tile loads, both band edges
// each way, the relief's first program, and the controls' raycasts into
// the relief (H5). Its six settle checkpoints and the held E change are
// the count baseline (§4.3).
test("a frame-stepped path through the band records each event where it must occur", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors = await bootPerf(
    page,
    `${BASE}&relief=1&perf=1&perfStep=1&perfSteps=8&perfSettleS=20&perfPlace=alps`,
  );
  const out = await runToEnd(page, 840_000);
  expect(errors).toEqual([]);

  // The framework's export, with the lab's per-run counts beside it.
  expect(out.schema).toBe("frame-export/1");
  expect(out.runs).toHaveLength(1);
  expect(out.lab).toHaveLength(1);
  for (const key of [
    "userAgent",
    "devicePixelRatio",
    "viewport",
    "drawingBuffer",
    "parallelShaderCompile",
    "floatLinear",
    "timerQuery",
    "longAnimationFrame",
    "hardwareConcurrency",
  ]) {
    expect(out.device).toHaveProperty(key);
  }
  expect(out.device.relief).toBe(1);
  expect(out.device["flag.perf"]).toBe(1);
  expect(out.device["flag.perfStep"]).toBe(1);
  expect(out.device["flag.adjustHeight"]).toBe(1);

  const run = out.lab[0];
  const total = (kind) => run.counts[kind]?.total ?? 0;
  console.log(
    `stepped run, Alps, relief=1, 8 steps a decade: ${run.work.frames} frames; counts ${JSON.stringify(
      Object.fromEntries(
        Object.entries(run.counts).map(([k, c]) => [
          k,
          `${c.total} in ${c.frames} frames (max ${c.maxPerFrame})`,
        ]),
      ),
    )}`,
  );
  console.log(`relief nodes after each E step: ${run.samples["relief.nodes"]}`);
  // The step's own span is CPU work (H1), but on this machine, not a phone:
  // logged for the record, never asserted.
  console.log(
    `E step spans on this machine (ms, not a verdict): ${run.samples["e.step.ms"]}`,
  );
  console.log(`checkpoints: ${JSON.stringify(run.checkpoints)}`);
  console.log(`held E change: ${JSON.stringify(run.eCheck)}`);
  console.log(`peaks: ${JSON.stringify(run.peaks)}`);

  expect(run.voided).toBe(false);
  expect(run.hooks).toBe(true);
  // 5.8 decades at 8 steps each, down and back: at least 90 frames.
  expect(run.work.frames).toBeGreaterThanOrEqual(90);
  expect(total("e.step")).toBeGreaterThan(0);
  // Every E step is followed by a node walk on a later frame.
  expect(total("nodes.walk")).toBeGreaterThan(0);
  expect(run.samples["relief.nodes"].length).toBe(total("nodes.walk"));
  expect(run.samples["relief.nodes"].every((n) => n > 0)).toBe(true);
  expect(total("relief.load")).toBeGreaterThan(0);
  // Into the band and through it, and back out: four edges at least.
  expect(total("band.edge")).toBeGreaterThanOrEqual(4);
  expect(total("band.mixed")).toBeGreaterThan(0);
  // The relief's program is compiled on its first draw in the band (H2).
  expect(total("program.new")).toBeGreaterThanOrEqual(1);
  // The controls' height adjustment raycasts the relief (H5).
  expect(total("raycast")).toBeGreaterThan(0);

  expect(run.checkpoints.map((c) => c.altitudeKm)).toEqual([
    5000, 2000, 1600, 1200, 300, 30,
  ]);
  // The camera's own altitude above the ellipsoid: below 90 degrees of
  // pitch it stands back over ground of another radius (about 4 km lower
  // at the Alps in the band). Within 1 % of the path's; reported at 0.5,
  // 1 and 2 %.
  const offBy = Math.max(
    ...run.checkpoints.map(
      (c) => Math.abs(c.cameraAltitudeKm - c.altitudeKm) / c.altitudeKm,
    ),
  );
  console.log(
    `camera altitude off the path's by at most ${(offBy * 100).toFixed(2)} % (${[0.5, 1, 2].map((k) => `${k} %: ${offBy * 100 <= k ? "ok" : "NO"}`).join(", ")})`,
  );
  expect(offBy).toBeLessThanOrEqual(0.01);
  expect(run.eCheck).not.toBeNull();
  expect(run.eCheck.eTo - run.eCheck.eFrom).toBeCloseTo(0.1, 9);
  expect(run.eCheck.after.e).toBeCloseTo(run.eCheck.eTo, 9);
});

// WHY (§4.1, DEC-PERF-1): the tester reads the summary and copies the
// export on a phone. At 390 x 844 (DPR 2) Run, Copy and Download must be
// on screen, a finger's size, and inside the width; after a short
// time-driven run the summary shows, Copy reaches the clipboard or falls
// back to a selectable box, and Download saves a named .json file.
test("the overlay is usable on a phone, and Copy and Download reach the text", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = await bootPerf(
    page,
    `${BASE}&relief=0&perf=1&perfSpeed=8&perfPlace=ocean`,
  );
  for (const name of ["run", "copy", "download"]) {
    const box = await page.locator(`[data-perf="${name}"]`).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(390);
    expect(box.y + box.height, name).toBeLessThanOrEqual(844);
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await expect(page.locator('[data-perf="plan"]')).toContainText("about");

  const out = await runToEnd(page, 540_000);
  expect(errors).toEqual([]);
  const summary = await page.locator('[data-perf="summary"]').textContent();
  expect(summary).toMatch(/PASS|FAIL/);
  // The framework's summary keeps its lines to 40 characters (phone width).
  for (const line of summary.split("\n")) {
    expect(line.length, line).toBeLessThanOrEqual(40);
  }
  expect(out.runs).toHaveLength(1);
  expect(out.lab[0].cell.decadesPerS).toBe(8);
  // Both readings of a missed vsync (33.3 ms at 60 Hz): over 33 and over 34,
  // over 50 and over 51.
  expect(Object.keys(out.runs[0].over).sort()).toEqual([
    "100",
    "33",
    "34",
    "50",
    "51",
  ]);

  // Copy: the clipboard when it takes the text...
  await page.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t) => {
          window.__copied = t;
        },
      },
    });
  });
  await page.locator('[data-perf="copy"]').click();
  await expect(page.locator('[data-perf="status"]')).toHaveText("Copied.");
  const copied = await page.evaluate(() => window.__copied);
  expect(JSON.parse(copied).schema).toBe("frame-export/1");
  // ...and the selectable box when it refuses.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("refused", "NotAllowedError");
        },
      },
    });
  });
  await page.locator('[data-perf="copy"]').click();
  const box = page.locator('[data-perf="text"]');
  await expect(box).toBeVisible();
  expect(JSON.parse(await box.inputValue()).schema).toBe("frame-export/1");
  const selected = await page.evaluate(() => {
    const t = document.querySelector('[data-perf="text"]');
    return t.selectionEnd - t.selectionStart === t.value.length;
  });
  expect(selected).toBe(true);

  // Download: a named .json file with the same export.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-perf="download"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^globe-perf-run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/,
  );
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  expect(JSON.parse(readFileSync(path, "utf8")).schema).toBe("frame-export/1");
  await context.close();
});

// WHY (§4.1, its own cost): the overhead sweep runs the hooks off and on,
// alternating; a run with the hooks off records frame intervals and no
// events, and the export carries the verdict (the on-off difference
// against the off runs' spread). The verdict itself is a time, so it is
// logged here, not asserted: it is decided on a real phone.
test("the overhead sweep runs the recorder's hooks off and on", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors = await bootPerf(
    page,
    `${BASE}&relief=1&perf=1&perfSweep=overhead&perfSpeed=8`,
  );
  const out = await runToEnd(page, 840_000);
  expect(errors).toEqual([]);
  expect(out.lab.map((r) => r.hooks)).toEqual([
    false,
    true,
    false,
    true,
    false,
    true,
  ]);
  for (const r of out.lab) {
    expect(r.work.frames, r.label).toBeGreaterThan(0);
    if (!r.hooks) expect(r.counts, r.label).toEqual({});
    else expect(Object.keys(r.counts).length, r.label).toBeGreaterThan(0);
  }
  const perFrame = (hooks) => {
    const rs = out.lab.filter((r) => r.hooks === hooks);
    return (
      rs.reduce((s, r) => s + r.work.insideMs, 0) /
      rs.reduce((s, r) => s + r.work.frames, 0)
    );
  };
  console.log(
    `overhead under SwiftShader (relative only): inside-frame time on/off ${(perFrame(true) / perFrame(false)).toFixed(2)}; verdict ${JSON.stringify(out.overhead)}`,
  );
  expect(out.overhead).not.toBeNull();
  expect(Object.keys(out.overhead.passAt).sort()).toEqual(["0.5", "1", "2"]);
});

// WHY (§4.2, H5): a pinch or a wheel zooms through the controls, which
// raycast for the point under the pointer on every zoom frame. The
// controls-driven mode feeds their wheel input on the same altitude law,
// so a run in it must actually fly the path (reach the bottom) and count
// the controls' raycasts into the relief.
test("a zoom driven through the controls flies the path and counts their raycasts", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await bootPerf(
    page,
    `${BASE}&relief=1&perf=1&perfDrive=controls&perfSpeed=1&perfPlace=alps`,
  );
  const out = await runToEnd(page, 540_000);
  expect(errors).toEqual([]);
  const run = out.lab[0];
  expect(run.cell.drive).toBe("controls");
  expect(run.label).toContain("controls");
  // The bottom is 30 km; the controls close on it frame by frame, so the
  // lowest altitude reached is reported against 30 km at x2, x1.5 and x1.1.
  const ratio = run.peaks.lowestKm / 30;
  console.log(
    `controls-driven run: ${run.work.frames} frames, lowest ${run.peaks.lowestKm} km (${[1.1, 1.5, 2].map((k) => `x${k}: ${ratio <= k ? "ok" : "NO"}`).join(", ")}), raycasts ${run.counts.raycast?.total ?? 0} in ${run.counts.raycast?.frames ?? 0} frames`,
  );
  expect(ratio).toBeLessThanOrEqual(1.5);
  expect(run.counts.raycast?.total ?? 0).toBeGreaterThan(0);
});
