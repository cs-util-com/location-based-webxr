// @ts-check
/**
 * The globe lab's navigation (round-2 plan 2026-09-26-2055 M3 a, b, g;
 * round-3 plan 2026-09-27-0532 §4 E): touch and mouse on the globe with
 * the tile library's own controls, the camera's single owner, and the clip
 * planes that follow the altitude.
 *
 * Why this file matters: the owner asked to turn the Earth and zoom in to
 * watch the tiles load. Two things fail silently here: a camera with two
 * owners (the intro and the controls writing it in the same frame, which
 * shows as a globe that snaps back after every drag), and a far plane that
 * never follows the camera (a fixed 64 km near plane clips a close view to
 * black). Only a real pointer on the canvas and the camera's own numbers
 * can show either. Kept out of the other globe specs so the streams merge
 * in small pieces (round-3 plan §4).
 */
import { expect, test } from "@playwright/test";

import { arriveAt, luminance, meanOf } from "./globe-smoke-helpers.mjs";

/**
 * A fixed daylight view with the sky pinned as the other specs pin it
 * (`globe.smoke.spec.mjs` FIXED_VIEW).
 */
const VIEW =
  "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0";

/** Boots the lab at a hash and waits until it has arrived and settled. */
async function bootArrived(page, hash = VIEW) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  const state = await arriveAt(page, { lat: 30, lng: 15 });
  return { errors, state };
}

/** The canvas centre in page pixels. */
async function canvasCentre(page) {
  const box = await page.locator("#globe-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Waits for n animation frames in the page. */
const frames = (page, n) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () =>
          --left <= 0 ? resolve(null) : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }),
    n,
  );

// WHY (round-2 M3b): while the intro drives, the planes come from the
// height above the ground (near 0.3 of it, far just past the horizon), and
// the far plane stops short of the Earth's centre, so the far side is
// culled from the tile traversal.
test("the intro sets the clip planes from the altitude", async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, state } = await bootArrived(page);
  expect(state.cameraOwner).toBe("intro");
  expect(state.near).toBeCloseTo(state.altitudeM * 0.3, -3);
  expect(state.far).toBeLessThan(state.cameraDistanceM);
  expect(state.far).toBeGreaterThan(
    Math.sqrt(state.cameraDistanceM ** 2 - state.radiusM ** 2),
  );
  console.log(
    `fitted view: altitude ${(state.altitudeM / 1000).toFixed(0)} km, near ${(state.near / 1000).toFixed(0)} km, far ${(state.far / 1000).toFixed(0)} km; tiles per level ${state.tileRequestsByLevel.join("/")}, ${state.loadedTiles} loaded, ${(state.cachedBytes / 2 ** 20).toFixed(1)} MiB`,
  );
  expect(errors).toEqual([]);
});

// WHY (round-2 M3a): a drag must turn the globe under the pointer and take
// the camera from the intro, which then stays out of the way (the view
// does not snap back); the replay button must give the camera back.
test("a drag turns the globe and takes the camera; replay gives it back", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { errors, state: before } = await bootArrived(page);
  const c = await canvasCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(c.x + 20 * i, c.y);
    await frames(page, 2);
  }
  await page.mouse.up();
  await frames(page, 30);
  const after = await page.evaluate(() => window.__globeLab.state());
  expect(after.cameraOwner).toBe("controls");
  expect(after.phase).toBe("user");
  expect(after.history.at(-1).phase).toBe("user");
  // Dragging the surface to the right brings the land west of the centre
  // into view: the centre's longitude falls. 200 px on a 360 px disc
  // radius is roughly 30°; the bound is well inside that.
  const dLng = after.centreLatLon.lng - before.centreLatLon.lng;
  const dLat = after.centreLatLon.lat - before.centreLatLon.lat;
  console.log(
    `drag 200 px right: centre moved ${dLng.toFixed(2)}° in longitude, ${dLat.toFixed(2)}° in latitude`,
  );
  expect(dLng).toBeLessThan(-10);
  expect(Math.abs(dLat)).toBeLessThan(5);
  // The intro stays out: a second later the view is where the drag left it.
  await frames(page, 60);
  const later = await page.evaluate(() => window.__globeLab.state());
  expect(
    Math.abs(later.centreLatLon.lng - after.centreLatLon.lng),
  ).toBeLessThan(1);
  // The replay button gives the camera back to the intro, which flies to
  // the target again.
  await page.locator("#globe-replay").click();
  await page.waitForFunction(
    (runs) => window.__globeLab.state().runs > runs,
    after.runs,
  );
  const back = await arriveAt(page, { lat: 30, lng: 15 });
  expect(back.cameraOwner).toBe("intro");
  expect(Math.abs(back.centreLatLon.lat - 30)).toBeLessThan(0.01);
  expect(Math.abs(back.centreLatLon.lng - 15)).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

// WHY (round-2 plan §1: "zoom in, to try the tile loading"): the wheel
// takes the camera and zooms in; close to the ground (below 50 km) the
// library's planes follow it: its near plane stays within its own band
// (at most 1 km this low) and well under the altitude, and the ground
// under the centre is drawn, not clipped to the black of space. Tiles of
// the finest committed level, which the fitted view never needs, load.
test("a wheel zooms in close to the ground, unclipped, and the finest level loads", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { errors, state: fitted } = await bootArrived(page);
  const c = await canvasCentre(page);
  await page.mouse.move(c.x, c.y);
  let state = fitted;
  for (let i = 0; i < 200 && state.altitudeM > 50_000; i++) {
    await page.mouse.wheel(0, -400);
    await frames(page, 3);
    state = await page.evaluate(() => window.__globeLab.state());
  }
  console.log(
    `wheel: altitude ${(fitted.altitudeM / 1000).toFixed(0)} -> ${(state.altitudeM / 1000).toFixed(1)} km, near ${state.near.toFixed(0)} m`,
  );
  expect(state.cameraOwner).toBe("controls");
  expect(state.altitudeM).toBeLessThan(50_000);
  expect(state.near).toBeLessThanOrEqual(1000);
  expect(state.near).toBeLessThan(state.altitudeM * 0.5);
  // The fitted view needs no level 4 at the default target (globe sky
  // results §3.1); close up it must load some.
  expect(fitted.tileRequestsByLevel[4]).toBe(0);
  await page.waitForFunction(
    () => window.__globeLab.state().tileRequestsByLevel[4] > 0,
    null,
    { timeout: 120_000 },
  );
  const close = await page.evaluate(() => window.__globeLab.state());
  expect(close.centreLatLon).not.toBeNull();
  // Space is pure black on this view (no stars, no Milky Way), so a
  // clipped ground reads 0; the Sahara at 11:00 UTC reads far above it.
  const grid = await page.evaluate(() =>
    window.__globeLab.readPixels(
      [0.4, 0.45, 0.5, 0.55, 0.6].flatMap((u) =>
        [0.4, 0.45, 0.5, 0.55, 0.6].map((v) => [u, v]),
      ),
    ),
  );
  const lum = grid.map(luminance);
  const lit = lum.filter((l) => l > 10).length;
  console.log(
    `close up: tiles per level ${close.tileRequestsByLevel.join("/")}, ${close.refusedTiles} refused, tile errors ${close.tileErrors}; centre grid lit ${lit}/25, mean luminance ${meanOf(lum).toFixed(1)}`,
  );
  expect(lit).toBe(25);
  expect(close.tileErrors).toBe(0);
  expect(errors).toEqual([]);
});

// WHY (the owner asked how to turn and zoom the globe with fingers): the
// controls must answer real touch input, not only the mouse. Chromium's
// touch events (through the DevTools protocol, as a phone's would arrive)
// drive a one-finger drag, then a two-finger pinch: the drag takes the
// camera and turns the globe, the pinch brings the camera down.
test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
  test("a one-finger drag turns the globe and a pinch zooms in", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const { errors, state: before } = await bootArrived(page);
    const c = await canvasCentre(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
      });
    // One finger, 200 px to the right.
    await touch("touchStart", [[c.x, c.y]]);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", [[c.x + 20 * i, c.y]]);
      await frames(page, 2);
    }
    await touch("touchEnd", []);
    await frames(page, 30);
    const dragged = await page.evaluate(() => window.__globeLab.state());
    const dLng = dragged.centreLatLon.lng - before.centreLatLon.lng;
    console.log(
      `touch drag 200 px right: centre moved ${dLng.toFixed(2)}° in longitude`,
    );
    expect(dragged.cameraOwner).toBe("controls");
    expect(dLng).toBeLessThan(-10);
    // Two fingers, 80 px apart, spread to 400 px.
    await touch("touchStart", [
      [c.x - 40, c.y],
      [c.x + 40, c.y],
    ]);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", [
        [c.x - 40 - 16 * i, c.y],
        [c.x + 40 + 16 * i, c.y],
      ]);
      await frames(page, 2);
    }
    await touch("touchEnd", []);
    await frames(page, 30);
    const pinched = await page.evaluate(() => window.__globeLab.state());
    console.log(
      `pinch 80 -> 400 px: altitude ${(dragged.altitudeM / 1000).toFixed(0)} -> ${(pinched.altitudeM / 1000).toFixed(0)} km`,
    );
    expect(pinched.cameraOwner).toBe("controls");
    expect(pinched.altitudeM).toBeLessThan(dragged.altitudeM * 0.9);
    expect(errors).toEqual([]);
  });
});
