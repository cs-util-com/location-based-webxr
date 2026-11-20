// @ts-check
import { expect, test } from "@playwright/test";

/** The pinned sift.js URL the page imports (kept in step with method-sift.ts). */
const SIFT_URL =
  "https://cdn.jsdelivr.net/gh/arrival-space/splat.js@a84620c05f210a304b2d8de1d5c9f19d3657126f/src/sfm/sift.js";

/**
 * A stand-in for sift.js: 40 keypoints on a grid, keypoint i with a
 * descriptor that is only byte i % 128 set, so each one matches itself.
 */
const SIFT_STUB = `
export function detectSift(gray, w, h, maxFeats) {
  const n = Math.min(40, maxFeats);
  const x = new Float32Array(n), y = new Float32Array(n);
  const desc = new Uint8Array(n * 128);
  for (let i = 0; i < n; i++) {
    x[i] = ((i % 8) + 0.5) * w / 8;
    y[i] = (Math.floor(i / 8) + 0.5) * h / 5;
    desc[i * 128 + (i % 128)] = 200 + (i % 50);
  }
  return { n, x, y, scale: new Float32Array(n), angle: new Float32Array(n), desc };
}
`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {(route: import("@playwright/test").Route) => Promise<void>} sift
 */
async function routeNetwork(page, sift) {
  // Nothing leaves the machine: every other host is refused.
  await page.route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.route(SIFT_URL, sift);
}

/** @param {import("@playwright/test").Page} page */
async function chooseSiftOnly(page) {
  await page.locator("#m-xfeat").uncheck();
  await page.locator("#m-aliked").uncheck();
  await page.locator('input[name="size"][value="480"]').uncheck();
  await page.locator('input[name="size"][value="640"]').uncheck();
  await page.locator("#runs").fill("1");
}

/**
 * Why this test matters: the benchmark page is opened on a phone from a
 * branch preview and is linked from nothing, so no other test opens it.
 * With sift.js replaced by a stub (no network), it proves the page loads,
 * fits a phone's width, runs the synthetic pair through the whole loop,
 * fills the table and the copyable report, and that its Run button shows
 * its running and final states. The real methods and their timings need
 * the phone and are not tested here.
 */
test("the feature matching benchmark runs a stubbed SIFT on the synthetic pair", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: SIFT_STUB,
    }),
  );
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/feature-match-check.html");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);

  await page.locator("#run").click();
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.locator("#run")).toHaveText("Run benchmark");

  const row = page.locator("#results tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("SIFT (plain JS)");
  await expect(row).toContainText("320x240");
  const report = await page.locator("#report").inputValue();
  expect(report).toContain("Feature matching benchmark");
  expect(report).toContain("## SIFT (plain JS)");
  expect(report).toMatch(
    /@320 \(320x240\): extract .* \| kp 40 \| .* \| matches 40/,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: a model or code file that fails to load must be
 * one log line and a table row, with the Run button back to normal, never
 * a blank page or a button stuck at "Running...".
 */
test("the feature matching benchmark reports a method that fails to load", async ({
  page,
}) => {
  await routeNetwork(page, (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/feature-match-check.html");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);

  await page.locator("#run").click();
  await expect(page.locator("#run-state")).toHaveText(
    "done: 1 methods, 1 with errors (see log)",
  );
  await expect(page.locator("#log")).toContainText(
    "ERROR SIFT (plain JS): init:",
  );
  await expect(page.locator("#results tbody tr")).toContainText("init:");
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.locator("#run")).toHaveText("Run benchmark");
});

/**
 * A stand-in camera: a 320x240 canvas stream, left half black and right
 * half white, so the captured frames' grey values are known.
 *
 * @param {import("@playwright/test").Page} page
 */
async function fakeCamera(page) {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = /** @type {CanvasRenderingContext2D} */ (
      canvas.getContext("2d")
    );
    const paint = () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 160, 240);
      ctx.fillStyle = "#fff";
      ctx.fillRect(160, 0, 160, 240);
      requestAnimationFrame(paint);
    };
    paint();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve(canvas.captureStream(30)),
      },
    });
  });
}

/**
 * The chunk types of a PNG file (a test-side copy of the page's walk, so
 * the check does not trust the code it checks).
 *
 * @param {Buffer} bytes
 */
function chunkTypes(bytes) {
  const types = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    types.push(bytes.toString("latin1", at + 4, at + 8));
    at += 12 + bytes.readUInt32BE(at);
  }
  return types;
}

/**
 * Why this test matters: real camera frames are handed over in a chat to
 * explain a phone's numbers, so the page must log each frame's grey values
 * (a dark or flat frame explains a low keypoint count) and save exactly the
 * captured pixels as files that carry nothing but pixels: no EXIF, text or
 * time chunk, and a JSON without time or place. Nothing is uploaded: every
 * request leaving the machine is refused.
 */
test("the feature matching benchmark saves the captured camera frames", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: SIFT_STUB,
    }),
  );
  await fakeCamera(page);
  await page.goto("/feature-match-check.html");
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#save-frames")).toBeDisabled();

  await page.locator('input[name="input"][value="camera"]').check();
  await page.locator("#capture-a").click();
  await page.locator("#capture-b").click();
  await expect(page.locator("#capture-state")).toHaveText("A: ready, B: ready");
  await expect(page.locator("#log")).toContainText(
    /captured A 320x240 \(camera 320x240\), grey mean \d+\.\d sd \d+\.\d \(0-255\)/,
  );

  await chooseSiftOnly(page);
  await page.locator("#run").click();
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  expect(await page.locator("#report").inputValue()).toMatch(
    /input: camera A 320x240, grey mean [\d.]+ sd [\d.]+ \(0-255\); B 320x240, grey mean/,
  );

  await page.locator("#save-frames").click();
  await expect(page.locator("#save-state")).toHaveText(
    "3 files ready: tap each to save",
  );
  const links = page.locator("#save-links a");
  await expect(links).toHaveCount(3);

  for (const name of [
    "feature-match-frame-a.png",
    "feature-match-frame-b.png",
  ]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(`#save-links a[download="${name}"]`).click(),
    ]);
    expect(download.suggestedFilename()).toBe(name);
    const bytes = await readDownload(download);
    const types = chunkTypes(bytes);
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    expect(
      types.filter(
        (t) =>
          !["IHDR", "sRGB", "gAMA", "cHRM", "iCCP", "IDAT", "IEND"].includes(t),
      ),
    ).toEqual([]);
    // IHDR: the captured size, unchanged.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      320, 240,
    ]);
  }

  const [json] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#save-links a[download="feature-match-frames.json"]').click(),
  ]);
  const info = JSON.parse((await readDownload(json)).toString("utf8"));
  expect(Object.keys(info).sort()).toEqual([
    "captureMaxLongEdge",
    "device",
    "format",
    "frames",
  ]);
  expect(
    info.frames.map((/** @type {{ width: number }} */ f) => f.width),
  ).toEqual([320, 320]);
  expect(errors).toEqual([]);
});

/** @param {import("@playwright/test").Download} download */
async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) {
    chunks.push(/** @type {Buffer} */ (c));
  }
  return Buffer.concat(chunks);
}
