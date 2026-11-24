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
 * "hold" keeps each start pending until `window.__releaseCamera()`, which
 * releases the oldest start still pending.
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
    /** @type {(() => void)[]} */
    const held = [];
    w.__releaseCamera = () => held.shift()?.();
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
              held.push(() => resolve(open()));
            });
          }
          return Promise.resolve(open());
        },
      },
    });
  }, mode);
}

/**
 * Dims the fake camera (or lights it again with `dim` false) and waits
 * until the cockpit's video shows a frame painted after it (the stream lags
 * the canvas by a frame or two). The camera must be on.
 *
 * @param {import("@playwright/test").Page} page
 * @param {boolean} [dim]
 */
async function dimCamera(page, dim = true) {
  await page.evaluate(
    (d) =>
      new Promise((resolve) => {
        /** @type {Window & Record<string, unknown>} */ (window).__dim = d;
        const video = /** @type {HTMLVideoElement} */ (
          document.querySelector("#c-video")
        );
        video.requestVideoFrameCallback(() =>
          video.requestVideoFrameCallback(() => resolve(undefined)),
        );
      }),
    dim,
  );
}

/** @param {import("@playwright/test").Page} page */
async function pageOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

const COCKPIT = "/feature-match-check.html?ui=cockpit";

/** @param {import("@playwright/test").Page} page */
async function openCockpit(page) {
  await page.goto(COCKPIT);
  await expect(page.locator("#log")).toContainText("ready");
}

/**
 * Without a save dialog (most phones) a zip goes out through a download
 * link, which the test can catch.
 *
 * @param {import("@playwright/test").Page} page
 */
async function noSavePicker(page) {
  await page.addInitScript(() => {
    delete (/** @type {any} */ (window).showSaveFilePicker);
  });
}

/**
 * Opens the Details drawer on `tab`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {"pairs" | "guide" | "results" | "settings"} tab
 */
async function openTab(page, tab) {
  if (await page.locator("#c-drawer").isHidden()) {
    await page.locator("#c-details").click();
  }
  await page.locator(`#c-drawer [data-tab="${tab}"]`).click();
  await expect(page.locator(`#c-drawer [data-panel="${tab}"]`)).toBeVisible();
}

/** @param {import("@playwright/test").Page} page */
async function closeDrawer(page) {
  await page.locator("#c-drawer-close").click();
  await expect(page.locator("#c-drawer")).toBeHidden();
}

/**
 * The Settings tab: how a shot is taken (by itself where the motion sensor
 * can judge it, or at a tap) and the countdown (off by default here, so
 * each tap shoots at once).
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ capture?: "auto" | "tap", countdown?: "0" | "3" | "5" }} [o]
 */
async function cockpitSettings(
  page,
  { capture = "auto", countdown = "0" } = {},
) {
  await openTab(page, "settings");
  await page.locator(`input[name="c-capture"][value="${capture}"]`).check();
  await page.locator(`input[name="c-countdown"][value="${countdown}"]`).check();
  await closeDrawer(page);
}

/**
 * Takes the current shot `key` with the big button (the camera started
 * first when it is off) and waits until the button no longer offers it:
 * the next shot came up, or the shot waits for a retake.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} key
 */
async function takeShot(page, key) {
  const shutter = page.locator("#c-shutter");
  const text = page.locator("#c-shutter-text");
  await expect(page.locator("#c-chip-key")).toHaveText(key);
  await expect(text).toHaveText(new RegExp(`^(Start|Take ${key})$`));
  if ((await text.textContent()) === "Start") {
    await shutter.click();
  }
  await expect(text).toHaveText(`Take ${key}`);
  // The camera counts as on before its first picture arrives.
  await page.waitForFunction(
    () =>
      /** @type {HTMLVideoElement} */ (document.querySelector("#c-video"))
        .videoWidth > 0,
  );
  await shutter.click();
  await expect(text).not.toHaveText(`Take ${key}`);
}

/**
 * A shot's photo in the run zip: `shots/<scene>/<key>-t<take>.png`.
 *
 * @param {string} shot the shot id, as `light-s1/L1`
 * @param {number} [take]
 */
const shotPng = (shot, take = 1) => `shots/${shot}-t${String(take)}.png`;

/**
 * A ready pair's frames JSON in the run zip.
 *
 * @param {string} pair the derived pair id, as `light-s1/L1-L2`
 */
const pairJson = (pair) => `pairs/${pair}/feature-match-frames.json`;

/**
 * A measured pair's matches JSON in the run zip.
 *
 * @param {string} pair the derived pair id, as `light-s1/L1-L2`
 */
const matchesJson = (pair) => `pairs/${pair}/feature-match-matches.json`;

/**
 * Keeps the time of every frame the cockpit's video shows
 * (`requestVideoFrameCallback`) in `window.__frames`, so a test can read
 * the frame gaps while the measuring worker runs.
 *
 * @param {import("@playwright/test").Page} page
 */
async function recordFrames(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__frames = [];
    const hook = () => {
      const video = /** @type {HTMLVideoElement | null} */ (
        document.querySelector("#c-video")
      );
      if (!video) {
        requestAnimationFrame(hook);
        return;
      }
      /** @param {number} now */
      const onFrame = (now) => {
        w.__frames.push(now);
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    };
    hook();
  });
}

/**
 * The p95, p99 and largest gap (ms) between the frame times in [from, to].
 *
 * @param {number[]} frames
 * @param {number} from
 * @param {number} to
 */
function gapStats(frames, from, to) {
  const inside = frames.filter((f) => f >= from && f <= to);
  const gaps = inside
    .slice(1)
    .map((f, i) => f - /** @type {number} */ (inside[i]));
  const sorted = [...gaps].sort((a, b) => a - b);
  /** @param {number} q */
  const at = (q) =>
    Math.round(
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0,
    );
  return {
    frames: inside.length,
    p95: at(0.95),
    p99: at(0.99),
    max: Math.round(sorted.at(-1) ?? 0),
  };
}

/**
 * Makes the page's IndexedDB reads of photos controllable, as a phone
 * whose stored photos cannot be read: `window.__photoReads` "ok" reads
 * them, "hold" keeps the next photo read waiting until
 * `window.__releaseRead()` (and fails every later one), "fail" aborts
 * each photo read.
 *
 * @param {import("@playwright/test").Page} page
 */
async function controlPhotoReads(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    const realGet = IDBObjectStore.prototype.get;
    w.__photoReads = "ok";
    IDBObjectStore.prototype.get = function (key) {
      const request = realGet.call(this, key);
      if (!String(key).startsWith("photo:") || w.__photoReads === "ok") {
        return request;
      }
      const tx = this.transaction;
      if (w.__photoReads === "hold") {
        w.__photoReads = "fail";
        // The reader's completion handler is kept until the test lets go.
        Object.defineProperty(tx, "oncomplete", {
          configurable: true,
          set(fn) {
            w.__releaseRead = () => fn.call(tx, new Event("complete"));
          },
        });
        return request;
      }
      tx.abort();
      return request;
    };
  });
}

/**
 * Waits until the page's database holds a log with `part` in it. Polled
 * through `page.evaluate`, which awaits the read: `waitForFunction` would
 * take the returned promise itself as a truthy answer and not wait.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} part
 */
async function storedLogHas(page, part) {
  const storedLog = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("feature-match-check-photos");
          open.onerror = () => resolve("");
          open.onsuccess = () => {
            const db = open.result;
            const get = db
              .transaction("photos", "readonly")
              .objectStore("photos")
              .get("log");
            get.onsuccess = () => {
              db.close();
              resolve(typeof get.result === "string" ? get.result : "");
            };
            get.onerror = () => {
              db.close();
              resolve("");
            };
          };
        }),
    );
  await expect.poll(storedLog).toContain(part);
}

/**
 * The JSON of the zip entry named `pattern` (or whose name matches it).
 *
 * @param {Buffer} zip
 * @param {RegExp | string} pattern
 */
async function zipJson(zip, pattern) {
  return JSON.parse((await zipEntryBytes(zip, pattern)).toString("utf8"));
}

/**
 * The file entries of a zip (folders left out).
 *
 * @param {Buffer} zip
 */
async function zipFiles(zip) {
  return (await zipContents(zip)).names.filter((n) => !n.endsWith("/"));
}

/**
 * The number of log lines holding `part`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} part
 */
async function logLines(page, part) {
  return ((await page.locator("#log").textContent()) ?? "")
    .split("\n")
    .filter((l) => l.includes(part)).length;
}

/**
 * Why this test matters: the benchmark page is opened on a phone from a
 * branch preview and is linked from nothing, so no other test opens it.
 * With sift.js replaced by a stub (no network), it proves the page loads,
 * fits a phone's width, runs the synthetic pair through the whole loop
 * from the Results tab, fills the table, the copyable report and a result
 * picture, and that its button shows its running and final states. The
 * real methods and their timings need the phone and are not tested here.
 */
test("the feature matching benchmark runs a stubbed SIFT on the synthetic pair", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await page.setViewportSize({ width: 360, height: 740 });
  await openCockpit(page);
  await openTab(page, "results");
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
  // The synthetic run is not a shot: the dock stays on L1.
  await expect(page.locator("#c-chip-key")).toHaveText("L1");

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
  await openCockpit(page);
  await openTab(page, "results");
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
 * Why this test matters: the cockpit walks the run one shot at a time so no
 * shot can be forgotten on the phone: after each photo the next shot comes
 * up by itself, any shot can be picked from the Shots tab, and nothing is
 * measured on the phone. Download all is the one file handed over: it
 * holds a folder per ready pair (here L1-L2, then F1-F2 and the three
 * synthetic turns of F2 against F1), each with its two photos and a frames
 * JSON naming the legacy key the PC side reads, plus the summary and the
 * log. The photos must be exactly the captured pixels with nothing but
 * pixels (no EXIF, text or time chunk), and the turned pairs carry the
 * full photos with the turn and the centre squares named, never a cropped
 * or turned copy. Nothing is uploaded: every request leaving the machine
 * is refused.
 */
test("the feature matching cockpit walks the shots by itself and saves every ready pair in one zip", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  let siftLoads = 0;
  await routeNetwork(page, (route) => {
    siftLoads += 1;
    return fulfillSift(route);
  });
  await fakeCamera(page);
  await recordFrames(page);
  await noSavePicker(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await openCockpit(page);
  const all = page.locator("#c-download-all");
  await expect(all).toBeDisabled();
  await cockpitSettings(page);

  await takeShot(page, "L1");
  // The next shot comes up by itself, the one before it on the left tile.
  await expect(page.locator("#c-chip-key")).toHaveText("L2");
  await expect(page.locator("#c-state-a")).toHaveText("L1");
  await expect(page.locator("#c-progress-text")).toHaveText("1 / 13");
  // The baseline frame gaps: the camera on, no pair ready, the worker idle.
  const frames = () =>
    page.evaluate(
      () => /** @type {number[]} */ (/** @type {any} */ (window).__frames),
    );
  const clock = () => page.evaluate(() => performance.now());
  await expect.poll(async () => (await frames()).length).toBeGreaterThan(60);
  const firstPair = await clock();
  // No pair is ready yet, so nothing has loaded sift.js: every load the
  // counter sees later is the worker's, through the page's routes.
  expect(siftLoads).toBe(0);
  await takeShot(page, "L2");
  await expect(page.locator("#c-chip-key")).toHaveText("L3");
  await expect(page.locator("#log")).toContainText(
    "light check light-s1/L2: ok",
  );
  // Before a dimmed shot the dock goes dark: it must not light the room.
  await expect(page.locator("#cockpit")).toHaveClass(/night/);
  await expect(all).toHaveText("Download all (1)");

  // The flat scene's first shot from the Shots tab; F2 comes up by itself.
  await openTab(page, "pairs");
  await page.locator('#c-pair-list button[data-index="4"]').click();
  await expect(page.locator("#c-drawer")).toBeHidden();
  await takeShot(page, "F1");
  await takeShot(page, "F2");
  await expect(page.locator("#c-chip-key")).toHaveText("F3");
  await expect(all).toHaveText("Download all (5)");
  // The five ready pairs are measured in the worker beside the running
  // camera, which keeps showing frames; the measuring block's own table
  // stays empty.
  await expect.poll(() => logLines(page, ": done in")).toBe(5);
  const drained = await clock();
  await expect
    .poll(async () => (await frames()).at(-1) ?? 0)
    .toBeGreaterThan(drained);
  const all3 = await frames();
  const gaps = {
    baseline: gapStats(all3, 0, firstPair),
    measuring: gapStats(all3, firstPair, drained),
  };
  // The frame gaps are only logged, not judged: the fake camera in a
  // headless browser under load has no usable baseline, so whether the
  // preview stays smooth is judged on the phone.
  console.log(`frame gaps (ms): ${JSON.stringify(gaps)}`);
  expect(gaps.measuring.frames).toBeGreaterThan(10);
  await expect(page.locator("#results tbody tr")).toHaveCount(0);
  // The worker's import of sift.js went through the page's routes too, so
  // nothing left the machine (the zip's matches carry the stub's 40
  // keypoints, below).
  expect(siftLoads).toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    all.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^feature-match-run-[0-9a-f]{8}\.zip$/,
  );
  await expect(page.locator("#c-status")).toHaveText(
    /^Saved feature-match-run-.+\.zip \(.+\)\. Send this file\.$/,
  );
  const bytes = await readDownload(download);
  // Each shot once, then a frames JSON per ready pair naming its shots.
  expect(await zipFiles(bytes)).toEqual([
    shotPng("light-s1/L1"),
    shotPng("light-s1/L2"),
    shotPng("flat-s1/F1"),
    shotPng("flat-s1/F2"),
    pairJson("light-s1/L1-L2"),
    matchesJson("light-s1/L1-L2"),
    pairJson("flat-s1/F1-F2"),
    matchesJson("flat-s1/F1-F2"),
    pairJson("flat-s1/F1-T0"),
    matchesJson("flat-s1/F1-T0"),
    pairJson("flat-s1/F1-T90"),
    matchesJson("flat-s1/F1-T90"),
    pairJson("flat-s1/F1-T180"),
    matchesJson("flat-s1/F1-T180"),
    "feature-match-summary.txt",
    "feature-match-log.txt",
  ]);

  for (const shot of ["light-s1/L1", "light-s1/L2", "flat-s1/F1"]) {
    const png = await zipEntryBytes(bytes, shotPng(shot));
    const types = chunkTypes(png);
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    expect(
      types.filter(
        (t) =>
          !["IHDR", "sRGB", "gAMA", "cHRM", "iCCP", "IDAT", "IEND"].includes(t),
      ),
    ).toEqual([]);
    // IHDR: the captured size, unchanged.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 240]);
  }

  const light = await zipJson(bytes, pairJson("light-s1/L1-L2"));
  expect(light).toMatchObject({
    format: "feature-match-frames/2",
    pair: "1a",
    derivedPair: "light-s1/L1-L2",
    spot: 1,
    lightCheck: "ok",
    kind: "real",
    axis: "light",
    frames: [
      { name: "A", shot: "light-s1/L1", take: 1, file: shotPng("light-s1/L1") },
      { name: "B", shot: "light-s1/L2", take: 1, file: shotPng("light-s1/L2") },
    ],
  });
  expect(light.session).toMatch(/^[0-9a-f]{8}$/);
  expect(light.turn).toBeUndefined();
  expect(
    light.frames.map((/** @type {{ width: number }} */ f) => f.width),
  ).toEqual([320, 320]);

  const turn = await zipJson(bytes, pairJson("flat-s1/F1-T90"));
  expect(turn).toMatchObject({
    pair: "t90",
    kind: "turn90",
    frames: [{ shot: "flat-s1/F1" }, { shot: "flat-s1/F2" }],
    turn: { degrees: 90, direction: "cw" },
  });
  expect(turn.frames[1].crop).toEqual(turn.frames[0].crop);
  // The worker measured the turned pair on the 240 px centre squares, beside
  // the camera; SIFT ran, ALIKED's runtime could not load (no network).
  const measured = await zipJson(bytes, matchesJson("flat-s1/F1-T90"));
  expect(measured.frames.B).toMatchObject({
    file: shotPng("flat-s1/F2"),
    width: 240,
    height: 240,
  });
  expect(measured.measured).toMatchObject({ context: "beside-camera" });
  expect(
    measured.methods.find((/** @type {{ id: string }} */ m) => m.id === "sift")
      ?.error,
  ).toBeNull();
  // The worker ran the routed stub, not a real sift.js: its 40 keypoints.
  const lightMeasured = await zipJson(bytes, matchesJson("light-s1/L1-L2"));
  expect(
    lightMeasured.methods.find(
      (/** @type {{ id: string }} */ m) => m.id === "sift",
    )?.sizes[0]?.keypointsA,
  ).toHaveLength(40);
  // The browser was asked once to keep the stored photos.
  expect(await logLines(page, "storage persist: ")).toBe(1);

  // Grey values of the half black, half white camera: 127.5, within what
  // the stream's colour conversion may move them.
  const log = (await page.locator("#log").textContent()) ?? "";
  const grey = log.match(
    /photo light-s1\/L1 take 1: 320x240 grey mean (\d+\.\d)/,
  );
  expect(grey).not.toBeNull();
  expect(Math.abs(Number(grey?.[1]) - 127.5)).toBeLessThanOrEqual(6);
  const { texts } = await zipContents(bytes);
  expect(texts["feature-match-summary.txt"]).toContain("Pairs ready: 5 of");
  expect(texts["feature-match-summary.txt"]).toContain(
    "Pairs measured on this phone: 5, failed: 0, pending (to be measured on the PC): 0",
  );
  expect(texts["feature-match-log.txt"]).toContain("download: 5 pairs as");
  expect(errors).toEqual([]);
});

/**
 * Starts synthetic `devicemotion` readings at about 60 a second with the
 * rotation rate `rate` (deg/s per axis); a new call replaces the old feed,
 * and `null` stops it, as a sensor that falls silent.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number | null} rate
 */
async function motionFeed(page, rate) {
  await page.evaluate((r) => {
    const w = /** @type {any} */ (window);
    clearInterval(w.__motionFeed);
    if (r === null) {
      return;
    }
    w.__motionFeed = setInterval(() => {
      w.__motionCount = (w.__motionCount ?? 0) + 1;
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          rotationRate: { alpha: r, beta: -r, gamma: r / 2 },
        }),
      );
    }, 16);
  }, rate);
}

/**
 * Waits until the feed has sent `n` more readings (about 16 ms each).
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} n
 */
async function motionReadings(page, n) {
  const from = await page.evaluate(
    () => /** @type {any} */ (window).__motionCount ?? 0,
  );
  await page.waitForFunction(
    (f) => /** @type {any} */ (window.__motionCount ?? 0) >= f,
    from + n,
  );
}

/**
 * Why this test matters: with the phone on its stand, a still shot the
 * motion sensor can judge (L2 here) takes itself once the phone has rested
 * for the dwell, so the tap that shook the phone for L1 never blurs L2;
 * the run then moves on as after a tap. A shaking phone keeps it waiting,
 * and the open drawer pauses the wait. The motion is synthetic
 * `devicemotion` events.
 */
test("the feature matching cockpit takes a still shot by itself once the phone rests", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await openCockpit(page);
  await cockpitSettings(page);
  await takeShot(page, "L1");
  const text = page.locator("#c-shutter-text");
  await expect(text).toHaveText("Take L2");
  await motionFeed(page, 40);
  await expect(text).toHaveText("Hold still");
  await expect(page.locator("#c-read-mode")).toHaveText("auto");
  const status = page.locator("#c-status");
  await expect(status).toHaveText(
    "Hold still, or tap: the photo takes itself.",
  );
  await expect(page.locator("#c-read-still")).toHaveText("moving");
  await expect(page.locator("#c-state-b")).toHaveText("now");
  // About 2.5 s of shaking: L2 keeps waiting.
  await motionReadings(page, 150);
  await expect(text).toHaveText("Hold still");
  expect(await logLines(page, "hands-off shot")).toBe(0);
  // The drawer pauses the wait for as long; closing it waits again, and
  // the pause does not count as readings lost.
  await openTab(page, "settings");
  await motionReadings(page, 150);
  await closeDrawer(page);
  await expect(text).toHaveText("Hold still");
  await expect(status).toHaveText(
    "Hold still, or tap: the photo takes itself.",
  );
  await motionFeed(page, 0.3);
  // L2 is taken and L3 comes up at once, so the durable end state is the
  // chip, not tile B.
  await expect(page.locator("#c-chip-key")).toHaveText("L3");
  await motionFeed(page, null);
  expect(await logLines(page, "hands-off shot: taken")).toBe(1);
  await expect(page.locator("#log")).toContainText(
    "light check light-s1/L2: ok",
  );
  await expect(page.locator("#c-segs i").nth(1)).toHaveClass("kept");
});

/**
 * Why this test matters: the ways out of a hands-off wait. With "At a
 * tap" set, readings never start one; a sensor that falls silent ends the
 * wait with a line that says so, and the big button takes the shot at a
 * tap.
 */
test("the feature matching cockpit falls back to the tap when motion readings stop", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await openCockpit(page);
  await cockpitSettings(page, { capture: "tap" });
  await takeShot(page, "L1");
  const text = page.locator("#c-shutter-text");
  await motionFeed(page, 0.3);
  await expect(page.locator("#c-read-still")).toHaveText("steady");
  await expect(text).toHaveText("Take L2");
  await expect(page.locator("#c-read-mode")).toHaveText("tap");

  // Back to "By itself": the wait starts once the drawer closes.
  await openTab(page, "settings");
  await page.locator('input[name="c-capture"][value="auto"]').check();
  await motionFeed(page, 40);
  await closeDrawer(page);
  await expect(text).toHaveText("Hold still");
  await motionFeed(page, null);
  const status = page.locator("#c-status");
  await expect(status).toHaveText("No motion readings: tap to take the photo.");
  await expect(status).toHaveClass(/bad/);
  await expect(text).toHaveText("Take L2");
  await page.locator("#c-shutter").click();
  await expect(page.locator("#c-chip-key")).toHaveText("L3");
  expect(await logLines(page, "hands-off shot")).toBe(0);
});

/**
 * Why this test matters: the async rule for Download all, the one file a
 * tester sends: while the zip is prepared the big button says so and
 * nothing else can start, and a failed encode (a phone out of memory) must
 * say so in red, log the error and lose nothing: the next try packs the
 * same photos. The zip reads the photos from storage, so a storage read
 * is held once, then fails until set back.
 */
test("the feature matching cockpit shows Download all preparing, then a failure that loses nothing", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await noSavePicker(page);
  await controlPhotoReads(page);
  await openCockpit(page);
  await cockpitSettings(page);
  await takeShot(page, "L1");
  await takeShot(page, "L2");
  await page.evaluate(() => {
    /** @type {any} */ (window).__photoReads = "hold";
  });
  const all = page.locator("#c-download-all");
  await all.click();
  await expect(page.locator("#c-shutter-text")).toHaveText("Saving");
  await expect(page.locator("#c-shutter")).toBeDisabled();
  await expect(all).toBeDisabled();
  await page.waitForFunction(
    () => typeof (/** @type {any} */ (window).__releaseRead) === "function",
  );
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseRead();
  });
  const status = page.locator("#c-status");
  await expect(status).toContainText(
    "Could not prepare the zip: Error: the photo",
  );
  await expect(status).toContainText("Nothing was lost; try again.");
  await expect(status).toHaveClass(/bad/);
  await expect(page.locator("#log")).toContainText("ERROR download:");
  await expect(all).toBeEnabled();

  await page.evaluate(() => {
    /** @type {any} */ (window).__photoReads = "ok";
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    all.click(),
  ]);
  const files = await zipFiles(await readDownload(download));
  expect(files.filter((f) => f.startsWith("shots/"))).toEqual([
    shotPng("light-s1/L1"),
    shotPng("light-s1/L2"),
  ]);
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
  await openCockpit(page);
  await page.locator("#c-shutter").click();
  await expect(page.locator("#c-shutter-text")).toHaveText("Retry camera");
  await expect(page.locator("#c-status")).toHaveText(
    "Camera unavailable: tap Retry camera.",
  );
  await page.locator("#c-shutter").click();
  await expect.poll(() => logLines(page, "ERROR camera:")).toBe(2);
});

test("the feature matching benchmark says when the camera is refused", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "reject");
  await openCockpit(page);
  await page.locator("#c-shutter").click();
  await expect(page.locator("#c-shutter-text")).toHaveText("Retry camera");
  await expect(page.locator("#log")).toContainText(
    "ERROR camera: NotAllowedError",
  );
  await expect(page.locator("#c-shutter")).toBeEnabled();
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
  await openCockpit(page);
  await page.locator("#c-shutter").click();
  await expect(page.locator("#c-shutter-text")).toHaveText("Starting");
  await expect(page.locator("#c-status")).toHaveText("Starting the camera...");
  await openTab(page, "results");
  await chooseSiftOnly(page);
  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText("done: 1 methods");
  await page.evaluate(() =>
    /** @type {() => void} */ (
      /** @type {Window & Record<string, unknown>} */ (window).__releaseCamera
    )(),
  );
  await expect(page.locator("#c-shutter-text")).toHaveText("Start");
  const state = await page.evaluate(() => {
    const w = /** @type {Window & Record<string, unknown>} */ (window);
    const s = /** @type {MediaStream} */ (w.__lastStream);
    return {
      video: /** @type {HTMLVideoElement} */ (
        document.querySelector("#c-video")
      ).srcObject,
      tracks: s.getTracks().map((t) => t.readyState),
    };
  });
  expect(state.video).toBeNull();
  expect(state.tracks).toEqual(["ended"]);
});

/**
 * Why this test matters: the photo tests are taken from what the page says
 * on the phone. The welcome card with the general rules shows on the first
 * visit only; the Guide tab always shows the current shot's purpose,
 * numbered steps and what to avoid, and follows a shot picked in the
 * Shots tab; the countdown can be stopped; the Options and Copy log say
 * they are not part of the photo tests; Escape closes the drawer.
 */
test("the feature matching benchmark guides each shot and the first visit", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await openCockpit(page);

  await expect(page.locator("#c-welcome")).toBeVisible();
  await expect(page.locator("#c-welcome-list")).toContainText(
    "Lock the screen rotation. Do not zoom.",
  );
  await expect(page.locator("#c-welcome-list li")).toHaveCount(6);
  await expect(page.locator("#c-status")).toHaveText(
    "First time here? Read the card, then tap Start.",
  );

  await expect(page.locator("#c-chip-key")).toHaveText("L1");
  await openTab(page, "guide");
  await expect(page.locator("#c-guide-title")).toHaveText("L1: Normal light");
  await expect(page.locator("#c-guide-purpose")).toHaveText(
    "The reference the other light shots are matched against.",
  );
  await expect(page.locator("#c-guide-steps li").last()).toHaveText(
    "Light ON as normal. Capture.",
  );
  await expect(page.locator("#c-guide-avoid")).toHaveText(
    "Avoid: Moving the phone between the light shots.",
  );
  await expect(page.locator("#c-guide-spot")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#c-drawer")).toBeHidden();

  await openTab(page, "pairs");
  await page
    .locator("#c-pair-list button", { hasText: "Turn the phone" })
    .click();
  await expect(page.locator("#c-drawer")).toBeHidden();
  await expect(page.locator("#c-chip-key")).toHaveText("F3");
  await openTab(page, "guide");
  await expect(page.locator("#c-guide-purpose")).toHaveText(
    "Does a method cope with a turned picture?",
  );
  await expect(page.locator("#c-guide-steps li").last()).toHaveText(
    "Capture turned.",
  );
  await expect(page.locator("#c-guide-spot")).toBeHidden();

  await openTab(page, "results");
  await expect(page.locator("#options-note")).toContainText(
    "These options apply to the synthetic run.",
  );
  await expect(page.locator("#copy-note")).toHaveText(
    "Not needed for the photo tests - the zip already contains the log. Use it to paste a quick timing run into a chat.",
  );
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await closeDrawer(page);

  // The default countdown: 3 s, and a second tap stops it.
  const shutter = page.locator("#c-shutter");
  const text = page.locator("#c-shutter-text");
  await shutter.click();
  await expect(page.locator("#c-welcome")).toBeHidden();
  await expect(text).toHaveText("F3 in 3 s");
  await shutter.click();
  await expect(text).toHaveText("Tap to stop");
  await shutter.click();
  await expect(text).toHaveText("F3 in 3 s");
  await expect(page.locator("#log")).toContainText("countdown: cancelled");
  await expect(page.locator("#c-state-b")).toHaveText("now");

  await page.reload();
  await expect(page.locator("#log")).toContainText("ready");
  await expect(page.locator("#c-welcome")).toBeHidden();
  await expect(page.locator("#c-chip-key")).toHaveText("F3");
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: on the first evening the light was dimmed before
 * the first photo, so the dimmed photos matched equally dark ones and
 * measured nothing about light. A light shot whose light did not change as
 * it needs (L2 must keep L1's light, L3 must be darker) must say so in the
 * dock and the Results tab and stay for its retake, never move on; the
 * retaken photos are what Download all saves, with the take counted in
 * the frames JSON and the retakes in the summary.
 */
test("the feature matching cockpit holds a light shot whose light did not change as it needs", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await noSavePicker(page);
  await openCockpit(page);
  await cockpitSettings(page);
  const shutter = page.locator("#c-shutter");
  const text = page.locator("#c-shutter-text");
  const chip = page.locator("#c-chip-key");
  await takeShot(page, "L1");

  // L2 is the control: a dimmed L2 is a changed light.
  await dimCamera(page);
  await shutter.click();
  await expect(page.locator("#log")).toContainText(
    "light check light-s1/L2: changed",
  );
  await expect(text).toHaveText("Retake L2");
  await expect(chip).toHaveText("L2");
  await expect(page.locator("#c-instr")).toContainText(
    "The light changed since L1. Retake with the same light.",
  );
  await expect(page.locator("#c-read-light")).toHaveText("light changed");
  await openTab(page, "results");
  await expect(page.locator("#c-light-warn")).toContainText(
    "The light changed since L1.",
  );
  await closeDrawer(page);
  await dimCamera(page, false);
  await shutter.click();
  await expect(chip).toHaveText("L3");

  // L3 whose photo is not darker than L1.
  await expect(text).toHaveText("Take L3");
  await shutter.click();
  await expect(page.locator("#log")).toContainText(
    "light check light-s1/L3: not-darker",
  );
  await expect(text).toHaveText("Retake L3");
  await expect(chip).toHaveText("L3");
  await dimCamera(page);
  await shutter.click();
  await expect(chip).toHaveText("L4");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#c-download-all").click(),
  ]);
  const bytes = await readDownload(download);
  const control = await zipJson(bytes, pairJson("light-s1/L1-L2"));
  expect(control.lightCheck).toBe("ok");
  expect(control.frames[1]).toMatchObject({
    take: 2,
    file: shotPng("light-s1/L2", 2),
  });
  // Only the photo kept for a shot goes in, under its take.
  expect(await zipFiles(bytes)).toContain(shotPng("light-s1/L2", 2));
  expect(await zipFiles(bytes)).not.toContain(shotPng("light-s1/L2", 1));
  const dimmed = await zipJson(bytes, pairJson("light-s1/L1-L3"));
  expect(dimmed.lightCheck).toBe("ok");
  expect(dimmed.frames[1].greyMean).toBeLessThan(dimmed.frames[0].greyMean);
  const { texts } = await zipContents(bytes);
  expect(texts["feature-match-summary.txt"]).toContain("Retakes: 2");
});

/**
 * Why this test matters: the cockpit is used on a phone upright, a phone
 * on its side and a foldable's inner screen, as in the chosen prototype.
 * Upright the dock sits under the viewfinder; wider, beside it on the
 * right. Inside the dock the order is fixed (chip, instruction, the big
 * button with its side buttons and photo tiles, readouts, status, the
 * foot with Details and Download all), the controls are apart and wholly
 * on screen, and the page never scrolls. A phone on its side is short: the
 * prototype cut its foot off there, so the foot must keep room for the
 * taller fonts of other systems (about 30 px). Below 360 px of height the
 * dock alone scrolls, the big button still on screen without scrolling.
 */
for (const vp of [
  { width: 412, height: 915 },
  { width: 360, height: 740 },
  { width: 915, height: 412 },
  { width: 800, height: 360 },
  { width: 800, height: 300 },
  { width: 880, height: 790 },
]) {
  test(`the cockpit dock fits ${String(vp.width)}x${String(vp.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await routeNetwork(page, fulfillSift);
    await openCockpit(page);
    const m = await page.evaluate(() => {
      const box = (/** @type {string} */ sel) => {
        const r = /** @type {Element} */ (
          document.querySelector(sel)
        ).getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      return {
        stage: box("#c-stage"),
        dock: box("#c-dock"),
        chip: box("#c-chip"),
        instr: box("#c-instr"),
        shotA: box("#c-shot-a"),
        shotB: box("#c-shot-b"),
        shutter: box("#c-shutter"),
        retake: box("#c-retake"),
        next: box("#c-next"),
        readouts: box(".c-readouts"),
        status: box("#c-status"),
        details: box("#c-details"),
        download: box("#c-download-all"),
        scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight,
        dockScroll: (() => {
          const d = /** @type {HTMLElement} */ (
            document.querySelector("#c-dock")
          );
          const range = d.scrollHeight - d.clientHeight;
          d.scrollTop = d.scrollHeight;
          const foot = box("#c-details").bottom;
          d.scrollTop = 0;
          return { range, foot };
        })(),
      };
    });
    const near = (/** @type {number} */ got, /** @type {number} */ want) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
    /** `a` wholly left of `b`, at least 4 px apart. */
    const leftOf = (
      /** @type {{ right: number }} */ a,
      /** @type {{ left: number }} */ b,
    ) => expect(a.right + 4).toBeLessThanOrEqual(b.left + 0.5);
    /** `a` wholly above `b`. */
    const above = (
      /** @type {{ bottom: number }} */ a,
      /** @type {{ top: number }} */ b,
    ) => expect(a.bottom).toBeLessThanOrEqual(b.top + 0.5);
    const { stage, dock, chip, instr, shotA, shotB, shutter, retake, next } = m;
    const { readouts, status, details, download } = m;
    expect(m.scrollW).toBeLessThanOrEqual(vp.width);
    expect(m.scrollH).toBeLessThanOrEqual(vp.height);
    near(stage.left, 0);
    near(stage.top, 0);
    near(dock.right, vp.width);
    near(dock.bottom, vp.height);
    if (vp.width < vp.height) {
      // The dock under the viewfinder, both the full width.
      near(stage.right, vp.width);
      near(dock.left, 0);
      near(dock.top, stage.bottom);
    } else {
      // The dock on the right, both the full height.
      near(stage.bottom, vp.height);
      near(dock.top, 0);
      near(dock.left, stage.right);
    }
    const controls = [chip, instr, shotA, shotB, shutter, retake, next];
    for (const r of [...controls, readouts, status, details, download]) {
      expect(r.left).toBeGreaterThanOrEqual(dock.left - 0.5);
      expect(r.right).toBeLessThanOrEqual(dock.right + 0.5);
      expect(r.top).toBeGreaterThanOrEqual(dock.top - 0.5);
      expect(r.bottom).toBeLessThanOrEqual(
        vp.height + m.dockScroll.range + 0.5,
      );
    }
    // Only a very short dock scrolls, and the big button stays on screen
    // without scrolling; scrolled to its end, the foot is on screen.
    if (vp.height >= 360) expect(m.dockScroll.range).toBeLessThanOrEqual(0);
    expect(shutter.bottom).toBeLessThanOrEqual(vp.height + 0.5);
    expect(m.dockScroll.foot).toBeLessThanOrEqual(vp.height + 0.5);
    // Top to bottom.
    above(chip, instr);
    above(instr, shotA);
    above(instr, retake);
    above(shutter, readouts);
    above(shotA, readouts);
    above(readouts, status);
    above(status, details);
    // The big button between its side buttons, centred on one line, round
    // and thumb-sized; the side buttons tall enough to hit.
    near(retake.top + retake.height / 2, shutter.top + shutter.height / 2);
    near(next.top + next.height / 2, shutter.top + shutter.height / 2);
    leftOf(retake, shutter);
    leftOf(shutter, next);
    near(shutter.width, shutter.height);
    expect(shutter.height).toBeGreaterThanOrEqual(76);
    expect(Math.min(retake.height, next.height)).toBeGreaterThanOrEqual(48);
    // The photo tiles: beside the big button, or a row above it.
    leftOf(shotA, shotB);
    if (shotA.bottom <= shutter.top) {
      above(shotB, shutter);
    } else {
      leftOf(retake, shotA);
      leftOf(shotA, shutter);
      leftOf(shutter, shotB);
      leftOf(shotB, next);
    }
    // The foot: two buttons side by side, on screen.
    near(details.top, download.top);
    leftOf(details, download);
    if (vp.height <= 560 && m.dockScroll.range <= 0) {
      expect(details.bottom + 30).toBeLessThanOrEqual(vp.height);
    }
  });
}

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

/**
 * Opens the flat target capture from the Results tab.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openFlat(page) {
  await openTab(page, "results");
  await page.locator("#c-open-flat").click();
  await expect(page.locator("#flat")).toBeVisible();
  await expect(page.locator("#c-drawer")).toBeHidden();
}

/** Each photo waits for its 3 s countdown. */
const AFTER_COUNTDOWN = { timeout: 10_000 };

/**
 * Why this test matters: the flat target capture is used on a phone resting
 * on something steady, one surface after another, with photos that exist
 * only in the page until downloaded. It proves the whole loop for one
 * surface: the mode opens from the Results tab, the reference waits for
 * its countdown (which a second tap cancels), the four corner taps are
 * guided in order and can be redone, the straightened check is shown
 * before it is kept, the full-light and a darker shot of a pose get their
 * light bin from the luma ratio (shown live too), and one tap downloads
 * one zip with every photo, the corners and the tags in the file names
 * and the JSON. The progress survives a reload (the mode is opened again by hand), every control is on
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

  await openFlat(page);
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

  // After a reload the downloaded progress is back.
  await page.reload();
  await expect(page.locator("#log")).toContainText("ready");
  await openFlat(page);
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
  await expect(page.locator("#c-chip-key")).toHaveText("L1");
  await page.locator("#c-shutter").click();
  await expect(page.locator("#c-shutter-text")).toHaveText("L1 in 3 s");
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
  await openFlat(page);

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
  await openFlat(page);
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
  await openTab(page, "results");
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
 * Opens the guided menu (the sheet with the settings and the side paths).
 *
 * @param {import("@playwright/test").Page} page
 */
async function openMenu(page) {
  await page.locator("#g-open-menu").click();
  await expect(page.locator("#g-sheet-menu")).toBeVisible();
}

/**
 * Sets the countdown in the menu to `secs` (0 is off) and closes it.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} secs
 */
async function setCountdown(page, secs) {
  await openMenu(page);
  const b = page.locator(`#g-sheet-menu [data-countdown="${String(secs)}"]`);
  await b.click();
  await expect(b).toHaveAttribute("aria-checked", "true");
  await page.locator("#g-close-menu").click();
  await expect(page.locator("#g-sheet-menu")).toBeHidden();
}

/**
 * The strip's thumb of the shot at `index` in the run.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} index
 */
const thumb = (page, index) =>
  page.locator(`#g-thumbs .th[data-index="${String(index)}"]`);

/**
 * Menu, then Finish now: the end view.
 *
 * @param {import("@playwright/test").Page} page
 */
async function goEnd(page) {
  await openMenu(page);
  await page.locator('#g-sheet-menu [data-act="finish"]').click();
  await expect(page.locator("#g-end")).toBeVisible();
}

/**
 * From the intro: Start, countdown off, then L1 and L2, each next shot
 * coming up by itself, the camera on by itself. Ends with L3 due.
 *
 * @param {import("@playwright/test").Page} page
 */
async function guidedFirstShots(page) {
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-run")).toBeVisible();
  await expect(page.locator("#g-cam-wait")).toBeHidden();
  await setCountdown(page, 0);
  const primary = page.locator("#g-primary-label");
  await expect(primary).toHaveText("Capture L1");
  await page.locator("#g-primary").click();
  await expect(primary).toHaveText("Capture L2");
  await expect(thumb(page, 0)).toHaveAttribute("data-st", "taken");
  await page.locator("#g-primary").click();
  await expect(primary).toHaveText("Capture L3");
}

/**
 * Why this test matters: the guided view is what a tester sees by
 * default, so its whole path must work with nothing but taps: the intro,
 * the camera starting by itself, a countdown that can be cancelled, each
 * next shot coming up by itself with the base photo of the scene as a
 * ghost while it is due (and gone once the run moves on), a shot picked
 * from another scene's strip, a retake of F1 that names what it redoes and
 * can be left again, and the end view's one download. The zip is what
 * gets sent back, so it must hold the ready pair's folder plus the summary
 * and the log, and a dismissed save dialog must lose nothing and count no
 * download. Nothing leaves the machine.
 */
test("the guided photo test walks the shots from the intro to a saved zip", async ({
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
  const code = page.locator("#g-card-code");
  const label = page.locator("#g-primary-label");
  await expect(page.locator("#g-scene-kicker")).toHaveText("Scene 1 of 3");
  await expect(page.locator("#g-scene-name")).toHaveText("Light");
  await expect(page.locator("#g-card-count")).toHaveText("photo 1 of 4");
  await expect(code).toHaveText("L1");
  await expect(page.locator("#g-cam-wait")).toBeHidden();

  // The default countdown: 3 s with the big button as Cancel.
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count-num")).toHaveText("3");
  await expect(label).toHaveText("Cancel");
  await page.locator("#g-primary").click();
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(label).toHaveText("Capture L1");
  await expect(thumb(page, 0)).toHaveAttribute("data-st", "open");

  await setCountdown(page, 0);
  await expect(page.locator("#g-primary-sub")).toHaveText("shoots at once");
  await page.locator("#g-primary").click();
  // The next shot comes up by itself; while it is due, the scene's base
  // photo can be laid over the finder.
  await expect(code).toHaveText("L2");
  await expect(page.locator("#g-card-count")).toHaveText("photo 2 of 4");
  await expect(page.locator("#g-ghost-toggle")).toHaveText("Show L1");
  await page.locator("#g-ghost-toggle").click();
  await expect(page.locator("#g-ghost")).toBeVisible();
  await page.locator("#g-primary").click();
  await expect(code).toHaveText("L3");
  await expect(page.locator("#g-ghost")).toBeHidden();
  const log = page.locator("#log");
  await expect(log).toContainText("run: light scene at 1 place(s), 13 shots");
  await expect(log).toContainText("countdown: cancelled");
  await expect(log).toContainText(
    "photo light-s1/L1 take 1: 320x240 grey mean 127.5",
  );
  await expect(log).toContainText("light check light-s1/L2: ok");

  // F1 from the flat scene's strip; F2 comes up, and F1 picked again is a
  // retake that says what it redoes and can be left with the back button.
  await page.locator('#g-segs [data-scene="flat-s1"]').click();
  await expect(thumb(page, 4)).toBeVisible();
  await thumb(page, 4).click();
  await expect(code).toHaveText("F1");
  await expect(page.locator("#g-scene-kicker")).toHaveText("Scene 2 of 3");
  await page.locator("#g-primary").click();
  await expect(code).toHaveText("F2");
  await thumb(page, 4).click();
  await expect(code).toHaveText("F1");
  await expect(page.locator("#g-banner-title")).toHaveText(
    "Retake F1, the base photo",
  );
  await expect(label).toHaveText("Retake F1");
  await expect(page.locator("#g-secondary")).toHaveText("Back to L3");
  await page.locator("#g-secondary").click();
  await expect(code).toHaveText("L3");
  await expect(page.locator("#g-card-banner")).toBeHidden();

  await goEnd(page);
  await expect(page.locator("#g-end-kicker")).toHaveText(
    "3 of 13 photos taken",
  );
  // The end view says how far the measuring worker got.
  await expect(page.locator("#g-end-title")).toHaveText(
    "Everything is measured",
  );
  await expect(page.locator("#g-end-eta")).toHaveText("all done");
  await expect(page.locator("#g-choice")).toBeHidden();
  const dl = page.locator("#g-download");
  await expect(page.locator("#g-dl-label")).toHaveText("Download the zip");
  await expect(page.locator("#g-dl-sub")).toHaveText("3 photos, 1 result");
  const state = page.locator("#g-download-state");

  // A dismissed save dialog loses nothing and counts no download.
  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "cancel";
  });
  await dl.click();
  await expect(state).toHaveText(
    "Not saved: the save dialog was closed. Nothing was lost.",
  );
  await expect(page.locator("#g-dl-label")).toHaveText("Download the zip");
  await expect(dl).toBeEnabled();

  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "save";
  });
  await dl.click();
  await expect(state).toHaveText(/^Saved feature-match-run-.+\.zip \(/);
  await expect(state).toHaveClass(/ok/);
  await expect(page.locator("#g-dl-label")).toHaveText("Download again");
  const zipName = /** @type {string} */ (
    await page.evaluate(
      () => Object.keys(/** @type {any} */ (window).__saved)[0],
    )
  );
  expect(zipName).toMatch(/^feature-match-run-.+\.zip$/);
  const bytes = await savedBytes(page, zipName);
  expect(await zipFiles(bytes)).toEqual([
    shotPng("light-s1/L1"),
    shotPng("light-s1/L2"),
    shotPng("flat-s1/F1"),
    pairJson("light-s1/L1-L2"),
    matchesJson("light-s1/L1-L2"),
    "feature-match-summary.txt",
    "feature-match-log.txt",
  ]);
  const frames = await zipJson(bytes, pairJson("light-s1/L1-L2"));
  expect(frames.pair).toBe("1a");
  expect(frames.frames[0].file).toBe(shotPng("light-s1/L1"));
  const { texts } = await zipContents(bytes);
  expect(texts["feature-match-summary.txt"]).toContain("Shots taken: 3 of 13");
  expect(texts["feature-match-log.txt"]).toContain("photo light-s1/L2 take 1");
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: a run whose photos are all taken or skipped must
 * reach the end view by itself, and the skip paths must not lose a shot:
 * Skip scene on a scene's first shot skips every open shot of it, Skip
 * photo one shot, and each skipped shot stays in the end view's list,
 * from where one tap takes it after all.
 */
test("the guided skip paths reach the end view and keep the skipped shots", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  const secondary = page.locator("#g-secondary");
  await expect(secondary).toHaveText("Skip scene");
  await secondary.click();
  await expect(page.locator("#g-card-code")).toHaveText("F1");
  await secondary.click();
  await expect(page.locator("#g-card-code")).toHaveText("D1");
  await secondary.click();
  // The last open shot closed: the end view opens by itself.
  await expect(page.locator("#g-end")).toBeVisible();
  await expect(page.locator("#g-end-kicker")).toHaveText(
    "0 of 13 photos taken",
  );
  const missing = page.locator("#g-missing-list button");
  await expect(missing).toHaveCount(13);
  await expect(missing.first()).toHaveText("L1, skipped");
  await expect(page.locator("#g-dl-label")).toHaveText("Download the zip");
  await expect(page.locator("#g-download")).toBeDisabled();
  await missing.nth(4).click();
  await expect(page.locator("#g-run")).toBeVisible();
  await expect(page.locator("#g-card-code")).toHaveText("F1");
  await expect(page.locator("#log")).toContainText(
    "run: skipped light-s1/L1, light-s1/L2, light-s1/L3, light-s1/L4",
  );
});

/**
 * Download all through the link fallback; returns the zip's bytes. With
 * `measured` it first waits until the end view says every pair is measured.
 *
 * @param {import("@playwright/test").Page} page
 * @param {boolean} [measured]
 */
async function downloadAllBytes(page, measured = false) {
  await goEnd(page);
  if (measured) {
    await expect(page.locator("#g-end-eta")).toHaveText("all done");
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#g-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^feature-match-run-.+\.zip$/);
  await expect(page.locator("#g-download-state")).toHaveText(/^Saved /);
  return readDownload(download);
}

/**
 * The bytes of the zip entry named `pattern` (or whose name matches it).
 *
 * @param {Buffer} zip
 * @param {RegExp | string} pattern
 */
async function zipEntryBytes(zip, pattern) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const entry = (await reader.getEntries()).find((e) =>
    typeof pattern === "string"
      ? e.filename === pattern
      : pattern.test(e.filename),
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
 * with the taken photos drawn again from storage, and the zip built after
 * it holds every shot once, the ready pairs and the log of both loads. A
 * photo taken after the reload must get an id of its own: one handed out
 * again would overwrite a restored shot's photo in the zip (the camera is
 * dimmed for it, so a swapped photo has other pixels).
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
  await guidedFirstShots(page);
  const first = await downloadAllBytes(page);
  const beforeA = await zipEntryBytes(first, shotPng("light-s1/L1"));
  const beforeB = await zipEntryBytes(first, shotPng("light-s1/L2"));
  // The log is written a second after a line; a reload sooner than that
  // may lose the last second (a closing page's own write is best effort).
  await storedLogHas(page, "download: saved");
  await page.reload();
  await expect(page.locator("#g-run")).toBeVisible();
  await expect(page.locator("#g-intro")).toBeHidden();
  await expect(page.locator("#g-card-code")).toHaveText("L3");
  await expect(thumb(page, 0).locator("canvas")).toBeVisible();

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
  await expect(page.locator("#g-card-code")).toHaveText("L4");
  const zip = await downloadAllBytes(page, true);
  // L1-L2 and L1-L3 are ready and measured; L4 is not taken yet.
  expect(await zipFiles(zip)).toEqual([
    shotPng("light-s1/L1"),
    shotPng("light-s1/L2"),
    shotPng("light-s1/L3"),
    pairJson("light-s1/L1-L2"),
    matchesJson("light-s1/L1-L2"),
    pairJson("light-s1/L1-L3"),
    matchesJson("light-s1/L1-L3"),
    "feature-match-summary.txt",
    "feature-match-log.txt",
  ]);
  expect(
    (await zipEntryBytes(zip, shotPng("light-s1/L1"))).equals(beforeA),
  ).toBe(true);
  expect(
    (await zipEntryBytes(zip, shotPng("light-s1/L2"))).equals(beforeB),
  ).toBe(true);
  expect(
    (await zipEntryBytes(zip, shotPng("light-s1/L3"))).equals(beforeA),
  ).toBe(false);
  // The log of the first load comes back before the second's.
  const zipLog = (await zipContents(zip)).texts["feature-match-log.txt"] ?? "";
  const reloaded = zipLog.indexOf("page reloaded");
  expect(reloaded).toBeGreaterThan(zipLog.indexOf("photo light-s1/L2 take 1"));
  expect(zipLog.indexOf("photo light-s1/L3 take 1")).toBeGreaterThan(reloaded);
});

/**
 * Why this test matters: two tabs of the page would write one database,
 * each sweeping the other's photos as orphans. The second tab must say
 * that the test is open elsewhere and take no photo, while the first one
 * runs on.
 */
test("the guided photo test refuses a second tab", async ({
  page,
  context,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html");
  // Polled through evaluate: waitForFunction would take the returned
  // promise as a truthy answer and not wait.
  await expect
    .poll(() =>
      page.evaluate(async () =>
        ((await navigator.locks.query()).held ?? []).some(
          (l) => l.name === "feature-match-run",
        ),
      ),
    )
    .toBe(true);
  const second = await context.newPage();
  await routeNetwork(second, fulfillSift);
  await fakeCamera(second);
  await second.goto("/feature-match-check.html");
  await expect(second.locator("#log")).toContainText(
    "another tab holds this test: this one takes no photo",
  );
  await second.locator("#g-intro-start").click();
  await expect(second.locator("#g-saved-text")).toHaveText(
    "This test is open in another tab: this one takes no photo. Close the other tab, then reload this one.",
  );
  await expect(second.locator("#g-saved-chip")).toHaveClass(/warn/);
  // Every button that would take a photo is off.
  await expect(second.locator("#g-primary")).toBeDisabled();
  await expect(second.locator("#g-card-code")).toHaveText("L1");

  // The first tab runs on.
  await guidedFirstShots(page);
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
  await expect(page.locator("#g-cam-wait")).toBeHidden();
  await page.locator("#g-primary").click();
  const num = page.locator("#g-count-num");
  await expect(num).toHaveText("3");
  await page.clock.runFor(1000);
  await expect(num).toHaveText("2");
  await page.clock.runFor(1000);
  await expect(num).toHaveText("1");
  await expect(thumb(page, 0)).toHaveAttribute("data-st", "open");
  await page.clock.runFor(1000);
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(thumb(page, 0)).toHaveAttribute("data-st", "taken");
  await expect(page.locator("#log")).toContainText(
    "photo light-s1/L1 take 1: 320x240",
  );
  await expect(page.locator("#g-primary-label")).toHaveText("Capture L2");
});

/**
 * Why this test matters: while the camera permission prompt is open the
 * finder must say the camera is starting, not that it is off, and the
 * capture button waits for it.
 */
test("the guided finder says the camera is starting while it waits", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "hold");
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  const wait = page.locator("#g-cam-wait");
  await expect(wait).toHaveText("Starting the camera...");
  await expect(page.locator("#g-primary-sub")).toHaveText(
    "waiting for the camera",
  );
  await expect(page.locator("#g-primary")).toBeDisabled();
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseCamera();
  });
  await expect(wait).toBeHidden();
  await expect(page.locator("#g-primary")).toBeEnabled();
});

/**
 * Why this test matters: leaving the run screen (the help in the menu)
 * while the camera permission prompt is still open stops that start;
 * coming back must start the camera again, not wait for a start that was
 * stopped.
 */
test("the guided view starts the camera again after the help while the prompt was open", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "hold");
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  const wait = page.locator("#g-cam-wait");
  await expect(wait).toHaveText("Starting the camera...");
  await openMenu(page);
  await page.locator('#g-sheet-menu [data-act="help"]').click();
  await expect(page.locator("#g-intro")).toBeVisible();
  await expect(page.locator("#g-sheet-menu")).toBeHidden();
  await page.locator("#g-intro-start").click();
  await expect(page.locator("#g-run")).toBeVisible();
  // Two starts are pending: the one the help stopped, then the new one.
  // Each is released in turn; the stopped one's late stream must not count.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      /** @type {any} */ (window).__releaseCamera();
    });
  }
  await expect(wait).toBeHidden();
  await expect(page.locator("#g-primary")).toBeEnabled();
});

/**
 * L1 and L2 taken with the countdown off, then the countdown back at 3 s:
 * the next tap starts a countdown on L3 while a pair is ready to save.
 *
 * @param {import("@playwright/test").Page} page
 */
async function countdownOnL3(page) {
  await guidedFirstShots(page);
  await setCountdown(page, 3);
  await expect(page.locator("#g-primary-sub")).toHaveText("then 3 s hands off");
}

/**
 * Why this test matters: a save that starts while a countdown runs makes
 * the page busy, and a count that ran on would shoot into a photo the
 * reducer refuses. The save must end the countdown at once: no frozen
 * digit, no photo at its end, and the shot still due once the save is
 * done. The page clock drives the seconds; the held save dialog keeps the
 * page busy. The download is clicked by a dispatched event: it sits on the
 * end view, and leaving the run screen would cancel the countdown first;
 * the event stands in for any save under a countdown.
 */
test("the guided countdown ends when a save starts under it", async ({
  page,
}) => {
  await page.clock.install();
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await savePicker(page);
  await page.goto("/feature-match-check.html");
  await countdownOnL3(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__saveAnswer = "hold";
  });
  const primary = page.locator("#g-primary");

  await primary.click();
  await expect(page.locator("#g-count-num")).toHaveText("3");
  await page.locator("#g-download").dispatchEvent("click");
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(primary).toBeDisabled();
  await page.clock.runFor(3000);
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseSave();
  });
  // The zip may wait on page timers: the clock moves until the save ends.
  await expect
    .poll(async () => {
      await page.clock.runFor(50);
      return primary.isEnabled();
    })
    .toBe(true);
  await expect(page.locator("#g-count")).toBeHidden();
  await expect(thumb(page, 2)).toHaveAttribute("data-st", "open");
  await expect(page.locator("#g-primary-label")).toHaveText("Capture L3");
  expect(await logLines(page, "photo light-s1/L3")).toBe(0);
});

/**
 * Why this test matters: the zip is the one file a tester sends, so its
 * failure path must be as clear as its success: while packing the button
 * says so and is off, a PNG that cannot be encoded ends in a "Could not
 * prepare the zip" line with the button back on, red and saying the
 * download failed, and the run goes on (the next photo can still be
 * taken). A stored photo's read is held once, then fails.
 */
test("the guided download shows packing, then a failure that loses nothing", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await savePicker(page);
  await controlPhotoReads(page);
  await page.goto("/feature-match-check.html");
  await guidedFirstShots(page);
  await goEnd(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__photoReads = "hold";
  });
  const button = page.locator("#g-download");
  const label = page.locator("#g-dl-label");
  await button.click();
  await expect(label).toHaveText("Packing the zip...");
  await expect(button).toBeDisabled();
  // The label turns before the first photo is read: wait for the held one.
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (/** @type {any} */ (window).__releaseRead) === "function",
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    /** @type {any} */ (window).__releaseRead();
  });
  const state = page.locator("#g-download-state");
  await expect(state).toHaveText(
    /^Could not prepare the zip: .*the photo .* is not stored.*. Nothing was lost; try again.$/,
  );
  await expect(state).toHaveClass(/err/);
  await expect(button).toBeEnabled();
  await expect(label).toHaveText("Download failed - try again");
  await expect(button).toHaveClass(/\berr\b/);
  await expect(page.locator("#log")).toContainText("ERROR download:");

  await page.locator("#g-end-back").click();
  await expect(page.locator("#g-card-code")).toHaveText("L3");
  await page.locator("#g-primary").click();
  await expect(thumb(page, 2)).toHaveAttribute("data-st", "taken");
});

/**
 * Why this test matters: the measure sheet is where the guided view keeps
 * the benchmark, reached from the menu; the synthetic run must work from
 * the sheet and fill the moved Results. On a phone the results table
 * scrolls in its own box, its header with it, and the page never scrolls
 * sideways. With sift.js stubbed nothing is downloaded from outside.
 */
test("the guided measure sheet runs the synthetic pair", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.goto("/feature-match-check.html");
  await page.locator("#g-intro-start").click();
  await openMenu(page);
  await page.locator('#g-sheet-menu [data-act="measure"]').click();
  await expect(page.locator("#g-sheet-menu")).toBeHidden();
  await expect(page.locator("#g-sheet-measure #options")).toBeAttached();
  await expect(page.locator("#g-sheet-measure #run-synthetic")).toBeVisible();
  await chooseSiftOnly(page);
  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-state")).toHaveText("done: 1 methods");
  await expect(page.locator("#results tbody tr")).toHaveCount(1);
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
});

/**
 * Why this test matters: the guided run screen is laid out for a phone
 * held upright, a phone on its side and a desktop window, as in the chosen
 * prototype (whose boxes these numbers are, measured side by side; the
 * build's own changes are the larger pair diagram upright and the lower
 * action bar on a 360 px high screen, which make the card fit). Upright,
 * header, strip, card, viewfinder and action bar stack in one column;
 * wider, the viewfinder takes the right side. The edges, the gaps and the
 * big button's height are pinned, the first shot's card fits without
 * scrolling (a phone on its side once clipped its steps), and the page
 * never scrolls sideways.
 */
for (const vp of [
  {
    width: 412,
    height: 915,
    edge: 12,
    gap: 8,
    strip: 64,
    button: 76,
    split: null,
  },
  {
    width: 915,
    height: 412,
    edge: 8,
    gap: 6,
    strip: 54,
    button: 60,
    split: 6,
  },
  // A common Android phone on its side, shorter than 915x412.
  {
    width: 800,
    height: 360,
    edge: 8,
    gap: 4,
    strip: 52,
    button: 52,
    split: 6,
  },
  {
    width: 880,
    height: 790,
    edge: 12,
    gap: 8,
    strip: 64,
    button: 76,
    split: 12,
  },
]) {
  test(`the guided run screen fits ${String(vp.width)}x${String(vp.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await routeNetwork(page, fulfillSift);
    await fakeCamera(page);
    await page.goto("/feature-match-check.html");
    await page.locator("#g-intro-start").click();
    await expect(page.locator("#g-cam-wait")).toBeHidden();
    const m = await page.evaluate(() => {
      const box = (/** @type {string} */ sel) => {
        const e = /** @type {Element} */ (document.querySelector(sel));
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const card = /** @type {HTMLElement} */ (
        document.querySelector("#g-run .card")
      );
      return {
        head: box("#g-run .run-head"),
        strip: box("#g-strip"),
        card: box("#g-run .card"),
        finder: box("#g-finder"),
        actions: box("#g-run .actions"),
        primary: box("#g-primary"),
        steps: box("#g-card-steps"),
        cardFits: card.scrollHeight <= card.clientHeight,
        scrollW: document.documentElement.scrollWidth,
      };
    });
    const near = (/** @type {number} */ got, /** @type {number} */ want) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
    const { head, strip, card, finder, actions, primary, steps } = m;
    near(head.left, 16);
    near(head.top, vp.edge);
    near(strip.top, vp.strip);
    near(strip.top - head.bottom, vp.gap);
    near(card.top - strip.bottom, vp.gap);
    near(card.left, 16);
    near(actions.left, 16);
    near(actions.bottom, vp.height - vp.edge);
    near(primary.bottom - primary.top, vp.button);
    if (vp.split === null) {
      // One column: card, viewfinder, action bar, a gap apart.
      for (const r of [head, strip, card, finder, actions]) {
        near(r.right, vp.width - 16);
      }
      near(finder.top - card.bottom, vp.gap);
      near(actions.top - finder.bottom, vp.gap);
    } else {
      // The viewfinder on the right, the column beside it.
      expect(actions.top).toBeGreaterThanOrEqual(card.bottom + vp.gap - 1);
      near(finder.left - card.right, vp.split);
      near(finder.right, vp.width - 16);
      near(finder.top, vp.edge);
      near(finder.bottom, vp.height - vp.edge);
    }
    expect(m.cardFits).toBe(true);
    expect(steps.bottom).toBeLessThanOrEqual(card.bottom + 0.5);
    expect(m.scrollW).toBeLessThanOrEqual(vp.width);
  });
}

/**
 * Why this test matters: the phone measures the stored PNG of a shot, not
 * the frame it captured, and the PC measures the PNG in the zip. Both
 * equal the captured frame only if the PNG round trip is lossless: a frame
 * encoded the way the capture encodes it and decoded in a module worker
 * the way the measuring worker decodes it must give the very same bytes.
 */
test("a shot's PNG decodes in a module worker to the very bytes it was made from", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await openCockpit(page);
  const same = await page.evaluate(async () => {
    const width = 64;
    const height = 48;
    const rgba = new Uint8ClampedArray(width * height * 4);
    let seed = 1;
    for (let i = 0; i < rgba.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      // The camera's frames are opaque.
      rgba[i] = i % 4 === 3 ? 255 : seed >>> 24;
    }
    const base = `${location.origin}/src/checks/feature-match/`;
    const domUrl = `${base}bench-dom.ts`;
    const dom = /** @type {any} */ (await import(/* @vite-ignore */ domUrl));
    const png = await dom.framePng({ width, height, rgba }, "round trip");
    const source = [
      `import { pngFrame } from "${base}png-frame.ts";`,
      "self.onmessage = async (e) => {",
      "  const f = await pngFrame(e.data);",
      "  self.postMessage({ width: f.width, height: f.height, rgba: f.rgba });",
      "};",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    const worker = new Worker(url, { type: "module" });
    const back = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage(png);
    });
    worker.terminate();
    URL.revokeObjectURL(url);
    const f =
      /** @type {{ width: number, height: number, rgba: Uint8ClampedArray }} */ (
        back
      );
    return (
      f.width === width &&
      f.height === height &&
      f.rgba.length === rgba.length &&
      f.rgba.every((v, i) => v === rgba[i])
    );
  });
  expect(same).toBe(true);
});

const SPIKE = "/feature-match-check.html?spike=worker&baseline=1&pairs=2";

/**
 * Why this test matters: the background measuring test is run by a person
 * on a phone who cannot read code. It must go from one Start button through
 * a visible progress to a plain result card, measure with the photo test's
 * own worker, answer the XFeat question even when XFeat cannot start, and
 * confirm the Copy log tap.
 */
test("the background measuring test goes from Start to a result card and copies its log", async ({
  page,
  context,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // SIFT is stubbed; ALIKED's models and XFeat's runtime are refused.
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SPIKE);

  const start = page.locator("#spike-start");
  await expect(page.locator("#spike-intro-text")).toContainText(
    "It takes about",
  );
  await expect(start).toBeEnabled();
  expect(await pageOverflow(page)).toBe(0);

  await start.click();
  // Running: the step of how many, the time left and a plain status line.
  await expect(start).toBeHidden();
  await expect(page.locator("#spike-step")).toHaveText(/^Step [1-5] of 5$/);
  await expect(page.locator("#spike-left")).toHaveText(
    /^(about \d+ (s|min) left|almost done)$/,
  );
  await expect(page.locator("#spike-status")).not.toBeEmpty();
  await expect(page.locator("#spike-keep")).toBeVisible();

  // The result card in plain words: a yes or a no with a gap in ms (a fake
  // camera in a headless browser can land on either side of the rule).
  await expect(page.locator("#spike-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#spike-camera")).toHaveText(
    /^(Yes|No)\. .*\d+ ms/,
  );
  await expect(page.locator("#spike-xfeat")).toHaveText(/^Could not start: /);
  const methods = page.locator("#spike-methods li");
  await expect(methods).toHaveCount(2);
  await expect(methods.nth(0)).toContainText(/per pair, first load/);
  await expect(methods.nth(1)).toContainText("could not run:");
  await expect(page.locator(".finder")).toBeHidden();
  await expect(page.locator("#spike-log-box")).not.toHaveAttribute("open");
  expect(await pageOverflow(page)).toBe(0);
  // The result card fits phone landscape and desktop too: no sideways
  // scroll, and the Copy log button stays on screen.
  for (const vp of [
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(vp);
    expect(await pageOverflow(page)).toBe(0);
    await expect(page.locator("#spike-copy")).toBeInViewport();
  }

  const copy = page.locator("#spike-copy");
  await copy.click();
  await expect(copy).toHaveText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // The log names both workers' answers and the verdict with its sweep,
  // and the card's yes or no is the log's verdict, not a second opinion.
  expect(copied).toContain("pair 2: done in");
  const verdict = copied.match(
    /camera verdict: (smooth|stutter); factor 1\.1: [Yn]{3}, 1\.25: [Yn]{3}, 1\.5: [Yn]{3} \(caps 150\/250\/400 ms\)/,
  );
  expect(verdict).not.toBeNull();
  const card = (await page.locator("#spike-camera").textContent()) ?? "";
  expect(card.startsWith("Yes")).toBe(verdict?.[1] === "smooth");
  expect(copied).toContain("RESULT XFeat in a worker: Could not start");
  expect(copied).toContain("SPIKE-DONE");
  expect(errors).toEqual([]);
});

/**
 * Why this test matters: a refused camera must say so in one plain sentence
 * with what to do, never show a stack trace, and keep the log copyable.
 */
test("the background measuring test explains a refused camera", async ({
  page,
}) => {
  await routeNetwork(page, fulfillSift);
  await fakeCamera(page, "reject");
  await page.goto(SPIKE);
  await expect(page.locator("#spike-error-msg")).toHaveText(
    "The camera was blocked.",
  );
  await expect(page.locator("#spike-error-todo")).toContainText(
    "Allow the camera",
  );
  // The error name stays in the log, which is collapsed.
  await expect(page.locator("#spike-error")).not.toContainText(
    "NotAllowedError",
  );
  await expect(page.locator("#spike-log")).toBeHidden();
  await expect(page.locator("#spike-retry")).toBeVisible();
  await expect(page.locator("#spike-copy")).toBeVisible();
  await expect(page.locator("#spike-start")).toBeHidden();
  await expect(page.locator("#spike-log")).toContainText(
    "ERROR camera: NotAllowedError",
  );
});
