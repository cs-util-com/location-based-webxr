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

import {
  arriveAt,
  luminance,
  meanOf,
  plainGlobe,
  routeCityData,
  withPreRound4Look,
} from "./globe-smoke-helpers.mjs";

/**
 * A fixed daylight view with the sky and the pre-round-4 look pinned as the
 * other specs pin them (`globe.smoke.spec.mjs` FIXED_VIEW).
 */
const VIEW = withPreRound4Look(
  "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0",
);

/** Boots the lab at a hash and waits until it has arrived and settled. */
async function bootArrived(page, hash = VIEW) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  // A pin press starts the arrival prefetch: its city data is answered here.
  await routeCityData(page);
  await page.goto(`/labs/globe/#${plainGlobe(hash)}`);
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

/** The smoke server's origin: 5198, or a worktree's `DS_E2E_PORT`. */
const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** Cologne cathedral: where the mocked GPS says the user stands. */
const COLOGNE = { latitude: 50.94128, longitude: 6.95817 };

/**
 * Replaces `navigator.geolocation.getCurrentPosition` before the page
 * loads, so it fails with a given `GeolocationPositionError` code (the
 * browser offers no switch for a timeout or an unavailable position), and
 * only once the test calls `window.__answerGeolocation()`, so the
 * in-progress state is read while it lasts, not raced.
 */
async function failGeolocationWith(page, code) {
  await page.addInitScript((c) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_ok, fail) {
          window.__answerGeolocation = () =>
            fail({ code: c, message: `mocked code ${c}` });
        },
      },
    });
  }, code);
}

/** The pin's view: its label, state and disabled flag, and its status line. */
const pinView = (page) =>
  page.evaluate(() => {
    const b = document.getElementById("globe-pin");
    return {
      label: b.getAttribute("aria-label"),
      state: b.dataset.state,
      disabled: b.disabled,
      busy: b.getAttribute("aria-busy"),
      status: document.getElementById("globe-pin-status").textContent,
      phase: window.__globeLab.state().pin.phase,
    };
  });

// WHY (round-2 M3g; CLAUDE.md's async-feedback rule): the three ways a
// position fails need three different fixes, the pin must say "Finding
// you..." while it waits (busy, and pressable to cancel), and it must come
// back to idle after a failure with the fix named and the atom's warning
// look: a pin stuck on "Finding you..." is the one outcome worse than an
// error.
for (const [code, name, fix] of [
  [1, "denied", /settings/i],
  [3, "timeout", /sky/i],
  [2, "unavailable", /cannot tell where it is/i],
]) {
  test(`the pin names the fix when the position is ${name}, and returns to idle`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await failGeolocationWith(page, code);
    const { errors } = await bootArrived(page);
    expect(await pinView(page)).toMatchObject({
      label: "Fly to my location",
      state: "idle",
      disabled: false,
    });
    await page.locator("#globe-pin").click();
    // In progress: busy, pulsing, and said; still pressable, to cancel.
    expect(await pinView(page)).toMatchObject({
      label: "Finding you... - tap to cancel",
      state: "locating",
      disabled: false,
      busy: "true",
      status: "Finding you... - tap to cancel",
    });
    await page.evaluate(() => window.__answerGeolocation());
    await page.waitForFunction(
      () => window.__globeLab.state().pin.phase === "idle",
    );
    const after = await pinView(page);
    expect(after).toMatchObject({
      phase: "idle",
      state: name,
      disabled: false,
    });
    expect(after.status).toMatch(fix);
    // The camera never left the intro.
    expect((await page.evaluate(() => window.__globeLab.state())).phase).toBe(
      "arrived",
    );
    expect(errors).toEqual([]);
  });
}

// WHY (cold review of stream E, finding 5): a browser can leave the
// request pending while its permission prompt is open, so the pin must not
// be stuck waiting: a second tap cancels, and the answer that arrives later
// for the cancelled request changes nothing.
test("a tap while the pin waits cancels, and the late answer is dropped", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await failGeolocationWith(page, 1);
  const { errors } = await bootArrived(page);
  await page.locator("#globe-pin").click();
  expect((await pinView(page)).phase).toBe("locating");
  await page.locator("#globe-pin").click();
  expect(await pinView(page)).toMatchObject({
    phase: "idle",
    state: "idle",
    status: "Stopped looking for your location.",
  });
  // The cancelled request answers now: nothing may change.
  await page.evaluate(() => window.__answerGeolocation());
  await frames(page, 10);
  expect(await pinView(page)).toMatchObject({
    phase: "idle",
    status: "Stopped looking for your location.",
  });
  expect(errors).toEqual([]);
});

/** Boots with a granted, mocked GPS at Cologne. */
async function bootWithGps(page, context, extra) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COLOGNE);
  return bootArrived(page, extra ? `${VIEW}&${extra}` : VIEW);
}

// WHY (round-2 DEC-FB2-2/3, M3g): a granted position turns the globe and
// dives to the hand-over altitude, then opens the OSM demo's city there.
// The dev server has no /osm/ app, so the page's request is answered here
// and the URL itself is what is checked: the site-relative path, the user
// and the camera at the fix, the camera at the demo's farthest, and the
// globe's pinned time as the demo's solar date and time (the sun is up in
// Cologne at 11:00 UTC on the equinox).
test("a granted position dives there and hands over to the city", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await page.route(`${ORIGIN}/osm/**`, (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>osm stand-in</title>",
        })
      : route.fallback(),
  );
  // The default 15 s dive, so the checks below run while it lasts.
  const { errors } = await bootWithGps(page, context, "");
  const fitted = await page.evaluate(() => window.__globeLab.state());
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "flying",
  );
  const flying = await pinView(page);
  expect(flying).toMatchObject({ state: "located", disabled: false });
  expect(flying.label).toMatch(/stop/i);
  const mid = await page.evaluate(() => window.__globeLab.state());
  expect(mid.phase).toBe("diving");
  expect(mid.cameraOwner).toBe("intro");
  await frames(page, 20);
  // The planes follow the dive down.
  const lower = await page.evaluate(() => window.__globeLab.state());
  expect(lower.near).toBeLessThan(fitted.near);
  await page.waitForURL(/\/osm\//, { timeout: 60_000 });
  const url = new URL(page.url());
  console.log(`hand-over: ${url.href}`);
  expect(url.origin + url.pathname).toBe(`${ORIGIN}/osm/`);
  const q = url.searchParams;
  expect(q.get("lat")).toBe("50.94128");
  expect(q.get("lng")).toBe("6.95817");
  expect(q.get("clat")).toBe("50.94128");
  expect(q.get("clng")).toBe("6.95817");
  // The hand-over distance, well inside OsmDemo's fog (milestone review M1).
  expect(q.get("cdist")).toBe("1800");
  expect(q.get("date")).toBe("2026-03-20");
  // 11:00 UTC at 6.96°E: +27.8 min of longitude, -7.5 min equation of time.
  expect(q.get("time")).toMatch(/^11:2\d$/);
  expect(errors).toEqual([]);
});

/**
 * Sets extra hash keys on the fixed view without changing its target or
 * timing (so the intro is not restarted), and waits until applied.
 */
async function applyHashKeepingView(page, extra) {
  const hash = `${VIEW}&${extra}`;
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForFunction(
    (h) => window.__globeLab.state().appliedHash === h,
    hash,
  );
}

// WHY (round-2 M3g, §5): with the hand-over off the dive holds at the
// hand-over altitude over the fix (to look at the {20, 50, 150} km sweep),
// and the pin is idle again; a press on the globe during a dive stops it
// and leaves the camera to the controls, with no hand-over.
test("the dive lands on the fix at the hand-over altitude, and a touch stops a dive", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const { errors } = await bootWithGps(
    page,
    context,
    "diveMs=3000&handOver=0&handOverKm=50",
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 60_000 },
  );
  const landed = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `landed: altitude ${(landed.altitudeM / 1000).toFixed(2)} km, centre ${landed.centreLatLon?.lat.toFixed(4)}, ${landed.centreLatLon?.lng.toFixed(4)}, near ${(landed.near / 1000).toFixed(1)} km`,
  );
  expect(Math.abs(landed.altitudeM - 50_000)).toBeLessThan(500);
  expect(Math.abs(landed.centreLatLon.lat - COLOGNE.latitude)).toBeLessThan(
    0.01,
  );
  expect(Math.abs(landed.centreLatLon.lng - COLOGNE.longitude)).toBeLessThan(
    0.01,
  );
  expect(landed.pin.status).toMatch(/Arrived 50 km above you/);
  expect(page.url()).toContain("/labs/globe/");
  // A second dive, stopped by a press on the globe early on.
  await page.locator("#globe-replay").click();
  await arriveAt(page, { lat: 30, lng: 15 });
  await applyHashKeepingView(page, "diveMs=20000&handOver=1&handOverKm=50");
  const startM = await page.evaluate(() => window.__globeLab.state().altitudeM);
  await page.locator("#globe-pin").click();
  // The press lands once the dive is under way (below its start), not
  // after a count of frames: the dive runs on the clock, so 30 frames of
  // a slow CPU rasteriser outlasted the 20 s dive and the press found the
  // camera already at 50 km (r760 CI, Linux, and a local gate).
  await page.waitForFunction((start) => {
    const s = window.__globeLab.state();
    return s.pin.phase === "flying" && s.altitudeM < start * 0.99;
  }, startM);
  const c = await canvasCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "idle",
  );
  const stopped = await page.evaluate(() => window.__globeLab.state());
  expect(stopped.cameraOwner).toBe("controls");
  // Stopped: after more frames the camera is still where the press left
  // it, far above the hand-over, and the page stays. (A dive that ran on
  // would be lower by now, and would hand over at 50 km.)
  await frames(page, 30);
  const later = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `touch stop: start ${(startM / 1000).toFixed(0)} km, stopped at ${(stopped.altitudeM / 1000).toFixed(0)} km, 30 frames later ${(later.altitudeM / 1000).toFixed(0)} km`,
  );
  expect(later.altitudeM).toBeGreaterThan(50_000 * 2);
  expect(Math.abs(later.altitudeM - stopped.altitudeM)).toBeLessThan(
    0.01 * stopped.altitudeM,
  );
  expect(later.pin.phase).toBe("idle");
  expect(page.url()).toContain("/labs/globe/");
  expect(errors).toEqual([]);
});

/**
 * Answers the page's hand-over request with 204 No Content, which a
 * browser treats as "stay on this page", and records the URL: the lab then
 * sits in "handing over" as it would when the city opens, without leaving.
 */
async function catchHandOver(page) {
  const urls = [];
  await page.route(`${ORIGIN}/osm/**`, (route) => {
    // The hand-over navigation only: the prefix also serves the prefetch.
    if (!route.request().isNavigationRequest()) return route.fallback();
    urls.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  return urls;
}

// WHY (milestone review of the pin, findings m4, m5 a and c): a flight
// must stop, with no hand-over, whenever the user or the page takes over:
// a press of the pin, a hidden page (another tab, a locked phone: the dive
// would otherwise run on and hand over the moment the page is seen again),
// and a new target in the hash. Each stop leaves the pin idle.
test("a press, a hidden page and a new target each stop a flight without a hand-over", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const urls = await catchHandOver(page);
  const { errors } = await bootWithGps(page, context, "diveMs=30000");
  const flying = () =>
    page.waitForFunction(
      () => window.__globeLab.state().pin.phase === "flying",
    );
  // A press of the pin mid-dive.
  await page.locator("#globe-pin").click();
  await flying();
  await frames(page, 20);
  await page.locator("#globe-pin").click();
  let s = await page.evaluate(() => window.__globeLab.state());
  expect(s.pin.phase).toBe("idle");
  expect(s.phase).toBe("user");
  expect(s.cameraOwner).toBe("controls");
  // A hidden page mid-dive.
  await page.locator("#globe-pin").click();
  await flying();
  await frames(page, 20);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  s = await page.evaluate(() => window.__globeLab.state());
  expect(s.pin.phase).toBe("idle");
  expect(s.phase).toBe("user");
  expect(s.pin.status).toMatch(/hidden/);
  await page.evaluate(() => {
    delete document.visibilityState;
  });
  // A new target in the hash mid-dive: the intro starts again.
  await page.locator("#globe-pin").click();
  await flying();
  await frames(page, 20);
  const runs = s.runs;
  await page.evaluate(() => {
    location.hash = location.hash.replace("at=30,15", "at=10,20");
  });
  await page.waitForFunction((r) => window.__globeLab.state().runs > r, runs);
  s = await page.evaluate(() => window.__globeLab.state());
  expect(s.pin.phase).toBe("idle");
  expect(s.cameraOwner).toBe("intro");
  await frames(page, 30);
  expect(urls).toEqual([]);
  expect(page.url()).toContain("/labs/globe/");
  expect(errors).toEqual([]);
});

// WHY (milestone review of the pin, findings M2 and m5 b): at night where
// the user stands (below civil twilight) the link carries no time, since
// OsmDemo cannot draw that sky, so the city opens at its own afternoon sun;
// and Back from the city restores the lab from the back-forward cache
// exactly as it was left, handing over, so the pin must be idle again and
// a new flight must start.
test("a night hand-over carries no time, and the pin is idle again back from the city", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const urls = await catchHandOver(page);
  // 23:00 UTC on the equinox: night in Cologne.
  const { errors } = await bootWithGps(page, context, "diveMs=2000");
  await page.evaluate(() => {
    location.hash = location.hash.replace(
      "time=2026-03-20T11:00:00Z",
      "time=2026-03-20T23:00:00Z",
    );
  });
  await page.waitForFunction(() =>
    window.__globeLab.state().appliedHash.includes("T23:00:00Z"),
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "handingOver",
    null,
    { timeout: 60_000 },
  );
  await expect.poll(() => urls.length).toBe(1);
  const q = new URL(urls[0]).searchParams;
  console.log(`night hand-over: ${urls[0]}`);
  expect(q.get("lat")).toBe("50.94128");
  expect(q.has("date")).toBe(false);
  expect(q.has("time")).toBe(false);
  expect(await pinView(page)).toMatchObject({ phase: "handingOver" });
  // Back from the city: the page is shown again from the cache.
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  expect(await pinView(page)).toMatchObject({
    phase: "idle",
    disabled: false,
    status: "Back from the city.",
  });
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "flying",
  );
  expect(errors).toEqual([]);
});
