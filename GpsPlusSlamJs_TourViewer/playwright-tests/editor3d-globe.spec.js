// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  openSampleIn3d,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the editor on the globe view opens only behind
 * its link switch (`globe=1`), and the OrbitControls view stays the default.
 * These open the sample tour both ways and check, through the page's test
 * hook (a software-drawn WebGL shows little a screenshot could assert on),
 * that the switch gives the globe view - drawing, at street level, the
 * relief carrying the ground, the three stations in its Earth-centred
 * group - and that without it nothing of the globe loads: no globe stats,
 * no ask for its whole-Earth imagery.
 */

test("opens the sample tour on the globe at street level with ?globe=1", async ({
  page,
}, testInfo) => {
  // The relief loads from its root tile down, every tile a synthetic image
  // on a software-drawn WebGL, with the globe's sky and surface on top.
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  await afterFrames(page, 5);

  const stats = await view3d(page);
  expect(stats.globe).toBeDefined();
  // Street level: the relief carries the ground, the camera is an eye
  // height over the square, not in orbit.
  expect(stats.globe.carrier).toBe("relief");
  expect(stats.globe.altitudeM).toBeGreaterThan(0);
  expect(stats.globe.altitudeM).toBeLessThan(2_000);
  // The tour sits in front of the camera, a few tens of metres away.
  expect(stats.distanceM).toBeLessThan(200);
  // The stations are drawn, none hidden as too small this close.
  expect(stats.globe.hiddenStations).toEqual([]);
  // The staged uploads: every station admitted once, a few a frame.
  await expect
    .poll(async () => (await view3d(page))?.globe?.uploads?.pending)
    .toBe(0);
  const staged = (await view3d(page)).globe.uploads;
  expect(staged.ran).toBe(3);
  expect(staged.admitted).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("globe-street.png") });
  // The sky opens in daylight whatever the hour; the View menu's Real time
  // runs the clock at the real time now.
  expect(stats.globe.clock.realTime).toBe(false);
  expect(stats.globe.clock.sunElevationDeg).toBeGreaterThan(0);
  await page.locator("#view-menu-btn").click();
  const realTime = page.locator("#view-realtime");
  await expect(realTime).toBeVisible();
  await realTime.click();
  await expect(realTime).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await view3d(page))?.globe?.clock?.realTime)
    .toBe(true);
  const clock = (await view3d(page)).globe.clock;
  expect(Math.abs(clock.sceneMs - Date.now())).toBeLessThan(120_000);
  expect(await rejections(page)).toEqual([]);
});

/**
 * The sky's colour: the per-channel median (0-255) of the canvas's top
 * tenth, read from a screenshot (a software-drawn WebGL keeps no drawing
 * buffer to read back). The median ignores a label or a star in the band.
 * @param {import("@playwright/test").Page} page
 */
async function skyColour(page) {
  const box = await page.locator("#view3d canvas").boundingBox();
  if (box === null) throw new Error("no canvas");
  const png = await page.screenshot({
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: Math.max(4, box.height * 0.1),
    },
  });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    /** @type {number[][]} */
    const channels = [[], [], []];
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) channels[c]?.push(data[i + c] ?? 0);
    }
    const median = (/** @type {number[]} */ v) =>
      v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
    const [r = 0, g = 0, b = 0] = channels.map(median);
    return { r, g, b };
  }, png.toString("base64"));
}

/**
 * The sky's thresholds (0-255, the median of the top band). Blue: the blue
 * channel above both others and the mean of the three over `BLUE_MIN_MEAN`;
 * the view core's own sky (navy space at 0.1) has a mean under 15, so a
 * black sky fails it however blue its tint. Dark: the mean under
 * `DARK_MAX_MEAN`. Declared from the readings this test logs; the report
 * of the change that introduced them gives the measured values and the
 * margins.
 */
const SKY = { BLUE_MIN_MEAN: 60, DARK_MAX_MEAN: 40 };

/** @param {{ r: number, g: number, b: number }} c */
const skyKind = ({ r, g, b }) => {
  const mean = (r + g + b) / 3;
  if (b > r && b > g && mean > SKY.BLUE_MIN_MEAN) return "blue";
  if (mean < SKY.DARK_MAX_MEAN) return "dark";
  return `other ${r},${g},${b}`;
};

// Why: the editor on the globe opens in daylight (the clock held at the
// tour's solar noon), so its sky must be blue: the view core alone draws
// only the sun's disc, the stars and navy space, and the sky stayed black
// at noon. And the air must follow the clock: at the real time with the
// tour's local midnight, the sky is dark again. The page's Date is pinned
// to an equinox night at the sample's longitude (Munich, 11.58 deg E: the
// solar midnight is about 23:14 UTC), so the noon default and the real
// time are both known.
test("the sky over the tour is blue at noon and dark at its midnight", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.clock.setFixedTime(new Date("2026-03-20T23:14:00Z"));
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  /** @type {Record<string, unknown>} */
  const readings = {};
  // Logged however the test ends: a red run reports what it read.
  const report = () => {
    testInfo.annotations.push({
      type: "sky readings",
      description: JSON.stringify(readings),
    });
    console.log(`sky readings ${JSON.stringify(readings)}`);
  };
  try {
    // The ground sky builds its tables over a few frames.
    await expect
      .poll(
        async () => {
          const colour = await skyColour(page);
          readings.noon = colour;
          return skyKind(colour);
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .toBe("blue");

    await page.locator("#view-menu-btn").click();
    await page.locator("#view-realtime").click();
    await expect
      .poll(async () => (await view3d(page))?.globe?.clock?.sunElevationDeg)
      .toBeLessThan(-30);
    await expect
      .poll(
        async () => {
          const colour = await skyColour(page);
          readings.midnight = colour;
          return skyKind(colour);
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .toBe("dark");
  } finally {
    report();
  }
  expect(await rejections(page)).toEqual([]);
});

test("opens the OrbitControls view without the switch, nothing of the globe asked for", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const imagery = await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  const stats = await view3d(page);
  expect(stats.globe).toBeUndefined();
  expect(imagery.asks).toBe(0);
  // No sky of its own: no clock item in the View menu.
  await expect(page.locator("#view-realtime")).toBeHidden();
});

/**
 * The page point of a gizmo part, once it shows.
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "knob" | "dot"} part
 */
async function handleOnPage(page, part) {
  const ask = () =>
    page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    );
  await expect.poll(ask, { timeout: 60_000 }).not.toBeNull();
  const at = await ask();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null || at === null) throw new Error("no handle on screen");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

// Why: on the globe the camera's controls and the editor's gizmo share the
// pointer. A drag on a handle must be the gizmo's alone - the controls
// leased off, so the globe neither pans nor turns under the pointer - and
// the world frame (which follows the camera) must hold still until the
// release, or the gesture's world points move under it. The drag writes
// one edit, at its end. The sample's stations are locked in place, so the
// drag is of a radius dot (a locked station's gizmo is its dots alone).
test("drags a selected station's radius dot on the globe: one edit, the camera and the frame held still", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  const tourOf = () =>
    page.evaluate(() => /** @type {any} */ (window).__tourEditor.manifest());
  const revision = () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.editor().revision(),
    );
  const first = (await tourOf()).stations[0];
  await page.locator(`#tree-body [data-select="station:${first.id}"]`).click();
  const from = await handleOnPage(page, "dot");
  await afterFrames(page, 5);
  const steps = await revision();
  const before = await view3d(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + i * 8, from.y + i * 2);
  }
  await afterFrames(page, 10);
  const during = await view3d(page);
  expect(during.camera).toEqual(before.camera);
  expect(during.globe.recentres).toBe(before.globe.recentres);
  // Nothing is written while the drag runs.
  expect(await revision()).toBe(steps);
  await page.mouse.up();
  await expect.poll(revision).toBe(steps + 1);
  const moved = (await tourOf()).stations.find(
    (/** @type {any} */ s) => s.id === first.id,
  );
  expect(Math.abs(moved.foundRadiusM - first.foundRadiusM)).toBeGreaterThan(
    0.5,
  );
  // Locked: the drag changed the radius, never the place.
  expect(moved.geo).toEqual(first.geo);
  expect(await rejections(page)).toEqual([]);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  // Why: on a phone two fingers are the globe's controls' (their pinch,
  // twist and tilt, as in the globe lab). The editor's input used to lock
  // the camera for two fingers and read them for the OrbitControls view's
  // own gestures, which the globe view ignored: a pinch held the camera
  // still. A pinch on the ground must move the camera.
  test("a pinch on the ground moves the camera on the globe", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await answerHosts(page, { globeAssets: "serve" });
    await keepRejections(page);
    await page.goto("/edit.html?globe=1");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator("#sample-btn").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
      timeout: 120_000,
    });
    await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
    await afterFrames(page, 5);
    const box = await page.locator("#view3d canvas").boundingBox();
    if (box === null) throw new Error("no canvas");
    const before = await view3d(page);
    const cdp = await page.context().newCDPSession(page);
    /** @param {string} type @param {{x: number, y: number, id: number}[]} points */
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    // On the ground below the tour, the two fingers 60 px apart, opened
    // to 300 px over twelve steps.
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    /** @param {number} half */
    const pair = (half) => [
      { x: x - half, y, id: 1 },
      { x: x + half, y, id: 2 },
    ];
    await touch("touchStart", [{ x: x - 30, y, id: 1 }]);
    await touch("touchStart", pair(30));
    for (let i = 1; i <= 12; i++) {
      await touch("touchMove", pair(30 + i * 10));
    }
    await touch("touchEnd", []);
    await afterFrames(page, 10);
    const after = await view3d(page);
    console.log(
      `pinch distance ${before.distanceM.toFixed(1)} -> ${after.distanceM.toFixed(1)} m`,
    );
    // The controls moved the camera: before the change the input locked
    // them and the camera stayed exactly where it was.
    expect(after.camera).not.toEqual(before.camera);
    expect(Math.abs(after.distanceM - before.distanceM)).toBeGreaterThan(
      before.distanceM * 0.05,
    );
    expect(await rejections(page)).toEqual([]);
  });
});
