// @ts-check
import { expect, test } from "@playwright/test";
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
    "spot",
  ]);
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
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
for (const gpu of [true, false]) {
  test(`the feature matching benchmark runs a photo test pair with its own settings (${gpu ? "WebGPU" : "no WebGPU"})`, async ({
    page,
  }) => {
    await routeNetwork(page, fulfillSift);
    await fakeCamera(page);
    await page.addInitScript((hasGpu) => {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: hasGpu ? { requestAdapter: async () => null } : undefined,
      });
    }, gpu);
    await page.goto("/feature-match-check.html");
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
  await page.goto("/feature-match-check.html");
  await expect(page.locator("#log")).toContainText("ready");
  await chooseSiftOnly(page);
  await page.locator("#pair").selectOption("1b");
  await takePhotos(page);
  await expect(page.locator("#light-warning")).toHaveText(
    "Photo B is not darker than photo A - the light has to change BETWEEN the two photos. Take this pair again: photo A in normal light, then dim, then photo B.",
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

  // The control pair: A in the normal light, B dimmed, is a changed light.
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
