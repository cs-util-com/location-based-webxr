// @ts-check
/**
 * The GPU trainer of the splat trainer page in a real browser.
 *
 * Why it matters: the unit tests drive the trainer with a fake worker and
 * a fake Splat.js. Only a browser shows that the worker starts from its
 * `blob:` shim, that the pinned Splat.js address is the only host the
 * trainer reaches, and that the request names no page (no Referer). The
 * first test does this with a stand-in for Splat.js and runs everywhere.
 *
 * The second test is the local acceptance run (`SPLAT_GPU=1`, real Chrome
 * on a real graphics card, the real Splat.js from the CDN): it trains one
 * stretch of the rendered synthetic walk and measures how sharp the splat
 * is at its own cameras and how close its splats sit to the scene's
 * surfaces after the shell crop. It never runs in CI (no graphics card).
 */
import { chromium, expect, test } from "@playwright/test";

// Every file of the one pinned Splat.js commit: its entry imports its own
// sibling modules from there.
const PINNED =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/arrival-space\/splat\.js@[0-9a-f]{40}\//;

/**
 * Routes every request to another host: the pinned Splat.js address goes
 * to `onPinned`, everything else is refused and recorded. Routed on the
 * page and on its context, so the worker's requests are caught too. A
 * Referer that names another pinned file (one Splat.js module importing
 * its sibling) names no page and is allowed; any other is recorded.
 * @param {import("@playwright/test").Page} page
 * @param {(route: import("@playwright/test").Route) => Promise<void>} onPinned
 */
async function routeHosts(page, onPinned) {
  /** @type {{ refused: string[], headers: Record<string, string>[], pageReferers: string[] }} */
  const seen = { refused: [], headers: [], pageReferers: [] };
  /** @param {import("@playwright/test").Route} route */
  const handle = async (route) => {
    const req = route.request();
    if (!PINNED.test(req.url())) {
      seen.refused.push(req.url());
      return route.abort();
    }
    const headers = await req.allHeaders();
    seen.headers.push(headers);
    const referer = headers["referer"];
    if (referer !== undefined && !PINNED.test(referer)) {
      seen.pageReferers.push(referer);
    }
    return onPinned(route);
  };
  const other = (/** @type {URL} */ url) =>
    !["localhost", "127.0.0.1"].includes(url.hostname);
  await page.route(other, handle);
  await page.context().route(other, handle);
  return seen;
}

/**
 * Builds a rendered walk through the synthetic scene in the page (the dev
 * server serves the scene modules) and returns nothing; the zip is left
 * on `window.__walk`.
 * @param {import("@playwright/test").Page} page
 * @param {{ frames: number, width: number, height: number }} opts
 */
async function buildRenderedWalk(page, opts) {
  await page.evaluate(async ({ frames, width, height }) => {
    const scene = await import(
      /* @vite-ignore */ "/src/checks/splat-scene/splat-scene.ts"
    );
    const render = await import(
      /* @vite-ignore */ "/src/checks/splat-scene/splat-scene-render.ts"
    );
    const zip = await import(
      /* @vite-ignore */ "/src/checks/splat-scene/splat-scene-zip.ts"
    );
    // The recorder's reconstruction depth grid (the framework's
    // DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE), as the scene check uses.
    const grid = 24;
    const projection = scene.sceneProjection(width, height);
    const poses = scene.sceneWalk("straight", frames);
    const photos = await render.renderSceneFrames(
      poses,
      width,
      height,
      projection,
    );
    const file = await zip.zipSceneWalk(
      poses.map((/** @type {any} */ pose, /** @type {number} */ i) => ({
        jpeg: photos[i],
        depth: scene.sceneDepthSample(
          pose,
          projection,
          grid,
          1_700_000_000_000 + i * 500,
        ),
      })),
      width,
      height,
      "synthetic-straight-walk.zip",
    );
    /** @type {any} */ (window).__walk = file;
  }, opts);
}

/**
 * A stand-in for Splat.js: every stretch finishes at once, sharp enough
 * to be good, with an empty splat file.
 */
const SPLAT_JS_STUB = `
export const TRAIN_MAX_DIM = 1600;
export function parseCameras(j) { return j.cameras; }
export function createSession(opts) {
  const on = { event: [], metrics: [] };
  const s = {
    trainer: null,
    on(type, fn) { on[type].push(fn); },
    async load() {},
    useKnownCameras(cams) {
      s.trainer = { iter: 0, camMeta: cams, excluded: new Set() };
    },
    async seed() {},
    start() {
      setTimeout(() => {
        for (const f of on.metrics) f({ iter: opts.maxIters });
        for (const f of on.event) f({ kind: "train-complete" });
      }, 10);
    },
    pause() {},
    async evalFramePsnr() { return 31; },
    async evalTestPsnr() { return { psnr: 22 }; },
    async exportPlyBlob() {
      return new Blob([
        "ply\\nformat binary_little_endian 1.0\\nelement vertex 0\\n" +
          "property float x\\nproperty float y\\nproperty float z\\n" +
          "property float opacity\\nend_header\\n",
      ]);
    },
    dispose() {},
  };
  return s;
}
`;

test("the GPU trainer loads Splat.js from its pinned address, sending no Referer", async ({
  page,
}) => {
  test.skip(process.env.SPLAT_GPU === "1", "the acceptance run replaces it");
  const seen = await routeHosts(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: SPLAT_JS_STUB,
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ info: { vendor: "nvidia" } }) },
    });
  });
  await page.goto("/splat/?trainer=gpu");
  await expect(page.getByText("Practice run")).toBeHidden();
  await buildRenderedWalk(page, { frames: 40, width: 320, height: 240 });
  await page.evaluate(() => {
    const input = /** @type {HTMLInputElement} */ (
      document.querySelector('[data-ref="fileInput"]')
    );
    const dt = new DataTransfer();
    dt.items.add(/** @type {any} */ (window).__walk);
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await page.getByRole("button", { name: "Make the splat" }).click();
  await expect(page.locator(".print").first()).toHaveAttribute(
    "data-verdict",
    "good",
  );

  expect(seen.headers.length).toBeGreaterThan(0);
  for (const headers of seen.headers) {
    // The headers are the real request's: a module import is a CORS
    // request and names its origin, but never the page.
    expect(headers["origin"]).toBe(new URL(page.url()).origin);
    expect(headers["referer"]).toBeUndefined();
  }
  expect(seen.refused).toEqual([]);
});

test.describe("local GPU acceptance", () => {
  test.skip(process.env.SPLAT_GPU !== "1", "needs SPLAT_GPU=1 and a GPU");
  test("one stretch of the rendered walk trains sharp and stays on the scene", async ({
    baseURL,
  }) => {
    test.setTimeout(45 * 60_000);
    // Real Chrome, shown: a headless browser may not reach the card.
    const browser = await chromium.launch({
      channel: "chrome",
      headless: false,
    });
    const page = await (await browser.newContext({ baseURL })).newPage();
    const seen = await routeHosts(page, (route) => route.continue());
    await page.goto("/splat/?trainer=gpu");
    await buildRenderedWalk(page, { frames: 60, width: 640, height: 480 });
    const r = await page.evaluate(async () => {
      const reader = await import(
        /* @vite-ignore */ "/src/splat-trainer/recording-reader.ts"
      );
      const plan = await import(
        /* @vite-ignore */ "/src/splat-trainer/window-plan.ts"
      );
      const gpu = await import(
        /* @vite-ignore */ "/src/splat-trainer/gpu-trainer.ts"
      );
      const spawn = await import(
        /* @vite-ignore */ "/src/splat-trainer/trainer-worker-spawn.ts"
      );
      const plyMod = await import(
        /* @vite-ignore */ "/src/splat-trainer/ply-crop.ts"
      );
      const scene = await import(
        /* @vite-ignore */ "/src/checks/splat-scene/splat-scene.ts"
      );
      const file = /** @type {any} */ (window).__walk;
      const read = await reader.readSplatInputs(file);
      if (read.kind !== "read") return { refused: read.reason };
      const planned = plan.windowPlanner()(read.inputs);
      const trainer = gpu.createGpuTrainer({
        gpu: /** @type {any} */ (navigator).gpu,
        readPhotos: reader.readRecordingPhotos,
        spawn: spawn.spawnTrainerWorker,
        timer: {
          now: () => performance.now(),
          set: (/** @type {() => void} */ fn, /** @type {number} */ ms) =>
            setTimeout(fn, ms),
          clear: (/** @type {any} */ id) => clearTimeout(id),
        },
      });
      const probe = await trainer.probe();
      const first = planned[0];
      const result = await trainer.trainWindow(
        {
          window: first,
          attempt: 1,
          timeScale: 1,
          inputs: read.inputs,
          recording: file,
        },
        { onProgress: () => {}, onPreview: () => {} },
        new AbortController().signal,
      );
      /** @type {{ d: number, w: number }[]} */
      const pts = [];
      if (result.ply !== null) {
        const view = plyMod.readPly(await result.ply.arrayBuffer());
        for (let i = 0; i < view.count; i++) {
          pts.push({
            d: scene.distanceToScene(view.positions[i]),
            w: view.opacities[i],
          });
        }
      }
      pts.sort((a, b) => a.d - b.d);
      const total = pts.reduce((s, p) => s + p.w, 0);
      let acc = 0;
      let p90 = Number.NaN;
      for (const p of pts) {
        acc += p.w;
        if (acc >= 0.9 * total) {
          p90 = p.d;
          break;
        }
      }
      return {
        probe: probe.kind,
        windows: planned.length,
        trainPhotos: first.window.train.length,
        heldOut: first.window.holdouts.length,
        outcome: result.outcome,
        metrics: result.metrics,
        trainingS: result.trainingS,
        splats: pts.length,
        p90,
      };
    });
    await browser.close();
    console.log(`SPLAT-GPU ${JSON.stringify(r)}`);
    if ("refused" in r) throw new Error(`refused: ${r.refused}`);
    for (const db of [28, 30, 33]) {
      console.log(
        `SPLAT-GPU at-camera >= ${db} dB: ${(r.metrics?.atCameraDb ?? 0) >= db}`,
      );
    }
    for (const m of [0.05, 0.1, 0.2]) {
      console.log(`SPLAT-GPU p90 <= ${m} m: ${r.p90 <= m}`);
    }
    expect(seen.headers.length).toBeGreaterThan(0);
    expect(seen.pageReferers).toEqual([]);
    expect(seen.refused).toEqual([]);
    expect(r.probe).not.toBe("no-webgpu");
    expect(r.outcome).toBe("finished");
    expect(r.metrics?.atCameraDb ?? 0).toBeGreaterThanOrEqual(30);
    expect(r.p90).toBeLessThanOrEqual(0.1);
  });
});
