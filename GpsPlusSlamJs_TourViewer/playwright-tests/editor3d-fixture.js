// @ts-check
import { expect } from "@playwright/test";

import {
  encodeRgbPng,
  terrariumPng,
} from "../../scripts/e2e/terrarium-png.mjs";
import { startOnMap } from "./editor-menus.js";

/** A 1x1 grey PNG: a map tile the page can decode. Encoded here, not
 *  pasted: a hand-copied one carried a broken checksum, so the browser
 *  refused every map tile the tests answered. */
const MAP_TILE = encodeRgbPng(1, 1, [128, 128, 128]);

/** The sample square's ground over sea level (m): Mapterhorn there, to
 *  within a metre. A flat relief at it puts the sample's stations on the
 *  ground, and a camera above it, as on the real hosts. */
export const SQUARE_GROUND_M = 515.5;

/**
 * Answer the relief's host with a flat ground at the square's height (512 px
 * Terrarium tiles, as Mapterhorn serves them) and the map's with a plain
 * tile; refuse the globe's whole-Earth imagery, counting any ask (or,
 * with `globeAssets: "serve"`, let the dev server answer it, still
 * counted: the editor on the globe view draws it).
 * @param {import("@playwright/test").Page} page
 * @param {{ globeAssets?: "refuse" | "serve" }} [options]
 */
export async function answerHosts(page, { globeAssets = "refuse" } = {}) {
  const flat = terrariumPng(512, 512, () => SQUARE_GROUND_M);
  await page.route("https://tiles.mapterhorn.com/**", (route) => {
    if (!/\/\d+\/\d+\/\d+\.webp/.test(route.request().url())) {
      return route.abort();
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: flat,
    });
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: MAP_TILE }),
  );
  const imagery = { asks: 0 };
  await page.route("**/globe-assets/**", (route) => {
    imagery.asks++;
    return globeAssets === "serve" ? route.continue() : route.abort();
  });
  return imagery;
}

/**
 * Keep every promise the page leaves rejected, from before its first
 * script runs. The map's and the relief's tiles are decoded inside the
 * tiles library, off the page's own code: a tile that cannot be decoded
 * shows nowhere but here. Read the list with `rejections(page)`.
 * @param {import("@playwright/test").Page} page
 */
export async function keepRejections(page) {
  await page.addInitScript(() => {
    const seen = /** @type {string[]} */ ([]);
    /** @type {any} */ (window).__rejections = seen;
    addEventListener("unhandledrejection", (event) => {
      seen.push(String(event.reason?.message ?? event.reason));
    });
  });
}

/**
 * The rejections `keepRejections` kept so far.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export function rejections(page) {
  return page.evaluate(() => /** @type {any} */ (window).__rejections ?? []);
}

/**
 * The 3D view's stats from the page's test hook, or null while it does
 * not show.
 * @param {import("@playwright/test").Page} page
 */
export function view3d(page) {
  return page.evaluate(() => {
    const hook = /** @type {any} */ (window).__tourEditor;
    return hook.view3d();
  });
}

/**
 * The ceiling on waiting for frames (ms). It is not what a test measures:
 * the view draws every frame, and a check counts frames, not time. A
 * software-drawn view at a desktop size draws only 4 to 8 frames a second
 * (measured 2026-10-23: about 7 locally, about 5 on the CI runner, about 4.5
 * under a 6x CPU throttle), so 30 frames take 4 to 7 s, past a poll's 5 s
 * default - which failed a check on the CI runner while the view drew on.
 * This bounds only a view that stopped drawing: 30 frames in it is 0.5 a
 * second.
 */
const FRAMES_WAIT_MS = 60_000;

/**
 * Wait until the 3D view has drawn more than `n` frames past now.
 * @param {import("@playwright/test").Page} page
 * @param {number} n
 */
export async function afterFrames(page, n) {
  /** @param {any} stats */
  const framesOf = (stats) => /** @type {number} */ (stats?.frames ?? 0);
  const from = framesOf(await view3d(page));
  await expect
    .poll(async () => framesOf(await view3d(page)), {
      timeout: FRAMES_WAIT_MS,
    })
    .toBeGreaterThan(from + n);
}

/**
 * The frames the relief may take to carry the ground on the globe. Its
 * hand-over waits for every relief tile in view to be parsed, about one a
 * frame, so it is bound by frames, not time: measured 2026-11-03 on the
 * sample tour at street level, 150 to 172 frames at 1x to 6x CPU slowdown,
 * which took 57 s to 75 s at the software renderer's 2 to 3 frames a
 * second; again with the street map's hold on (the relief keeping a
 * mapped tile until its children have their map), 102 to 132 frames over
 * eleven hand-overs of the globe, hold, gain and clouds specs: the hold
 * adds none. This allows about 2.3 times the most measured, and three
 * times the most with the hold.
 */
const RELIEF_HANDOVER_FRAMES = 400;

/**
 * How long the relief may make no progress (no frame drawn, no tile
 * queued, downloaded, parsed or loaded) before the wait calls it stalled
 * (ms).
 */
const RELIEF_STALL_MS = 60_000;

/**
 * Wait until the relief carries the ground on the globe view. Fails when
 * the relief takes more than `RELIEF_HANDOVER_FRAMES` frames, or when it
 * stalls for `RELIEF_STALL_MS`, naming its readout (`globe.relief`) - not
 * after a fixed time, which a slow runner's frame rate alone overruns.
 * The caller's test timeout must leave room for the frames at its runner's
 * frame rate (400 frames at 2 a second is 200 s).
 * @param {import("@playwright/test").Page} page
 */
export async function reliefCarries(page) {
  /** @param {any} stats */
  const signature = (stats) => {
    const r = stats?.globe?.relief;
    return JSON.stringify([
      stats?.frames,
      r?.loadProgress,
      r?.queued,
      r?.downloading,
      r?.parsing,
      r?.loaded,
    ]);
  };
  const first = await view3d(page);
  const fromFrames = first?.frames ?? 0;
  let last = signature(first);
  let lastChangeAt = Date.now();
  /** @type {any} */
  let seen = first;
  await expect
    .poll(
      async () => {
        const stats = await view3d(page);
        seen = stats;
        if (stats?.globe?.carrier === "relief") return "relief";
        const now = Date.now();
        const sig = signature(stats);
        if (sig !== last) {
          last = sig;
          lastChangeAt = now;
        }
        if ((stats?.frames ?? 0) - fromFrames > RELIEF_HANDOVER_FRAMES) {
          return "over its frames";
        }
        if (now - lastChangeAt > RELIEF_STALL_MS) return "stalled";
        return "waiting";
      },
      { timeout: 20 * 60_000, intervals: [2_000] },
    )
    .not.toBe("waiting");
  expect(
    seen?.globe?.carrier,
    `the relief did not take over; frames ${String((seen?.frames ?? 0) - fromFrames)}, relief ${JSON.stringify(seen?.globe?.relief)}`,
  ).toBe("relief");
  // The hand-over's frames, read from the run's log to re-measure
  // `RELIEF_HANDOVER_FRAMES`.
  console.log(
    `relief hand-over: ${String((seen?.frames ?? 0) - fromFrames)} frames`,
  );
}

/**
 * The editor page with the sample tour open on the 2D map (not in the 3D
 * view, the default: `openSampleIn3d`), for a spec that edits on the map
 * first or drives the view switch itself.
 * @param {import("@playwright/test").Page} page
 * @param {string} [link] the page to open: the older view by default
 */
export async function openSample(page, link = OLDER_VIEW) {
  await startOnMap(page.context());
  await page.goto(link);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  // No tour, nothing to show in 3D: the switch waits for one.
  await expect(page.locator("#view-switch")).toBeDisabled();
  await page.locator("#sample-btn").click();
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
}

/** The editor's link to the older 3D view (`?globe=0`), and its plain link
 * (the globe), for the tests that hold both. */
export const OLDER_VIEW = "/edit.html?globe=0";
export const GLOBE_VIEW = "/edit.html";

/**
 * The editor page with the sample tour open, as a creator gets it: in the
 * 3D view, its three stations placed.
 * @param {import("@playwright/test").Page} page
 */
export async function openSampleIn3d(page) {
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(page.locator("#view-switch")).toHaveText("2D map");
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
}

/**
 * Open `zip` through the page's file input, as a dropped file.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} zip
 * @param {string} name
 */
export async function openZip(page, zip, name) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/zip", buffer: zip });
}

/**
 * Open the next tours straight at street level on the globe view, without
 * the approach from high above: for a spec about the view itself, whose
 * camera must be where the tour opens from its first frame.
 * @param {import("@playwright/test").Page} page
 */
export async function noApproach(page) {
  await page.addInitScript(() => {
    /** @type {any} */ (window).__tourEditorApproach = { off: true };
  });
}

/**
 * Start with View > Clouds unticked, so every globe open draws without the
 * heavy clouds from its first frame. Measured in this software renderer
 * (2026-11-03): with them the globe draws about 1.4 frames a second and one
 * click takes 9-10 s (a CI runner, slower still, ran clicks past their
 * tests' budgets); without them about 6 frames a second and 1.8 s. For a
 * spec that is not about the clouds. Call it before the page loads.
 * @param {import("@playwright/test").Page} page
 */
export async function noClouds(page) {
  await page.addInitScript(() => {
    /** @type {any} */ (window).__tourEditorClouds = { off: true };
  });
}
