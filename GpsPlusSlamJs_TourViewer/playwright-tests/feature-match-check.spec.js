// @ts-check
import { expect, test } from "@playwright/test";
import {
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

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

/** @param {import("@playwright/test").Route} route */
const fulfillSift = (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: SIFT_STUB,
  });

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

/**
 * Everything is ticked by default; the tests untick all but SIFT at one
 * size and one run, which is what the options are for.
 *
 * @param {import("@playwright/test").Page} page
 */
async function chooseSiftOnly(page) {
  await page.locator("#options summary").click();
  for (const box of [
    "#m-xfeat",
    "#m-aliked",
    'input[name="size"][value="480"]',
    'input[name="size"][value="640"]',
  ]) {
    await expect(page.locator(box)).toBeChecked();
    await page.locator(box).uncheck();
  }
  await page.locator("#runs").fill("1");
}

/**
 * A stand-in camera: a 320x240 canvas stream, left half black and right
 * half white, so the captured frames' grey values are known (mean and
 * standard deviation both 127.5). `mode` "reject" refuses the camera,
 * "hold" keeps the start pending until `window.__releaseCamera()`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {"ok" | "reject" | "hold"} [mode]
 */
async function fakeCamera(page, mode = "ok") {
  await page.addInitScript((m) => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = /** @type {CanvasRenderingContext2D} */ (
      canvas.getContext("2d")
    );
    const paint = () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 160, 240);
      // `window.__dim = true` dims the white half, as a dimmed lamp would.
      ctx.fillStyle = w.__dim ? "#404040" : "#fff";
      ctx.fillRect(160, 0, 160, 240);
      requestAnimationFrame(paint);
    };
    paint();
    const open = () => {
      const s = canvas.captureStream(30);
      w.__lastStream = s;
      return s;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          if (m === "reject") {
            return Promise.reject(
              new DOMException("Permission denied", "NotAllowedError"),
            );
          }
          if (m === "hold") {
            return new Promise((resolve) => {
              w.__releaseCamera = () => resolve(open());
            });
          }
          return Promise.resolve(open());
        },
      },
    });
  }, mode);
}

/**
 * Dims the fake camera and waits until the video shows a frame painted
 * after it (the stream lags the canvas by a frame or two).
 *
 * @param {import("@playwright/test").Page} page
 */
async function dimCamera(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        /** @type {Window & Record<string, unknown>} */ (window).__dim = true;
        const video = /** @type {HTMLVideoElement} */ (
          document.querySelector("#video")
        );
        video.requestVideoFrameCallback(() =>
          video.requestVideoFrameCallback(() => resolve(undefined)),
        );
      }),
  );
}

/**
 * The frames JSON inside a Download all zip.
 *
 * @param {import("@playwright/test").Download} download
 */
async function framesJsonOf(download) {
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await readDownload(download))),
  );
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "feature-match-frames.json",
  );
  if (!entry || entry.directory) {
    throw new Error("no frames JSON in the zip");
  }
  const json = JSON.parse(await entry.getData(new TextWriter()));
  await reader.close();
  return json;
}

/**
 * Save, then tap Download all; returns the download.
 *
 * @param {import("@playwright/test").Page} page
 */
async function saveAll(page) {
  await page.locator("#save-frames").click();
  await expect(page.locator("#save-links a")).toHaveCount(5);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#save-links a").first().click(),
  ]);
  return download;
}

/**
 * Steps 1 and 2: the first tap starts the camera, the second takes A,
 * then B (which starts the run by itself).
 *
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<void>} [afterA] runs between photo A and photo B
 */
async function takePhotos(page, afterA = async () => undefined) {
  await expect(page.locator("#capture-a")).toHaveText("Start camera");
  await page.locator("#capture-a").click();
  await expect(page.locator("#capture-a")).toHaveText("Take photo A");
  await expect(page.locator("#state-a")).toHaveText(
    "camera on: aim, then tap Take photo A",
  );
  await page.locator("#capture-a").click();
  await expect(page.locator("#state-a")).toHaveText("taken, 320x240");
  await expect(page.locator("#step-2")).toHaveAttribute(
    "data-state",
    "current",
  );
  await afterA();
  await page.locator("#capture-b").click();
}

/** @param {import("@playwright/test").Page} page */
async function stepStates(page) {
  return page
    .locator(".steps > li")
    .evaluateAll((lis) => lis.map((li) => li.getAttribute("data-state")));
}

/** @param {import("@playwright/test").Page} page */
async function pageOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

/**
 * Why this test matters: the benchmark page is opened on a phone from a
 * branch preview and is linked from nothing, so no other test opens it.
 * With sift.js replaced by a stub (no network), it proves the page loads,
 * fits a phone's width, runs the synthetic pair through the whole loop,
 * fills the table, the copyable report and a result picture, and that its
 * button shows its running and final states. The real methods and their
 * timings need the phone and are not tested here.
 */
test("the feature matching benchmark runs a stubbed SIFT on the synthetic pair", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  expect(await stepStates(page)).toEqual(["current", "todo", "todo", "todo"]);
  await chooseSiftOnly(page);

  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#run-synthetic")).toBeEnabled();
  await expect(page.locator("#run-synthetic")).toHaveText(
    "Run on a synthetic pair",
  );

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
  const picture = page.locator("#pictures .picture");
  await expect(picture).toHaveCount(1);
  await expect(picture).toContainText(
    "SIFT (plain JS) @320 (320x240), last round: keypoints A 40, B 40 | matches 40 | correct",
  );
  await expect(picture.locator("canvas")).toHaveCount(1);
  // The synthetic run is not the camera pair: the steps do not move.
  expect(await stepStates(page)).toEqual(["current", "todo", "todo", "todo"]);

  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: a model or code file that fails to load must be
 * one log line, a table row and an error card, with the button back to
 * normal, never a blank page or a button stuck at "Running...".
 */
test("the feature matching benchmark reports a method that fails to load", async ({
  page,
}) => {
  await routeNetwork(page, (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);

  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText(
    "done: 1 methods, 1 with errors (see log)",
  );
  await expect(page.locator("#log")).toContainText(
    "ERROR SIFT (plain JS): init:",
  );
  await expect(page.locator("#results tbody tr")).toContainText("init:");
  await expect(page.locator("#pictures .picture-error")).toContainText(
    "SIFT (plain JS): ERROR init:",
  );
  await expect(page.locator("#run-synthetic")).toBeEnabled();
  await expect(page.locator("#run-synthetic")).toHaveText(
    "Run on a synthetic pair",
  );
});

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

/** @param {import("@playwright/test").Download} download */
async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) {
    chunks.push(/** @type {Buffer} */ (c));
  }
  return Buffer.concat(chunks);
}

/**
 * Why this test matters: the page is a guided flow so no step can be
 * forgotten on the phone: photo A, photo B, a run that starts by itself
 * with nothing to switch on, then save. During the run nothing else may
 * start (a capture or an encode would skew the timed rounds), the camera
 * is off, and the result picture appears. The saved files are handed over
 * to be checked offline, so they must be exactly the captured pixels,
 * carry nothing but pixels (no EXIF, text or time chunk), and the
 * keypoints and matches must be in the saved frames' own pixels. Every
 * saved file is named by the pair picked before photo A (no written list
 * of the order is kept), and Download all moves the picker on. Nothing
 * is uploaded: every request leaving the machine is refused.
 */
test("the feature matching benchmark guides photo A, photo B, an automatic run and the save", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  /** @type {() => void} */
  let releaseSift = () => undefined;
  const siftHeld = new Promise((resolve) => {
    releaseSift = () => resolve(undefined);
  });
  await routeNetwork(page, async (route) => {
    await siftHeld;
    await fulfillSift(route);
  });
  await fakeCamera(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#save-frames")).toBeDisabled();
  await expect(page.locator("#capture-b")).toBeDisabled();
  await chooseSiftOnly(page);
  // A second size whose computed frame (480x360) differs from the captured
  // one (320x240), so the saved coordinates show the mapping between them.
  await page.locator('input[name="size"][value="480"]').check();
  // The pair is picked before photo A and fixed there: changing the
  // selector between A and B must not relabel the pair in progress.
  await page.locator("#pair").selectOption("1b");
  await page.locator("#spot").fill("2");

  await takePhotos(page, async () => {
    await expect(page.locator("#pair-state")).toHaveText(
      "now: pair 1, 1b light: dimmed, spot 2",
    );
    await page.locator("#pair").selectOption("3a");
    // A dimmed pair: the light changes between A and B.
    await dimCamera(page);
  });
  // The run starts by itself; while it lasts nothing else can start.
  await expect(page.locator("#run")).toHaveText("Running...");
  expect(await stepStates(page)).toEqual(["done", "done", "current", "todo"]);
  for (const id of ["#capture-a", "#capture-b", "#save-frames", "#run"]) {
    await expect(page.locator(id)).toBeDisabled();
  }
  await expect(page.locator("#log")).toContainText("camera off");
  releaseSift();
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#run")).toHaveText("Run again");
  await expect(page.locator("#run")).toBeEnabled();
  expect(await stepStates(page)).toEqual(["done", "done", "done", "current"]);
  await expect(page.locator("#save-state")).toHaveText(
    "ready: tap to prepare the files",
  );
  expect(
    await page.evaluate(
      () =>
        /** @type {HTMLVideoElement} */ (document.querySelector("#video"))
          .srcObject,
    ),
  ).toBeNull();
  await expect(page.locator("#camera-box")).toBeHidden();
  await expect(page.locator("#capture-a")).toHaveText("Start camera");

  // Grey values of the half black, half white camera: 127.5 each, within
  // what the stream's colour conversion may move them.
  const logText = (await page.locator("#log").textContent()) ?? "";
  const grey = logText.match(
    /captured A 320x240 \(camera 320x240\), grey mean (\d+\.\d) sd (\d+\.\d) \(0-255\)/,
  );
  expect(grey).not.toBeNull();
  expect(Math.abs(Number(grey?.[1]) - 127.5)).toBeLessThanOrEqual(6);
  expect(Math.abs(Number(grey?.[2]) - 127.5)).toBeLessThanOrEqual(12);
  expect(await page.locator("#report").inputValue()).toMatch(
    /input: camera A 320x240, grey mean [\d.]+ sd [\d.]+ \(0-255\); B 320x240, grey mean/,
  );
  await expect(page.locator("#pictures .picture canvas")).toHaveCount(2);
  // The caption counts the round the picture shows.
  await expect(page.locator("#pictures .picture").first()).toContainText(
    "last round: keypoints A 40, B 40 | matches 40",
  );

  await page.locator("#save-frames").click();
  await expect(page.locator("#save-state")).toHaveText(
    "ready: tap Download all (zip), or each file",
  );
  await expect(page.locator("#save-links a")).toHaveCount(5);
  expect(await stepStates(page)).toEqual(["done", "done", "done", "done"]);

  // One tap saves everything: the zip holds each offered file and the
  // page log, so nothing has to be copied out by hand.
  const zipLink = page.locator("#save-links a").first();
  const stem = "feature-match-01-1b-s2-light-dimmed";
  await expect(zipLink).toHaveAttribute("download", `${stem}.zip`);
  await expect(zipLink).toContainText("Download all (zip)");
  const [zipFile] = await Promise.all([
    page.waitForEvent("download"),
    zipLink.click(),
  ]);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await readDownload(zipFile))),
  );
  const entries = await reader.getEntries();
  expect(entries.map((e) => e.filename).sort()).toEqual([
    "feature-match-frame-a.png",
    "feature-match-frame-b.png",
    "feature-match-frames.json",
    "feature-match-log.txt",
    "feature-match-matches.json",
    "feature-match-report.txt",
  ]);
  const zipText = async (/** @type {string} */ name) => {
    const entry = entries.find((e) => e.filename === name);
    if (!entry || entry.directory) {
      throw new Error(`no ${name} in the zip`);
    }
    return entry.getData(new TextWriter());
  };
  expect(await zipText("feature-match-log.txt")).toContain(
    "captured A 320x240",
  );
  expect(await zipText("feature-match-report.txt")).toContain(
    "SIFT (plain JS)",
  );
  await reader.close();
  // After Download all the selector moves on to the next pair, from the
  // pair in progress (1b), not from what the selector was changed to.
  await expect(page.locator("#pair")).toHaveValue("1c");
  await expect(page.locator("#spot")).toHaveValue("2");

  for (const name of [`${stem}-frame-a.png`, `${stem}-frame-b.png`]) {
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
    page.locator(`#save-links a[download="${stem}-frames.json"]`).click(),
  ]);
  const info = JSON.parse((await readDownload(json)).toString("utf8"));
  expect(Object.keys(info).sort()).toEqual([
    "captureMaxLongEdge",
    "device",
    "format",
    "frames",
    "lightCheck",
    "pair",
    "pairLabel",
    "sequence",
    "session",
    "spot",
  ]);
  expect(info.session).toMatch(/^[0-9a-f]{8}$/);
  expect([info.pair, info.pairLabel, info.spot, info.sequence]).toEqual([
    "1b",
    "light: dimmed",
    2,
    1,
  ]);
  expect(info.lightCheck).toBe("ok");
  await expect(page.locator("#light-warning")).toBeHidden();
  expect(
    info.frames.map((/** @type {{ width: number }} */ f) => f.width),
  ).toEqual([320, 320]);

  const [matchesFile] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`#save-links a[download="${stem}-matches.json"]`).click(),
  ]);
  const matches = JSON.parse(
    (await readDownload(matchesFile)).toString("utf8"),
  );
  expect(Object.keys(matches).sort()).toEqual([
    "coordinates",
    "format",
    "frames",
    "methods",
  ]);
  const size = matches.methods[0].sizes[0];
  expect([matches.methods[0].label, size.width, size.height]).toEqual([
    "SIFT (plain JS)",
    320,
    240,
  ]);
  expect(size.keypointsA).toHaveLength(40);
  // The stub's first keypoint, in the 320x240 frame's own pixels: at 320
  // the two sizes agree; at 480 it was found at (30, 36) of 480x360 and
  // maps to (30.5 x 2/3 - 0.5, 36.5 x 2/3 - 0.5).
  expect(size.keypointsA[0]).toEqual([20, 24]);
  expect(size.matches).toHaveLength(40);
  const size480 = matches.methods[0].sizes[1];
  expect([size480.width, size480.height]).toEqual([480, 360]);
  expect(size480.keypointsA[0]).toEqual([19.83, 23.83]);

  // A synthetic run replaces the camera run's results on screen, so the
  // camera run and its offered files are withdrawn with them: Save must
  // never offer files for results no longer shown.
  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#save-links a")).toHaveCount(0);
  await expect(page.locator("#save-frames")).toBeDisabled();
  await expect(page.locator("#run-state")).toHaveText(
    "replaced by the synthetic run: tap Run again",
  );
  expect(await stepStates(page)).toEqual(["done", "done", "current", "todo"]);
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: the async rule for the page's buttons: Save must
 * show its in-progress state, keep the captures from changing under it
 * (a capture during the encode would offer the old files as the new
 * ones), and on a failed encode withdraw every offered file, log the
 * error and come back; a refused camera must say so on the step and in
 * the log.
 */
test("the feature matching benchmark shows a failed save and a refused camera", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.addInitScript(() => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    const held = new Promise((resolve) => {
      w.__releaseEncode = resolve;
    });
    // The encoder fails, once released: as a phone out of memory would.
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      void held.then(() => callback(null));
    };
  });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await takePhotos(page);
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");

  await page.locator("#save-frames").click();
  await expect(page.locator("#save-state")).toHaveText("preparing...");
  for (const id of ["#save-frames", "#capture-a", "#capture-b", "#run"]) {
    await expect(page.locator(id)).toBeDisabled();
  }
  await page.evaluate(() =>
    /** @type {() => void} */ (
      /** @type {Window & Record<string, unknown>} */ (window).__releaseEncode
    )(),
  );
  await expect(page.locator("#save-state")).toHaveText("failed (see log)");
  await expect(page.locator("#log")).toContainText(
    "ERROR save: Error: frame A: PNG encoding failed",
  );
  await expect(page.locator("#save-links a")).toHaveCount(0);
  await expect(page.locator("#save-frames")).toBeEnabled();
  await expect(page.locator("#step-4")).toHaveAttribute(
    "data-state",
    "current",
  );
});

/**
 * Why this test matters: a camera run that measured nothing (a ticked
 * method left without a backend, or a run that threw) must say so on the
 * run step and in the log, and Save must not read "ready" as if there
 * were results: it offers the photos only, and says that.
 */
test("the feature matching benchmark names a run that measured nothing", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  // A protocol pair would set the backend itself; "none" uses the Options.
  await page.locator("#pair").selectOption("none");
  // XFeat ticked, but no backend: it would drop out without a word.
  await page.locator("#m-xfeat").check();
  for (const b of ["webgpu", "wasm"]) {
    await page.locator(`input[name="backend"][value="${b}"]`).uncheck();
  }
  await takePhotos(page);
  await expect(page.locator("#run-state")).toHaveText(
    "not run: a ticked method has nothing to run on (see log)",
  );
  await expect(page.locator("#log")).toContainText(
    "ERROR options: Error: XFeat is ticked but no backend is",
  );
  await expect(page.locator("#save-state")).toHaveText(
    "nothing measured: tap to save the photos anyway",
  );
  await expect(page.locator("#save-frames")).toBeEnabled();

  // A run that throws: an unknown backend value is refused.
  await page.locator('input[name="backend"][value="wasm"]').evaluate((el) => {
    const box = /** @type {HTMLInputElement} */ (el);
    box.value = "unknown";
    box.checked = true;
  });
  await page.locator("#run").click();
  await expect(page.locator("#run-state")).toHaveText("failed (see log)");
  await expect(page.locator("#log")).toContainText("ERROR run: RangeError");
  await expect(page.locator("#save-state")).toHaveText(
    "nothing measured: tap to save the photos anyway",
  );
  await expect(page.locator("#save-frames")).toBeEnabled();
});

/**
 * Why this test matters: where the browser offers no camera API at all
 * (plain http, some in-app browsers) the start fails before it awaits
 * anything; every later tap must try again and log it, not answer from a
 * failed start kept forever.
 */
test("the feature matching benchmark retries a camera start that failed at once", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await page.locator("#capture-a").click();
  await expect(page.locator("#state-a")).toHaveText(
    "camera unavailable (see log)",
  );
  await page.locator("#capture-a").click();
  await expect
    .poll(async () =>
      ((await page.locator("#log").textContent()) ?? "")
        .split("\n")
        .filter((l) => l.includes("ERROR camera:")),
    )
    .toHaveLength(2);
});

test("the feature matching benchmark says when the camera is refused", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "reject");
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await page.locator("#capture-a").click();
  await expect(page.locator("#state-a")).toHaveText(
    "camera unavailable (see log)",
  );
  await expect(page.locator("#log")).toContainText(
    "ERROR camera: NotAllowedError",
  );
  await expect(page.locator("#capture-a")).toBeEnabled();
  await expect(page.locator("#capture-a")).toHaveText("Start camera");
});

/**
 * Why this test matters: a run stops the camera because it costs the same
 * CPU and GPU being measured. A camera start still waiting for its stream
 * when the run begins must not switch the camera on afterwards, beside the
 * timed rounds.
 */
test("the feature matching benchmark keeps the camera off when a run starts during its start", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "hold");
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await page.locator("#capture-a").click();
  await expect(page.locator("#state-a")).toHaveText("starting camera...");
  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText("done: 1 methods");
  await page.evaluate(() =>
    /** @type {() => void} */ (
      /** @type {Window & Record<string, unknown>} */ (window).__releaseCamera
    )(),
  );
  await expect(page.locator("#state-a")).toHaveText(
    "camera stopped: tap again",
  );
  const state = await page.evaluate(() => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    const s = /** @type {MediaStream} */ (w.__lastStream);
    return {
      video: /** @type {HTMLVideoElement} */ (document.querySelector("#video"))
        .srcObject,
      tracks: s.getTracks().map((t) => t.readyState),
    };
  });
  expect(state.video).toBeNull();
  expect(state.tracks).toEqual(["ended"]);
  await expect(page.locator("#camera-box")).toBeHidden();
});

/**
 * Why this test matters: the photo tests are taken from what the page says
 * on the phone, so the card under the selector must always show the
 * selected pair's purpose, numbered steps and what to avoid, and follow the
 * selector; the general rules are open on the first visit only; the Options
 * and Copy log say they are not part of the photo tests.
 */
test("the feature matching benchmark guides each pair and the first visit", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");

  await expect(page.locator("#before-start")).toHaveAttribute("open", "");
  await expect(page.locator("#before-start-list")).toContainText(
    "Lock the screen rotation. Do not zoom.",
  );
  await expect(page.locator("#before-start-list li")).toHaveCount(5);

  await expect(page.locator("#pair")).toHaveValue("1a");
  await expect(page.locator("#guide-purpose")).toHaveText(
    "How many matches survive when nothing changes.",
  );
  await expect(page.locator("#guide-steps li")).toHaveCount(4);
  await expect(page.locator("#guide-avoid")).toHaveText(
    "Avoid: Moving the phone, changing the light.",
  );
  await expect(page.locator("#guide-spot")).toBeVisible();

  await page.locator("#pair").selectOption("2b");
  await expect(page.locator("#guide-purpose")).toHaveText(
    "Does a method cope with a quarter turn?",
  );
  await expect(page.locator("#guide-steps li")).toHaveCount(3);
  await expect(page.locator("#guide-steps li").last()).toHaveText(
    "Turn the phone sideways (either way) and aim at the same centre: photo B.",
  );
  await expect(page.locator("#guide-avoid")).toHaveText(
    "Avoid: Stepping closer or away.",
  );
  await expect(page.locator("#guide-spot")).toBeHidden();

  await page.locator("#pair").selectOption("none");
  await expect(page.locator("#guide-purpose")).toContainText(
    "the Options decide what runs",
  );
  await expect(page.locator("#options-note")).toContainText(
    "WASM where the phone has no WebGPU",
  );
  await expect(page.locator("#options-note")).toContainText(
    "Photo tests set these themselves",
  );
  await expect(page.locator("#copy-note")).toHaveText(
    "Not needed for the photo tests - the zip already contains the log. Use it to paste a quick timing run into a chat.",
  );
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#before-start")).not.toHaveAttribute("open");
  expect(errors).toEqual([]);
});

/**
 * The run's method headers in the report, in order.
 *
 * @param {import("@playwright/test").Page} page
 */
async function reportHeaders(page) {
  return (await page.locator("#report").inputValue())
    .split("\n")
    .filter((l) => l.startsWith("## "));
}

/**
 * Why this test matters: the first zip of the photo tests ran 5 runs after
 * a warm-up on WebGPU and WASM with both XFeat files, because the protocol's
 * settings had to be set by hand in Options. With the Options untouched, a
 * picked pair must run once, without a warm-up, on WebGPU only with one
 * XFeat file, and say so in the log and the report; where the browser has
 * no WebGPU it falls back to WASM and says that. The real methods cannot
 * load here (the network is refused), so their report headers name what
 * would have run.
 */
for (const gpuCase of /** @type {const} */ ([
  "adapter",
  "no adapter",
  "no navigator.gpu",
])) {
  test(`the feature matching benchmark runs a photo test pair with its own settings (${gpuCase})`, async ({
    page,
  }) => {
    await routeNetwork(page, fulfillSift);
    await fakeCamera(page);
    // A browser can offer navigator.gpu and still have no adapter: that is
    // no WebGPU too, or every neural method fails on a WebGPU-only run.
    await page.addInitScript((c) => {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value:
          c === "no navigator.gpu"
            ? undefined
            : {
                requestAdapter: async () =>
                  c === "adapter" ? { info: {}, features: [] } : null,
              },
      });
    }, gpuCase);
    const gpu = gpuCase === "adapter";
    await page.goto("/feature-match-check.html?ui=cockpit");
    await expect(page.locator("#log")).toContainText("ready");
    await page.locator("#pair").selectOption("2a");
    await takePhotos(page);
    await expect(page.locator("#run-state")).toContainText("done: 3 methods");

    const backend = gpu ? "webgpu" : "wasm";
    await expect(page.locator("#log")).toContainText(
      `runs: 1, no warm-up, backends ${backend}${gpu ? "" : " (no WebGPU on this device)"}, XFeat files fp16 (photo test 2a)`,
    );
    expect(await page.locator("#report").inputValue()).toContain(
      "sizes (long edge): 320, 480, 640; runs: 1, no warm-up",
    );
    expect(await reportHeaders(page)).toEqual([
      "## SIFT (plain JS)",
      `## XFeat (LiteRT.js) ${backend} xfeat_fp16.tflite`,
      `## ALIKED + LightGlue (onnxruntime-web) ${backend}`,
    ]);
  });
}

/**
 * Why this test matters: on the first evening the light was dimmed before
 * photo A, so the dimmed pairs had A and B equally dark and measured
 * nothing about light. Photo B of a dimmed pair that is not darker must
 * say so above the results, be recorded in the frames JSON, and keep the
 * selector on the pair after Download all so it is taken again; the
 * control pair warns the other way, when its light changed.
 */
test("the feature matching benchmark warns when the light did not change as the pair needs", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await page.locator("#pair").selectOption("1b");
  await takePhotos(page);
  await expect(page.locator("#light-warning")).toContainText(
    "Photo B is not darker than photo A - the light has to change BETWEEN the two photos. Take this pair again: photo A in normal light, then dim, then photo B.",
  );
  await expect(page.locator("#light-warning")).toContainText(
    "dim further (switch off more lights)",
  );
  await expect(page.locator("#light-warning")).toBeVisible();
  await expect(page.locator("#log")).toContainText("light check: not-darker");
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  await page.locator("#save-frames").click();
  await expect(page.locator("#save-links a")).toHaveCount(5);
  const stem = "feature-match-01-1b-s1-light-dimmed";
  const [zipFile] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#save-links a").first().click(),
  ]);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await readDownload(zipFile))),
  );
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "feature-match-frames.json",
  );
  if (!entry || entry.directory) {
    throw new Error("no frames JSON in the zip");
  }
  expect(JSON.parse(await entry.getData(new TextWriter())).lightCheck).toBe(
    "not-darker",
  );
  await reader.close();
  expect(zipFile.suggestedFilename()).toBe(`${stem}.zip`);
  // The pair is taken again: the selector stays.
  await expect(page.locator("#log")).toContainText("pair kept: take 1b again");
  await expect(page.locator("#pair")).toHaveValue("1b");

  // Retaking only photo B after the save is a new take: a new running
  // number, so its files never share the old ones' names.
  await page.locator("#capture-b").click();
  await expect(page.locator("#capture-b")).toHaveText("Take photo B");
  await dimCamera(page);
  await page.locator("#capture-b").click();
  await expect(page.locator("#pair-state")).toHaveText(
    "now: pair 2, 1b light: dimmed, spot 1",
  );
  await expect(page.locator("#light-warning")).toBeHidden();
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  const retake = await saveAll(page);
  expect(retake.suggestedFilename()).toBe(
    "feature-match-02-1b-s1-light-dimmed.zip",
  );
  expect((await framesJsonOf(retake)).lightCheck).toBe("ok");
  await expect(page.locator("#pair")).toHaveValue("1c");

  // The control pair: A in the normal light, B dimmed, is a changed light.
  // The camera is off after the run, so the light goes back on without
  // waiting for a frame: the next start paints fresh ones.
  await page.evaluate(() => {
    /** @type {Window & Record<string, unknown>} */ (window).__dim = false;
  });
  await page.locator("#pair").selectOption("1a");
  await page.locator("#capture-a").click();
  await expect(page.locator("#capture-a")).toHaveText("Take photo A");
  await page.locator("#capture-a").click();
  // A new photo A withdraws the old warning.
  await expect(page.locator("#light-warning")).toBeHidden();
  await dimCamera(page);
  await page.locator("#capture-b").click();
  await expect(page.locator("#light-warning")).toContainText(
    "the light changed during the control pair",
  );
  await expect(page.locator("#log")).toContainText("light check: changed");
});

/**
 * Why this test matters: a reload or a discarded tab restarted the running
 * number, and two downloads of one evening shared a name. The number, the
 * pair and the spot carry over a reload; with storage blocked every load
 * starts at 1, and the session token in the frames JSON keeps the two runs
 * apart.
 */
test("the feature matching benchmark keeps the running number across a reload", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await page.locator("#pair").selectOption("2a");
  await takePhotos(page);
  await expect(page.locator("#pair-state")).toHaveText(
    "now: pair 1, 2a rotation: control (both upright), spot 1",
  );
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  const first = await saveAll(page);
  await expect(page.locator("#pair")).toHaveValue("2b");

  await page.reload();
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#pair")).toHaveValue("2b");
  await chooseSiftOnly(page);
  await takePhotos(page);
  await expect(page.locator("#pair-state")).toHaveText(
    "now: pair 2, 2b rotation: 90 deg, spot 1",
  );
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  const second = await saveAll(page);
  expect(second.suggestedFilename()).toBe(
    "feature-match-02-2b-s1-rotation-90-deg.zip",
  );
  const [a, b] = [await framesJsonOf(first), await framesJsonOf(second)];
  expect(a.session).toMatch(/^[0-9a-f]{8}$/);
  expect(b.session).not.toBe(a.session);
});

/**
 * Why this test matters: a tester may save a pair's files one by one
 * instead of as the zip. Only the zip used to mark the pair saved, so a
 * photo B taken again afterwards was offered under the names already on
 * the device. Any save link marks the pair saved, and the retake gets a
 * new running number.
 */
test("the feature matching benchmark numbers a retake after a single-file download", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await page.locator("#pair").selectOption("2a");
  await takePhotos(page);
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  /** Save, then tap the frame B link; returns its download. */
  const saveFrameB = async () => {
    await page.locator("#save-frames").click();
    await expect(page.locator("#save-links a")).toHaveCount(5);
    const link = page.locator("#save-links a", { hasText: "frame B (PNG)" });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      link.click(),
    ]);
    return download;
  };
  const stem = "feature-match-01-2a-s1-rotation-control-both-upright";
  expect((await saveFrameB()).suggestedFilename()).toBe(`${stem}-frame-b.png`);

  await page.locator("#capture-b").click();
  await expect(page.locator("#capture-b")).toHaveText("Take photo B");
  await page.locator("#capture-b").click();
  await expect(page.locator("#pair-state")).toHaveText(
    "now: pair 2, 2a rotation: control (both upright), spot 1",
  );
  await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
  expect((await saveFrameB()).suggestedFilename()).toBe(
    "feature-match-02-2a-s1-rotation-control-both-upright-frame-b.png",
  );
});

test("the feature matching benchmark tells two runs apart with storage blocked", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.addInitScript(() => {
    for (const m of ["getItem", "setItem"]) {
      Object.defineProperty(Storage.prototype, m, {
        configurable: true,
        value: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    }
  });
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    await page.goto("/feature-match-check.html?ui=cockpit");
    await expect(page.locator("#log")).toContainText("ready");
    await chooseSiftOnly(page);
    await takePhotos(page);
    await expect(page.locator("#run-state")).toHaveText("done: 1 methods");
    const zip = await saveAll(page);
    expect(zip.suggestedFilename()).toMatch(/^feature-match-01-1a-/);
    sessions.push((await framesJsonOf(zip)).session);
  }
  expect(sessions[0]).toMatch(/^[0-9a-f]{8}$/);
  expect(sessions[1]).not.toBe(sessions[0]);
});

/**
 * Dims the fake camera and waits for two frames of the flat mode's video.
 *
 * @param {import("@playwright/test").Page} page
 */
async function dimFlatCamera(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        /** @type {Window & Record<string, unknown>} */ (window).__dim = true;
        const video = /** @type {HTMLVideoElement} */ (
          document.querySelector("#flat-video")
        );
        video.requestVideoFrameCallback(() =>
          video.requestVideoFrameCallback(() => resolve(undefined)),
        );
      }),
  );
}

/**
 * Taps the reference photo at fractions of its picture (not of its box:
 * the canvas is letterboxed with object-fit: contain).
 *
 * @param {import("@playwright/test").Page} page
 * @param {[number, number][]} points
 */
async function tapCorners(page, points) {
  const box = await page.locator("#flat-still").evaluate((el) => {
    const c = /** @type {HTMLCanvasElement} */ (el);
    const r = c.getBoundingClientRect();
    const scale = Math.min(r.width / c.width, r.height / c.height);
    return {
      left: r.left + (r.width - c.width * scale) / 2,
      top: r.top + (r.height - c.height * scale) / 2,
      width: c.width * scale,
      height: c.height * scale,
    };
  });
  for (const [fx, fy] of points) {
    await page.mouse.click(
      box.left + fx * box.width,
      box.top + fy * box.height,
    );
  }
}

/**
 * The visible buttons and links of the flat mode that are not wholly on
 * screen.
 *
 * @param {import("@playwright/test").Page} page
 */
async function offscreenFlatButtons(page) {
  return page.locator("#flat button, #flat a").evaluateAll((buttons) =>
    buttons
      .filter((b) => b.getClientRects().length > 0)
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return (
          r.left < 0 ||
          r.top < 0 ||
          r.right > window.innerWidth + 0.5 ||
          r.bottom > window.innerHeight + 0.5
        );
      })
      .map((b) => b.id || (b.textContent ?? "").trim()),
  );
}

/**
 * Phone portrait, a foldable's inner screen both ways, and two short
 * windows (the inner screen with browser bars, a split screen).
 */
const FLAT_VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 880, height: 790 },
  { width: 790, height: 880 },
  { width: 830, height: 600 },
  { width: 750, height: 700 },
];

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} phase
 */
async function expectFlatControlsOnScreen(page, phase) {
  for (const size of FLAT_VIEWPORTS) {
    await page.setViewportSize(size);
    expect(
      await offscreenFlatButtons(page),
      `${phase} at ${String(size.width)}x${String(size.height)}`,
    ).toEqual([]);
  }
  await page.setViewportSize(FLAT_VIEWPORTS[0]);
}

/** Each photo waits for its 3 s countdown. */
const AFTER_COUNTDOWN = { timeout: 10_000 };

/**
 * Why this test matters: the flat target capture is used on a phone resting
 * on something steady, one surface after another, with photos that exist
 * only in the page until downloaded. It proves the whole loop for one
 * surface: the mode opens from the pair selector, the reference waits for
 * its countdown (which a second tap cancels), the four corner taps are
 * guided in order and can be redone, the straightened check is shown
 * before it is kept, the full-light and a darker shot of a pose get their
 * light bin from the luma ratio (shown live too), and one tap downloads
 * one zip with every photo, the corners and the tags in the file names
 * and the JSON. The progress survives a reload, every control is on
 * screen at the three viewports without scrolling, Exit gives the photo
 * pairs back, and nothing is uploaded (every request off the machine is
 * refused).
 */
test("the feature matching page captures a flat target surface end to end", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.setViewportSize(FLAT_VIEWPORTS[0]);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");

  await page.locator("#pair").selectOption("flat");
  await expect(page.locator("#flat")).toBeVisible();
  await expect(page.locator("#flat-where")).toHaveText("Overview");
  await expect(page.locator("#flat-classes li")).toHaveText([
    "busy picture: 0 of 5 complete, 0 started",
    "text-heavy: 0 of 5 complete, 0 started",
    "low-texture: 0 of 5 complete, 0 started",
  ]);
  await expectFlatControlsOnScreen(page, "overview");

  await page.locator("#flat-new").click();
  await expect(page.locator("#flat-where")).toHaveText(
    "Surface 1, busy picture, reference",
  );
  const shoot = page.locator("#flat-shoot");
  await expect(shoot).toHaveText("Take reference (3 s)");
  await expect(shoot).toBeEnabled();
  await expectFlatControlsOnScreen(page, "reference");

  await shoot.click();
  await expect(page.locator("#flat-countdown")).toBeVisible();
  await expect(shoot).toHaveText(/^Cancel \(\d\)$/);
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText("cancelled");
  await expect(page.locator("#flat-countdown")).toBeHidden();

  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    "reference taken, 320x240",
    AFTER_COUNTDOWN,
  );
  await expect(page.locator("#flat-hint")).toHaveText(
    "Tap corner 1 of 4 on the photo: top-left.",
  );
  await expectFlatControlsOnScreen(page, "corners");
  // A wrong first try, redone.
  await tapCorners(page, [
    [0.1, 0.1],
    [0.1, 0.9],
  ]);
  await page.locator("#flat-redo").click();
  await expect(page.locator("#flat-hint")).toHaveText(
    "Tap corner 1 of 4 on the photo: top-left.",
  );
  await tapCorners(page, [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
  ]);
  await expect(page.locator("#flat-hint")).toHaveText(
    "Tap corner 4 of 4 on the photo: bottom-left.",
  );
  await tapCorners(page, [[0.1, 0.9]]);
  await expect(page.locator("#flat-state")).toHaveText(
    /^straightened: \d+x\d+$/,
  );
  await expect(page.locator("#flat-accept")).toBeVisible();
  await expectFlatControlsOnScreen(page, "check");
  await page.locator("#flat-accept").click();

  await expect(page.locator("#flat-where")).toHaveText(
    "Surface 1, busy picture, pose 40 % wide, 0 deg",
  );
  await expect(page.locator("#flat-poses button")).toHaveCount(6);
  await expect(page.locator("#flat-guide")).toBeVisible();
  await expect(shoot).toHaveText("Full-light shot, 40 % 0 deg (3 s)");
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    "taken: w40-t0 q1: full light, bin b1",
    AFTER_COUNTDOWN,
  );
  await expect(page.locator("#flat-live")).toHaveText(
    /^light now: (0\.9\d|1\.\d\d) of full, bin b1$/,
  );

  // A dimmer lamp: the white half drops to grey 64, so the guide region's
  // mean falls to about a quarter of the full-light shot's: bin b4.
  await dimFlatCamera(page);
  await expect(page.locator("#flat-live")).toHaveText(
    /^light now: 0\.[12]\d of full, bin b4$/,
  );
  await expect(page.locator('#flat-bins [data-bin="b4"]')).toHaveAttribute(
    "data-live",
    "true",
  );
  await expect(shoot).toHaveText("Darker shot, 40 % 0 deg (3 s)");
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    /^taken: w40-t0 q2: 0\.[12]\d of full, bin b4$/,
    AFTER_COUNTDOWN,
  );
  for (const [bin, filled] of [
    ["b1", "true"],
    ["b2", "false"],
    ["b3", "false"],
    ["b4", "true"],
  ]) {
    await expect(
      page.locator(`#flat-bins [data-bin="${bin}"]`),
    ).toHaveAttribute("data-filled", filled);
  }
  await expectFlatControlsOnScreen(page, "poses");

  const download = page.locator("#flat-download");
  // New captures, not files: the reference (with its straightened copy)
  // and the two shots.
  await expect(download).toHaveText("Download zip (3 new)");
  // Prepared first, then a link the user taps: only that tap marks the
  // photos downloaded.
  await download.click();
  await expect(page.locator("#flat-state")).toHaveText(
    /^ready: tap Save \(4 photos, /,
  );
  await expect(download).toHaveText("Download zip (3 new)");
  const saveLink = page.locator("#flat-save-link");
  await expect(saveLink).toHaveText(
    /^Save flat-target-s01-busy-[0-9a-f]{8}\.zip$/,
  );
  await expectFlatControlsOnScreen(page, "save link");
  const [zipFile] = await Promise.all([
    page.waitForEvent("download"),
    saveLink.click(),
  ]);
  const zipName = zipFile.suggestedFilename();
  expect(zipName).toMatch(/^flat-target-s01-busy-[0-9a-f]{8}\.zip$/);
  const session = zipName.slice("flat-target-s01-busy-".length, -".zip".length);
  await expect(page.locator("#flat-state")).toHaveText(
    new RegExp(`^downloaded ${zipName.replace(/\./g, "\\.")}: 4 photos, `),
  );
  await expect(download).toHaveText("Download zip");
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await readDownload(zipFile))),
  );
  const entries = await reader.getEntries();
  expect(entries.map((e) => e.filename).sort()).toEqual([
    "feature-match-log.txt",
    `s01-${session}-info.json`,
    "s01-reference-rectified.png",
    "s01-reference.png",
    "s01-w40-t0-q1-b1.png",
    "s01-w40-t0-q2-b4.png",
  ]);
  const infoEntry = entries.find(
    (e) => e.filename === `s01-${session}-info.json`,
  );
  if (!infoEntry || infoEntry.directory) {
    throw new Error("no info JSON in the zip");
  }
  const info = JSON.parse(await infoEntry.getData(new TextWriter()));
  await reader.close();
  expect([info.format, info.surface, info.class]).toEqual([
    "flat-target/1",
    1,
    "busy",
  ]);
  expect(info.session).toBe(session);
  expect(info.capture).toBe("getUserMedia");
  expect(info.camera).toEqual({ width: 320, height: 240 });
  expect(info.original).toEqual({ exists: false, file: null });
  expect(info.reference.file).toBe("s01-reference.png");
  expect([info.reference.width, info.reference.height]).toEqual([320, 240]);
  expect(
    info.reference.corners.map(
      (/** @type {{ corner: string }} */ c) => c.corner,
    ),
  ).toEqual(["top-left", "top-right", "bottom-right", "bottom-left"]);
  // The taps in the photo's own pixels: 90 % of 320x240.
  expect(Math.abs(info.reference.corners[2].x - 288)).toBeLessThanOrEqual(2);
  expect(Math.abs(info.reference.corners[2].y - 216)).toBeLessThanOrEqual(2);
  expect(info.shots).toHaveLength(2);
  expect(info.shots[0]).toMatchObject({
    file: "s01-w40-t0-q1-b1.png",
    pose: "w40-t0",
    distanceWidthPercent: 40,
    tiltDeg: 0,
    fullLight: true,
    lumaRatio: 1,
    bin: "b1",
    width: 320,
    height: 240,
  });
  expect(info.shots[1]).toMatchObject({
    file: "s01-w40-t0-q2-b4.png",
    fullLight: false,
    bin: "b4",
  });
  expect(info.shots[1].lumaRatio).toBeLessThan(0.35);

  // After a reload the mode and the downloaded progress are back.
  await page.reload();
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#flat")).toBeVisible();
  await expect(page.locator("#flat-where")).toHaveText(
    "Surface 1, busy picture, pose 40 % wide, 0 deg",
  );
  await expect(page.locator('#flat-bins [data-bin="b4"]')).toHaveAttribute(
    "data-filled",
    "true",
  );
  await page.locator("#flat-overview-open").click();
  await expect(page.locator("#flat-classes li").first()).toHaveText(
    "busy picture: 0 of 5 complete, 1 started",
  );
  await expect(page.locator("#flat-surfaces button")).toHaveText([
    "Surface 1, busy picture: reference done, poses 0/6, 2 photos",
  ]);
  await expect(page.locator("#flat-new")).toHaveText("Start surface 2");
  // The class furthest behind its plan is suggested for the next surface.
  await expect(page.locator("#flat-new-class")).toHaveValue("text");

  // Exit gives the photo pairs back, and they still work.
  await page.locator("#flat-exit").click();
  await expect(page.locator("#flat")).toBeHidden();
  await expect(page.locator("#pair")).toHaveValue("1a");
  await page.locator("#capture-a").click();
  await expect(page.locator("#state-a")).toHaveText(
    "camera on: aim, then tap Take photo A",
  );
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: the photos exist only in the page until their zip
 * is saved, so a failed zip must say why, mark nothing downloaded and leave
 * the button ready for another try; a "downloaded" there would let the user
 * walk away from photos that were never saved. It also proves the original
 * file a surface was printed from is attached by picking it, and ends up in
 * the zip under the surface's name.
 */
test("the flat target capture keeps the photos when the zip fails, and attaches the original", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.setViewportSize(FLAT_VIEWPORTS[0]);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await page.locator("#pair").selectOption("flat");

  await page.locator("#flat-new-file").setInputFiles({
    name: "Poster.PNG",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(page.locator("#flat-new-original")).toBeChecked();
  await page.locator("#flat-new").click();
  await expect(page.locator("#log")).toContainText(
    "flat: surface 1 started, busy, original attached",
  );
  const shoot = page.locator("#flat-shoot");
  await expect(shoot).toBeEnabled();
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    "reference taken, 320x240",
    AFTER_COUNTDOWN,
  );
  await tapCorners(page, [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ]);
  await page.locator("#flat-accept").click();
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    "taken: w40-t0 q1: full light, bin b1",
    AFTER_COUNTDOWN,
  );

  const download = page.locator("#flat-download");
  await expect(download).toHaveText("Download zip (2 new)");
  // Every PNG encode fails, as an out-of-memory canvas would.
  await page.evaluate(() => {
    /** @type {Window & Record<string, unknown>} */ (window).__toBlob =
      HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  await download.click();
  await expect(page.locator("#flat-state")).toHaveText(
    /^zip failed: Error: reference: PNG encoding failed; nothing was marked downloaded$/,
  );
  await expect(download).toBeEnabled();
  await expect(download).toHaveText("Download zip (2 new)");
  await expect(page.locator("#flat-save-link")).toBeHidden();

  // The encoder back: the same photos save, the original among them.
  await page.evaluate(() => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    HTMLCanvasElement.prototype.toBlob =
      /** @type {HTMLCanvasElement["toBlob"]} */ (w.__toBlob);
  });
  await download.click();
  const saveLink = page.locator("#flat-save-link");
  await expect(saveLink).toBeVisible();
  // A shot taken after the zip was made makes it stale: its Save link goes
  // and Download counts the new shot, so the zip saved holds every photo.
  await shoot.click();
  await expect(page.locator("#flat-state")).toHaveText(
    /^taken: w40-t0 q2/,
    AFTER_COUNTDOWN,
  );
  await expect(saveLink).toBeHidden();
  await expect(download).toHaveText("Download zip (3 new)");
  await download.click();
  await expect(saveLink).toBeVisible();
  const [zipFile] = await Promise.all([
    page.waitForEvent("download"),
    saveLink.click(),
  ]);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await readDownload(zipFile))),
  );
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  expect(names).toContain("s01-original.png");
  expect(names.some((n) => /^s01-w40-t0-q2-b\d\.png$/.test(n))).toBe(true);
  await expect(download).toHaveText("Download zip");
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: an attached original lives only in the page until
 * a zip of its surface is saved; a surface with an original and nothing
 * else yet must still make leaving the page ask first.
 */
test("the flat target capture asks before leaving with only an attached original", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await page.locator("#pair").selectOption("flat");
  await page.locator("#flat-new-file").setInputFiles({
    name: "poster.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await page.locator("#flat-new").click();
  await expect(page.locator("#log")).toContainText("original attached");
  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.accept();
});

/**
 * Why this test matters: the speed test is started on a phone left alone
 * for minutes, so its button must show that it is working, refuse a
 * second start, and end in a report the copy button can take, even when
 * an arm cannot load (here every CDN and model host is refused, so the
 * SIFT + LightGlue arm fails at its runtime import). The real model runs
 * are measured by hand on devices: a 46 MB download has no place in CI.
 */
test("the feature matching speed test reports an arm that cannot load", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  // The runtime import is held, so the in-progress state can be seen.
  let releaseRuntime = () => undefined;
  const runtimeHeld = new Promise((resolve) => {
    releaseRuntime = () => resolve(undefined);
  });
  await page.route(/onnxruntime-web/, async (route) => {
    await runtimeHeld;
    await route.abort();
  });
  // A wake lock that counts the locks held; hiding the page drops them, as
  // the browser does.
  await page.addInitScript(() => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    const locks = new Set();
    w.__locksHeld = () => locks.size;
    w.__hide = (/** @type {boolean} */ hidden) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      if (hidden) {
        for (const l of locks) {
          l.release();
        }
      }
      document.dispatchEvent(new Event("visibilitychange"));
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: () => {
          const t = new EventTarget();
          const lock = Object.assign(t, {
            release: () => {
              if (locks.delete(lock)) {
                t.dispatchEvent(new Event("release"));
              }
              return Promise.resolve();
            },
          });
          locks.add(lock);
          return Promise.resolve(lock);
        },
      },
    });
  });
  await page.goto("/feature-match-check.html?ui=cockpit");
  await expect(page.locator("#log")).toContainText("ready");
  await page.locator("#speed summary").click();
  for (const box of ["#t-xfeat", "#t-dino-int8", "#t-dino-q4f16"]) {
    await page.locator(box).uncheck();
  }
  await page.locator('input[name="t-backend"][value="webgpu"]').uncheck();
  await page.locator("#t-runs").fill("2");
  const run = page.locator("#run-speed");
  await run.click();
  await expect(run).toHaveText("Timing...");
  await expect(run).toBeDisabled();
  // The screen stays on while it runs; a page hidden meanwhile is named.
  const locksHeld = () =>
    page.evaluate(() =>
      /** @type {() => number} */ (
        /** @type {Window & Record<string, unknown>} */ (window).__locksHeld
      )(),
    );
  await expect.poll(locksHeld).toBe(1);
  const hide = (/** @type {boolean} */ hidden) =>
    page.evaluate((h) => {
      /** @type {(h: boolean) => void} */ (
        /** @type {Window & Record<string, unknown>} */ (window).__hide
      )(h);
    }, hidden);
  await hide(true);
  expect(await locksHeld()).toBe(0);
  await hide(false);
  await expect.poll(locksHeld).toBe(1);
  releaseRuntime();
  await expect(page.locator("#speed-state")).toHaveText(
    "done: 1 arms, 1 with errors (see the report)",
  );
  await expect(run).toHaveText("Run speed test");
  await expect(run).toBeEnabled();
  const report = await page.locator("#report").inputValue();
  expect(report).toContain("Feature matching speed test");
  expect(report).toContain("input: synthetic");
  expect(report).toContain("SIFT cap 512 per frame");
  expect(report).toMatch(/ERROR load: /);
  expect(report).toContain("ERROR page was hidden during runs");
  expect(report).toMatch(/ort wasm threads \d/);
  expect(await locksHeld()).toBe(0);

  // Nothing ticked: said at once, nothing run.
  await page.locator("#t-siftlg").uncheck();
  await run.click();
  await expect(page.locator("#speed-state")).toHaveText(
    "not run: nothing ticked",
  );
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// The guided view (the page's default; the tests above open ?ui=cockpit).

/**
 * A stand-in save dialog: `window.__saveAnswer` "save" (the default)
 * keeps the written bytes in `window.__saved` by suggested name, "cancel"
 * dismisses the dialog as a user would, "hold" keeps it open until
 * `window.__releaseSave()` (then it saves).
 *
 * @param {import("@playwright/test").Page} page
 */
async function savePicker(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__saveAnswer = "save";
    w.__saved = {};
    w.showSaveFilePicker = async (/** @type {any} */ opts) => {
      if (w.__saveAnswer === "cancel") {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      if (w.__saveAnswer === "hold") {
        await new Promise((resolve) => {
          w.__releaseSave = resolve;
        });
      }
      const parts = /** @type {Blob[]} */ ([]);
      return {
        createWritable: async () => ({
          write: async (/** @type {Blob} */ b) => {
            parts.push(b);
          },
          close: async () => {
            w.__saved[opts.suggestedName] = new Blob(parts);
          },
          abort: async () => undefined,
        }),
      };
    };
  });
}

/**
 * The bytes the stand-in save dialog kept under `name`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function savedBytes(page, name) {
  const b64 = await page.evaluate(async (n) => {
    const blob = /** @type {any} */ (window).__saved[n];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) {
      s += String.fromCharCode(x);
    }
    return btoa(s);
  }, name);
  return Buffer.from(b64, "base64");
}

/**
 * The entry names and the text files of a zip.
 *
 * @param {Buffer} bytes
 */
async function zipContents(bytes) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
  const names = /** @type {string[]} */ ([]);
  const texts = /** @type {Record<string, string>} */ ({});
  for (const e of await reader.getEntries()) {
    names.push(e.filename);
    if (!e.directory && /\.(txt|json)$/.test(e.filename) && e.getData) {
      texts[e.filename] = await e.getData(new TextWriter());
    }
  }
  await reader.close();
  return { names, texts };
}

/**
 * Countdown off (the pairs sheet's setting), so each tap shoots at once.
 *
 * @param {import("@playwright/test").Page} page
 */
async function countdownOff(page) {
  await page.locator("#g-open-pairs").click();
  const off = page.locator('#g-sheet-pairs [data-countdown="0"]');
  await off.click();
  await expect(off).toHaveAttribute("aria-checked", "true");
  await page.locator("#g-close-pairs").click();
}

/**
 * From the intro: Start, countdown off, then both photos of the first
 * pair, the camera on by itself.
 *
 * @param {import("@playwright/test").Page} page
 */
async function guidedFirstPair(page) {
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-run")).toBeVisible();
  await expect(page.locator("#g-cam-chip")).toBeHidden();
  await countdownOff(page);
  const primary = page.locator("#g-primary-label");
  await expect(primary).toHaveText("Capture A");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "true",
  );
  await expect(primary).toHaveText("Capture B");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-review")).toBeVisible();
  await expect(primary).toHaveText("Next pair");
}

/**
 * Why this test matters: the guided view is what a tester sees by
 * default, so its whole path must work with nothing but taps: the intro,
 * the camera starting by itself, a countdown that can be cancelled, both
 * photos with the ghost of A while B is due, the review and a retake
 * taken back, the next pair, and the end screen's one download. The zip
 * is what gets sent back, so it must hold the complete pair under its own
 * names plus the summary and the log, and a dismissed save dialog must
 * lose nothing and count no download. Nothing leaves the machine.
 */
test("the guided photo test runs from the intro to a saved zip", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await savePicker(page);
  await page.goto("/feature-match-check.html");
  await expect(page.locator("html")).toHaveAttribute("data-ui", "guided");
  await expect(page.locator("body > .layout")).toBeHidden();
  await expect(page.locator("#g-intro")).toBeVisible();
  await expect(page.locator("#g-intro-start")).toHaveText("Start");
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-head-pos")).toHaveText(/^Pair 1 of \d+$/);
  await expect(page.locator("#g-card-key")).toHaveText("1a");
  await expect(page.locator("#g-cam-chip")).toBeHidden();

  // The default countdown: 3 s with the big button as Cancel.
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count-num")).toHaveText("3");
  await expect(page.locator("#g-primary-label")).toHaveText("Cancel");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(page.locator("#g-primary-label")).toHaveText("Capture A");
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "false",
  );

  await countdownOff(page);
  await expect(page.locator("#g-primary-sub")).toHaveText("shoots at once");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "true",
  );
  // While B is due, photo A can be laid over the finder.
  await page.locator("#g-ghost-toggle").click();
  await expect(page.locator("#g-ghost")).toBeVisible();
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-review")).toBeVisible();
  await expect(page.locator("#g-review-a")).toBeVisible();
  await expect(page.locator("#g-ghost")).toBeHidden();
  const log = page.locator("#log");
  await expect(log).toContainText("run: light tests at 1 place(s)");
  await expect(log).toContainText("countdown: cancelled");
  await expect(log).toContainText("photo A: 1a-s1 #1 320x240 grey mean 127.5");
  await expect(log).toContainText("light check 1a-s1: ");

  // A retake is offered by the slot, and taken back by a second tap.
  await page.locator("#g-slot-b").click();
  await expect(page.locator("#g-primary-label")).toHaveText("Retake B");
  await page.locator("#g-slot-b").click();
  await expect(page.locator("#g-primary-label")).toHaveText("Next pair");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-head-pos")).toHaveText(/^Pair 2 of/);
  await expect(log).toContainText("next pair: ");

  await page.locator("#g-open-pairs").click();
  await expect(page.locator("#g-pair-grid button").first()).toContainText(
    /done|retake suggested/,
  );
  await page.locator("#g-go-end").click();
  await expect(page.locator("#g-end-kicker")).toHaveText(
    /^1 of \d+ pairs captured$/,
  );
  const state = page.locator("#g-download-state");
  await expect(state).toHaveText(
    "One zip with 1 pair, saved to this phone only.",
  );
  await expect(page.locator("#g-summary")).toHaveValue(/Pairs complete: 1 of/);
  await expect(page.locator("#g-summary")).toHaveValue(/not downloaded yet/);

  // A dismissed save dialog loses nothing and counts no download.
  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "cancel";
  });
  await page.locator("#g-download-all").click();
  await expect(state).toHaveText(
    "Not saved: the save dialog was closed. Nothing was lost.",
  );
  await expect(page.locator("#g-download-all")).toHaveText("Download all");

  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "save";
  });
  await page.locator("#g-download-all").click();
  await expect(state).toHaveText(/^Saved feature-match-run-.+\.zip \(/);
  await expect(state).toHaveClass(/ok/);
  await expect(page.locator("#g-download-all")).toHaveText("Download again");
  await expect(page.locator("#g-summary")).not.toHaveValue(
    /not downloaded yet/,
  );
  const zipName = /** @type {string} */ (
    await page.evaluate(
      () => Object.keys(/** @type {any} */ (window).__saved)[0],
    )
  );
  expect(zipName).toMatch(/^feature-match-run-.+\.zip$/);
  const { names, texts } = await zipContents(await savedBytes(page, zipName));
  expect(names).toHaveLength(5);
  const a = names.find((n) =>
    /^feature-match-01-1a-s1-.*-frame-a\.png$/.test(n),
  );
  const b = names.find((n) =>
    /^feature-match-01-1a-s1-.*-frame-b\.png$/.test(n),
  );
  const info = names.find((n) =>
    /^feature-match-01-1a-s1-.*-frames\.json$/.test(n),
  );
  expect(a && b && info).toBeTruthy();
  const frames = texts[/** @type {string} */ (info)] ?? "";
  expect(() => JSON.parse(frames)).not.toThrow();
  expect(frames).toContain(/** @type {string} */ (a));
  expect(frames).toContain(/** @type {string} */ (b));
  expect(texts["feature-match-summary.txt"]).toContain("Pairs complete: 1 of");
  expect(texts["feature-match-log.txt"]).toContain("photo B: 1a-s1 #1");
  expect(errors).toEqual([]);
});

/**
 * Download all through the link fallback; returns the zip's bytes.
 *
 * @param {import("@playwright/test").Page} page
 */
async function downloadAllBytes(page) {
  await page.locator("#g-open-pairs").click();
  await page.locator("#g-go-end").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#g-download-all").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^feature-match-run-.+\.zip$/);
  await expect(page.locator("#g-download-state")).toHaveText(/^Saved /);
  return readDownload(download);
}

/**
 * The bytes of the zip entry whose name matches `pattern`.
 *
 * @param {Buffer} zip
 * @param {RegExp} pattern
 */
async function zipEntryBytes(zip, pattern) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const entry = (await reader.getEntries()).find((e) =>
    pattern.test(e.filename),
  );
  if (!entry || entry.directory || !entry.getData) {
    throw new Error(`no ${String(pattern)} in the zip`);
  }
  const bytes = await entry.getData(new Uint8ArrayWriter());
  await reader.close();
  return Buffer.from(bytes);
}

/**
 * Why this test matters: without a save dialog (most phones) the zip
 * goes out through a download link, and the photos of the run live in
 * the page's database: after a reload the run continues where it was,
 * with the taken photos drawn again from storage. A photo taken after the
 * reload must get an id of its own: one handed out again would overwrite
 * a restored pair's photo in the zip (the camera is dimmed for it, so a
 * swapped photo has other pixels).
 */
test("the guided photo test downloads through a link and keeps its photos across a reload", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.addInitScript(() => {
    // Taken away on purpose: the save goes through a download link.
    delete (/** @type {any} */ (window).showSaveFilePicker);
  });
  await page.goto("/feature-match-check.html");
  await guidedFirstPair(page);
  const pair1A = /^feature-match-01-1a-s1-.*-frame-a\.png$/;
  const before = await zipEntryBytes(await downloadAllBytes(page), pair1A);
  await page.reload();
  await expect(page.locator("#g-run")).toBeVisible();
  await expect(page.locator("#g-intro")).toBeHidden();
  await expect(page.locator("#g-review-a")).toBeVisible();
  await expect(page.locator("#g-slot-b canvas")).toBeVisible();

  await page.locator("#g-primary").click();
  await expect(page.locator("#g-head-pos")).toHaveText(/^Pair 2 of/);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        /** @type {Window & Record<string, unknown>} */ (window).__dim = true;
        const video = /** @type {HTMLVideoElement} */ (
          document.querySelector("#g-video")
        );
        video.requestVideoFrameCallback(() =>
          video.requestVideoFrameCallback(() => resolve(undefined)),
        );
      }),
  );
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "true",
  );
  const zip = await downloadAllBytes(page);
  const { names } = await zipContents(zip);
  // Pair 2 holds only photo A, so the zip still holds pair 1 alone.
  expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(2);
  expect(names).toContain("feature-match-summary.txt");
  expect((await zipEntryBytes(zip, pair1A)).equals(before)).toBe(true);
});

/**
 * Why this test matters: the default capture path is the 3 s countdown,
 * one digit a second and then the photo; with the page clock driven by
 * the test it takes no real time and is proven to end in the photo.
 */
test("the guided countdown counts 3, 2, 1 and then takes the photo", async ({
  page,
}) => {
  await page.clock.install();
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-cam-chip")).toBeHidden();
  await page.locator("#g-primary").click();
  const num = page.locator("#g-count-num");
  await expect(num).toHaveText("3");
  await page.clock.runFor(1000);
  await expect(num).toHaveText("2");
  await page.clock.runFor(1000);
  await expect(num).toHaveText("1");
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "false",
  );
  await page.clock.runFor(1000);
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "true",
  );
  await expect(page.locator("#log")).toContainText("photo A: 1a-s1 #1 320x240");
  await expect(page.locator("#g-primary-label")).toHaveText("Capture B");
});

/**
 * Why this test matters: while the camera permission prompt is open the
 * finder must say the camera is starting, not that it is off.
 */
test("the guided finder says the camera is starting while it waits", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "hold");
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  const chip = page.locator("#g-cam-chip");
  await expect(chip).toHaveText("starting camera...");
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseCamera();
  });
  await expect(chip).toBeHidden();
});

/**
 * Why this test matters: leaving the run screen (the help) while the camera
 * permission prompt is still open stops that start; coming back must start
 * the camera again, not wait for a start that was stopped. The intro then
 * also names the countdown as it is set, not a fixed 3 s.
 */
test("the guided view starts the camera again after the help while the prompt was open", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "hold");
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  const chip = page.locator("#g-cam-chip");
  await expect(chip).toHaveText("starting camera...");
  await page.locator("#g-open-help").click();
  await expect(page.locator("#g-intro")).toBeVisible();
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-run")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      /** @type {any} */ (window).__releaseCamera();
    });
  }
  await expect(chip).toBeHidden();
  await expect(page.locator("#g-intro-still")).toContainText(
    "3 seconds after your tap",
  );
  await countdownOff(page);
  await page.locator("#g-open-help").click();
  await expect(page.locator("#g-intro-still")).toContainText(
    "the countdown is off",
  );
});

/**
 * Pair 1 complete with the countdown off, then the countdown back at 3 s
 * and photo A marked for a retake: the next tap starts a countdown on a
 * pair whose single files can be saved.
 *
 * @param {import("@playwright/test").Page} page
 */
async function retakeCountdownReady(page) {
  await guidedFirstPair(page);
  await page.locator("#g-open-pairs").click();
  await page.locator('#g-sheet-pairs [data-countdown="3"]').click();
  await page.locator("#g-close-pairs").click();
  await page.locator("#g-slot-a").click();
  await expect(page.locator("#g-primary-label")).toHaveText("Retake A");
}

/**
 * Why this test matters: a save that starts while a countdown runs makes
 * the page busy, and the reducer then refuses the next second and the
 * photo. A refused second must end the countdown (logged "refused"), not
 * leave a frozen digit; a refused photo at the end must say so in the
 * finder, not vanish in the log alone. The page clock drives the seconds;
 * the held save dialog keeps the page busy. The file button is clicked by
 * a dispatched event: it sits in the measure sheet, which a tester opens
 * from the end screen, and leaving the run screen would cancel the
 * countdown first; the event stands in for any save under a countdown.
 */
test("the guided countdown ends when the page turns busy under it", async ({
  page,
}) => {
  await page.clock.install();
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await savePicker(page);
  await page.goto("/feature-match-check.html");
  await retakeCountdownReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "hold";
  });

  // A refused second.
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count-num")).toHaveText("3");
  await page.locator("#g-file-a").dispatchEvent("click");
  await page.clock.runFor(1000);
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(page.locator("#log")).toContainText("countdown: refused");
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseSave();
  });
  await expect(page.locator("#g-primary")).toBeEnabled();

  // A refused photo at the end of the countdown.
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count-num")).toHaveText("3");
  await page.clock.runFor(2000);
  await expect(page.locator("#g-count-num")).toHaveText("1");
  await page.locator("#g-file-a").dispatchEvent("click");
  await page.clock.runFor(1000);
  await page.clock.runFor(10);
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(page.locator("#log")).toContainText(
    "capture: photo A of 1a-s1 refused",
  );
  await expect(page.locator("#g-shot-note")).toHaveText(
    "No photo A: the page was busy. Tap again.",
  );
});

/**
 * Why this test matters: Download all is the one file a tester sends, so
 * its failure path must be as clear as its success: while packing the
 * button says so and is off, a PNG that cannot be encoded ends in a
 * "Could not prepare the zip" line with the button back on, and the run
 * goes on (the next photo can still be taken). The canvas encoder is
 * replaced: held once, then answering null.
 */
test("the guided Download all shows packing, then a failure that loses nothing", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await savePicker(page);
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    const real = HTMLCanvasElement.prototype.toBlob;
    w.__toBlob = "ok";
    HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
      if (w.__toBlob === "hold") {
        w.__toBlob = "null";
        w.__releaseBlob = () => setTimeout(() => cb(null), 0);
        return;
      }
      if (w.__toBlob === "null") {
        setTimeout(() => cb(null), 0);
        return;
      }
      real.call(this, cb, ...rest);
    };
  });
  await page.goto("/feature-match-check.html");
  await guidedFirstPair(page);
  await page.locator("#g-open-pairs").click();
  await page.locator("#g-go-end").click();
  await page.evaluate(() => {
    /** @type {any} */ (window).__toBlob = "hold";
  });
  const button = page.locator("#g-download-all");
  await button.click();
  await expect(button).toHaveText("Preparing the zip...");
  await expect(button).toBeDisabled();
  // The label turns before the first PNG is encoded: wait for the held one.
  await page.waitForFunction(
    () => typeof (/** @type {any} */ (window).__releaseBlob) === "function",
  );
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseBlob();
  });
  const state = page.locator("#g-download-state");
  await expect(state).toHaveText(
    /^Could not prepare the zip: .*PNG encoding failed.*. Nothing was lost; try again.$/,
  );
  await expect(state).toHaveClass(/err/);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("Download all");
  await expect(page.locator("#log")).toContainText("ERROR download:");

  await page.locator("#g-end-back").click();
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-head-pos")).toHaveText(/^Pair 2 of/);
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-slot-a")).toHaveAttribute(
    "data-filled",
    "true",
  );
});

/**
 * Why this test matters: the measure sheet is where the guided view keeps
 * the benchmark. A run on the current pair must use the pair's two photos
 * and fill the moved Results, and the pair's matches file is offered only
 * after that run. With sift.js stubbed nothing is downloaded from outside.
 */
test("the guided measure sheet runs the benchmark on the current pair", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.addInitScript(() => {
    // Taken away on purpose: the save goes through a download link.
    delete (/** @type {any} */ (window).showSaveFilePicker);
  });
  await page.goto("/feature-match-check.html");
  await guidedFirstPair(page);
  await page.locator("#g-open-pairs").click();
  await page.locator("#g-go-end").click();
  await page.locator("#g-open-measure").click();
  await expect(page.locator("#g-sheet-measure #options")).toBeAttached();
  await expect(page.locator("#g-sheet-measure #run-synthetic")).toBeVisible();
  await expect(page.locator("#g-measure-state")).toHaveText(
    "pair 1a-s1: photos A and B ready",
  );
  await expect(page.locator("#g-file-matches")).toBeDisabled();
  await chooseSiftOnly(page);
  await page.locator("#g-measure-run").click();
  await expect(page.locator("#g-measure-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#results tbody tr")).toHaveCount(1);
  // On a phone a results table wider than the sheet scrolls in its own
  // box, its header with it, and the page never scrolls sideways.
  const t = await page.evaluate(() => {
    const wrap = /** @type {HTMLElement} */ (
      document.querySelector("#g-sheet-measure .table-wrap")
    );
    const head = /** @type {HTMLElement} */ (
      document.querySelector("#results thead")
    );
    return {
      inWrap: wrap.contains(head),
      overflowX: getComputedStyle(wrap).overflowX,
      pageW: document.documentElement.scrollWidth,
    };
  });
  expect(t.inWrap).toBe(true);
  expect(t.overflowX).toBe("auto");
  expect(t.pageW).toBeLessThanOrEqual(412);
  await expect(page.locator("#g-file-matches")).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#g-file-matches").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^feature-match-01-1a-s1-.*-matches\.json$/,
  );
  await expect(page.locator("#g-files-state")).toHaveText(/^saved /);
});

/**
 * Why this test matters: the guided run screen is laid out for a phone
 * held upright, a phone on its side and a desktop window, as in the chosen
 * prototype (whose boxes these numbers are, measured side by side). Upright,
 * header, step card, viewfinder and action bar stack in one column; wider,
 * the viewfinder takes the right side. The edges, the 10 px gaps and the
 * thumb-sized big button are pinned, the page must not scroll sideways,
 * and the step chip carries the colour of the photo that is due.
 */
for (const vp of [
  { width: 412, height: 915 },
  { width: 915, height: 412 },
  // A common Android phone on its side, shorter than 915x412.
  { width: 800, height: 360 },
  { width: 880, height: 790 },
]) {
  test(`the guided run screen fits ${String(vp.width)}x${String(vp.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await routeNetwork(page, fulfillSift);
    await fakeCamera(page);
    await page.goto("/feature-match-check.html");
    await page.locator("#g-intro-start").click();
    await expect(page.locator("#g-cam-chip")).toBeHidden();
    const m = await page.evaluate(() => {
      const box = (/** @type {string} */ sel) => {
        const e = /** @type {Element} */ (document.querySelector(sel));
        const r = e.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          height: r.height,
        };
      };
      return {
        head: box("#g-run .run-head"),
        card: box("#g-run .card"),
        finder: box("#g-finder"),
        actions: box("#g-run .actions"),
        primary: box("#g-primary"),
        seqB: box("#g-seq-b"),
        foot: box("#g-run .foot-lines"),
        chip: getComputedStyle(
          /** @type {Element} */ (document.querySelector("#g-card-shot")),
        ).backgroundColor,
        scrollW: document.documentElement.scrollWidth,
      };
    });
    const near = (/** @type {number} */ got, /** @type {number} */ want) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
    const { head, card, finder, actions, primary, seqB, foot } = m;
    near(head.left, 16);
    near(head.top, 12);
    near(card.top - head.bottom, 10);
    near(card.left, 16);
    near(actions.left, 16);
    near(actions.bottom, vp.height - 12);
    near(primary.height, 92);
    if (vp.width < vp.height) {
      // One column: card, viewfinder, action bar, 10 px apart.
      for (const r of [head, card, finder, actions]) {
        near(r.right, vp.width - 16);
      }
      near(finder.top - card.bottom, 10);
      near(actions.top - finder.bottom, 10);
    } else {
      // The viewfinder on the right, the column beside it.
      near(actions.top - card.bottom, 10);
      near(finder.left - card.right, 10);
      near(finder.right, vp.width - 16);
      near(finder.top, 12);
      near(finder.bottom, vp.height - 12);
    }
    // The step card's whole sequence is on screen, inside the card and
    // above the action bar, and the foot lines sit below it, not over it
    // (a phone on its side once clipped "then" and B).
    expect(seqB.bottom).toBeLessThanOrEqual(card.bottom + 0.5);
    expect(seqB.bottom).toBeLessThanOrEqual(actions.top + 0.5);
    expect(foot.top).toBeGreaterThanOrEqual(seqB.bottom - 0.5);
    expect(foot.bottom).toBeLessThanOrEqual(card.bottom + 0.5);
    expect(m.scrollW).toBeLessThanOrEqual(vp.width);
    expect(m.chip).not.toBe("rgba(0, 0, 0, 0)");
  });
}
