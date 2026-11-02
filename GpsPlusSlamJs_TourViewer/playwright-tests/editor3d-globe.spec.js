// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  noApproach,
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
  await noApproach(page);
  // The whole-Earth imagery's levels asked for. At street level the
  // globe's surface is hidden and not updated, so its finest levels are
  // asked by the relief: it draws the globe's own imagery (it was a plain
  // beige ground before).
  /** @type {number[]} */
  const marble = [];
  page.on("request", (request) => {
    const [, path] = request.url().split("/blue-marble-4326/");
    if (path !== undefined) marble.push(Number(path.split("/")[0]));
  });
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  await afterFrames(page, 5);

  // Street level: the relief carries the ground once its view is loaded
  // (the globe's surface fills in until then), the camera is an eye
  // height over the square, not in orbit.
  await expect
    .poll(async () => (await view3d(page))?.globe?.carrier, {
      timeout: 60_000,
    })
    .toBe("relief");
  const stats = await view3d(page);
  expect(stats.globe).toBeDefined();
  expect(stats.globe.altitudeM).toBeGreaterThan(0);
  expect(stats.globe.altitudeM).toBeLessThan(2_000);
  // The tour sits in front of the camera, a few tens of metres away.
  expect(stats.distanceM).toBeLessThan(200);
  // The stations are drawn, none hidden as too small this close.
  expect(stats.globe.hiddenStations).toEqual([]);
  await expect
    .poll(() => Math.max(-1, ...marble), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(4);
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
  await noApproach(page);
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
  await noApproach(page);
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
  // Nothing is written while the drag runs.
  expect(await revision()).toBe(steps);
  // The frame holds still under the drag even with the camera taken far
  // (60 km back, past the 20 km a recentre waits for) ...
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dDistance(60_000),
  );
  await afterFrames(page, 10);
  const far = await view3d(page);
  expect(far.globe.frameTarget).toEqual(before.globe.frameTarget);
  expect(far.globe.recentres).toBe(before.globe.recentres);
  await page.mouse.up();
  await expect.poll(revision).toBe(steps + 1);
  // ... and moves once it ends: the move was far enough to be held.
  await expect
    .poll(async () => (await view3d(page))?.globe.recentres)
    .toBeGreaterThan(before.globe.recentres);
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
  // still. Then the controls zoomed toward what they picked from the
  // relief's DRAWN mesh, a point 15 km off and 5.8 km under the ground: a
  // spread from eye height flew the camera 6 km through the ground, a
  // close climbed 4 km. A pinch on the ground must step toward the ground
  // under the fingers (spread) or away from it (close), by a share of the
  // distance to it, and never take the camera under the ground. The
  // fingers sit at the view's centre, so the ground they hold is where
  // the line of sight meets it: the camera's height over the ground over
  // the sine of its pitch down. Separations in CSS px, frames drawn
  // between the moves as on a phone, both fingers down together as in the
  // globe lab's pinch.
  for (const pinch of [
    { from: 60, to: 120, least: 0.05, most: 1 },
    { from: 60, to: 300, least: 0.2, most: 1 },
    { from: 300, to: 60, least: 0.2, most: 3 },
  ]) {
    const way = pinch.to > pinch.from ? "toward" : "away from";
    test(`a pinch ${pinch.from} -> ${pinch.to} px steps ${way} the ground under the fingers`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await answerHosts(page, { globeAssets: "serve" });
      await keepRejections(page);
      await noApproach(page);
      await page.goto("/edit.html?globe=1");
      await expect(page.locator("body")).toHaveAttribute(
        "data-editor",
        "ready",
      );
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
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      /** @param {number} apart */
      const pair = (apart) => [
        { x: x - apart / 2, y, id: 1 },
        { x: x + apart / 2, y, id: 2 },
      ];
      await touch("touchStart", pair(pinch.from));
      for (let i = 1; i <= 12; i++) {
        await touch(
          "touchMove",
          pair(pinch.from + ((pinch.to - pinch.from) * i) / 12),
        );
        await afterFrames(page, 2);
      }
      await touch("touchEnd", []);
      await afterFrames(page, 10);
      const after = await view3d(page);
      const b = before.globe;
      const a = after.globe;
      const overGround = b.altitudeM - b.groundUnderCameraM;
      const down = (-b.pose.pitchDeg * Math.PI) / 180;
      expect(down).toBeGreaterThan(0.02);
      const toGroundM = overGround / Math.sin(down);
      // The camera's move along its heading over the ground (m), from the
      // change in latitude and longitude, and its change of height.
      const mPerDeg = 111_320;
      const northM = (a.pose.lat - b.pose.lat) * mPerDeg;
      const eastM =
        (a.pose.lng - b.pose.lng) *
        mPerDeg *
        Math.cos((b.pose.lat * Math.PI) / 180);
      const h = (b.pose.headingDeg * Math.PI) / 180;
      const forwardM = northM * Math.cos(h) + eastM * Math.sin(h);
      const upM = a.altitudeM - b.altitudeM;
      const movedM = Math.hypot(northM, eastM, upM);
      const ratio = movedM / toGroundM;
      const overAfter = a.altitudeM - a.groundUnderCameraM;
      console.log(
        `pinch ${pinch.from}->${pinch.to}: ground ${toGroundM.toFixed(2)} m ahead, moved ${movedM.toFixed(2)} m (forward ${forwardM.toFixed(2)}, up ${upM.toFixed(2)}), ratio ${ratio.toFixed(3)}, over ground ${overGround.toFixed(2)} -> ${overAfter.toFixed(2)} m`,
      );
      if (pinch.to > pinch.from) {
        expect(forwardM).toBeGreaterThan(0);
        expect(upM).toBeLessThanOrEqual(0.01);
      } else {
        expect(forwardM).toBeLessThan(0);
        expect(upM).toBeGreaterThan(0);
      }
      expect(ratio).toBeGreaterThan(pinch.least);
      expect(ratio).toBeLessThan(pinch.most);
      // Never under the ground (eye mode keeps 1.7 m; a little slack for
      // the sampled ground changing under the camera's own move).
      expect(overAfter).toBeGreaterThan(1);
      expect(await rejections(page)).toEqual([]);
    });
  }
});
