// @ts-check
import { expect, test } from "@playwright/test";

import {
  forceTrackingReady,
  installTourViewerArFakes,
  lockFixtureCode,
  reportArTracking,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * Frame times with many story blocks standing in the world - a measurement,
 * not a gate. OPT-IN: it runs only with `FRAME_TIME=1` and is skipped in
 * the default e2e run (its three tours cost minutes, and a frame time on a
 * shared machine is no pass/fail signal).
 *
 *   FRAME_TIME=1 pnpm run test:e2e playwright-tests/story-blocks-frame-time.spec.js
 *
 * Each reached story block is its own part in the station's frame (one
 * group, one label or plane per block), so the cost grows with the blocks a
 * story reached. The spec reaches 5, 20 and 50 blocks (pins and pictures
 * alternating, `archive-server.mjs` `/ranges-ok/story-count-<n>.zip`),
 * then renders the station's real content with a real WebGLRenderer while
 * the camera orbits it, at a phone's viewport (390 x 844 CSS px at device
 * pixel ratio 2), and again under a 4x CPU throttle. The AR fakes draw
 * nothing themselves, so the renderer here is the measurement's own; the
 * content it draws is exactly what the app built.
 *
 * What it does NOT measure: a phone. The GPU is the desktop's (the renderer
 * string is printed with the table; under SwiftShader it is the CPU), the
 * frame pacing is the desktop browser's, and the AR camera feed and the
 * rest of the app's frame loop are absent. Read the numbers as a relative
 * cost per block, not as a phone's frame time.
 */

const RUN = process.env.FRAME_TIME === "1";
const COUNTS = [5, 20, 50];
const THROTTLES = [1, 4];
/** Rendered frames per measurement, after a warm-up. */
const FRAMES = 240;
const WARMUP = 30;

test.skip(!RUN, "opt-in measurement: set FRAME_TIME=1");
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  // The desktop's GPU where the browser can reach it (headless otherwise
  // falls back to SwiftShader, which the printed renderer string shows).
  launchOptions: {
    args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=default"],
  },
});
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Open the tour as a visitor, start AR aligned, and find the gate. */
async function atTheGate(page, archive) {
  await page.goto(`/?qr=${encodeURIComponent(archive)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await reportArTracking(page, true);
  await forceTrackingReady(page);
}

/** How many story blocks stand under the gate's content now. */
function standing(page) {
  return page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.emitFrames(1);
    /** @param {any} o @returns {string[]} */
    const ids = (o) => [
      ...(typeof o.userData?.objectId === "string"
        ? [o.userData.objectId]
        : []),
      ...(o.children ?? []).flatMap(ids),
    ];
    const root = t.fakeScene.children.find(
      (/** @type {any} */ c) => c.name === "station-content:gate",
    );
    return root === undefined
      ? 0
      : new Set(ids(root).filter((id) => id.startsWith("many-"))).size;
  });
}

/** Render the gate's content with an orbiting camera; frame statistics. */
function orbit(page, frames, warmup) {
  return page.evaluate(
    async ({ frames, warmup, urls }) => {
      // three as the dev server resolves the app's own bare import (URLs
      // of the page's server, not module specifiers of this file).
      const THREE = await import(/* @vite-ignore */ urls[0]).catch(
        () => import(/* @vite-ignore */ urls[1]),
      );
      const t = /** @type {any} */ (window).__tourViewerTest;
      const content = t.fakeScene.children.find(
        (/** @type {any} */ c) => c.name === "station-content:gate",
      );
      const canvas = document.createElement("canvas");
      canvas.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;z-index:99999";
      document.body.append(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      const gl = renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const gpu = info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "unknown";
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1));
      // The app's content, as built - a copy, so the app's own tree stays.
      scene.add(content.clone(true));
      const center = new THREE.Box3()
        .setFromObject(scene)
        .getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.05,
        500,
      );
      /** @type {number[]} */
      const intervals = [];
      /** @type {number[]} */
      const renders = [];
      let last = 0;
      await new Promise((done) => {
        let n = 0;
        const step = (/** @type {number} */ now) => {
          const angle = (n / 120) * 2 * Math.PI;
          camera.position.set(
            center.x + 7 * Math.cos(angle),
            center.y + 1.6,
            center.z + 7 * Math.sin(angle),
          );
          camera.lookAt(center);
          const before = performance.now();
          renderer.render(scene, camera);
          const after = performance.now();
          if (n >= warmup) {
            renders.push(after - before);
            intervals.push(now - last);
          }
          last = now;
          n += 1;
          if (n < warmup + frames) requestAnimationFrame(step);
          else done(undefined);
        };
        requestAnimationFrame(step);
      });
      const drawCalls = renderer.info.render.calls;
      renderer.dispose();
      canvas.remove();
      /** @param {number[]} xs @param {number} q */
      const quantile = (xs, q) => {
        const sorted = [...xs].sort((a, b) => a - b);
        return sorted[
          Math.min(sorted.length - 1, Math.floor(q * sorted.length))
        ];
      };
      return {
        gpu,
        drawCalls,
        intervalMedianMs: quantile(intervals, 0.5),
        intervalP95Ms: quantile(intervals, 0.95),
        intervalMaxMs: Math.max(...intervals),
        renderMedianMs: quantile(renders, 0.5),
        renderP95Ms: quantile(renders, 0.95),
      };
    },
    {
      frames,
      warmup,
      urls: ["/@id/three", "/node_modules/three/build/three.module.js"],
    },
  );
}

/** @type {Record<string, unknown>[]} */
const rows = [];

for (const count of COUNTS) {
  test(`frame times with ${String(count)} story blocks standing`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await atTheGate(
      page,
      `http://127.0.0.1:5197/ranges-ok/story-count-${String(count)}.zip`,
    );
    await expect(page.getByTestId("scene-panel")).toBeVisible();
    // One step per block: reach every one of them.
    for (let i = 1; i < count; i += 1) {
      await page.getByTestId("scene-continue").click();
    }
    await expect.poll(() => standing(page), { timeout: 60_000 }).toBe(count);
    const cdp = await page.context().newCDPSession(page);
    for (const rate of THROTTLES) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const stats = await orbit(page, FRAMES, WARMUP);
      rows.push({ blocks: count, cpuThrottle: rate, ...stats });
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
}

test.afterAll(async () => {
  if (rows.length === 0) return;
  const round = (/** @type {unknown} */ v) =>
    typeof v === "number" ? Math.round(v * 100) / 100 : v;
  console.log(`FRAME-TIME gpu: ${String(rows[0]?.["gpu"])}`);
  console.table(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => k !== "gpu")
          .map(([k, v]) => [k, round(v)]),
      ),
    ),
  );
  console.log(`FRAME-TIME-JSON ${JSON.stringify(rows)}`);
});
