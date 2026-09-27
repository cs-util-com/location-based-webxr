// @ts-check
/**
 * The globe lab's imagery depth, sky and time (round-2 plan 2026-09-26-2055
 * M3 c-f, round-3 plan 2026-09-27-0532 §4 F): level 4 of the imagery, the
 * clock the lab owns, the cloud drift it drives, the background pass with
 * the sun disc, and the device line.
 *
 * Why this file matters: the globe's time is read by everything that moves
 * (the sun, the clouds, and later the dive's hand-over), so a pinned link
 * must reproduce the same scene however long the page runs, and a running
 * clock must visibly move it. The sky is drawn in its own pass behind the
 * Earth, which a far plane or a depth test would otherwise clip or hide
 * silently: only pixels can show it is where the sun says, and not over the
 * Earth. Kept out of `globe.smoke.spec.mjs` so the globe's streams merge in
 * small pieces (round-3 plan §4).
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  arriveAt,
  gridAround,
  luminance,
  meanOf,
} from "./globe-smoke-helpers.mjs";

const PINNED = "2026-03-20T11:00:00Z";

/** Boots the lab at a hash and waits for it to report ready (no settle). */
async function bootLab(page, hash) {
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
  return errors;
}

// WHY (round-2 plan 2026-09-26-2055 DEC-FB2-4): level 4 of the Blue Marble
// pyramid is committed for closer views. It must actually be served and
// drawn where a level-3 texel is too coarse for the error target, without a
// tile error. On the fitted view a level-3 texel is about half a pixel, so
// the default 1 px target should not need level 4 at all (logged, not
// asserted: stream E's closer views change it); a 0.25 px target must.
test("level 4 of the imagery loads where level 3 is too coarse", async ({
  page,
}) => {
  // Two settled views of up to 120 s each (see arriveAt).
  test.setTimeout(300_000);
  const view = "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z";
  const errors = await bootLab(page, view);
  const fitted = await arriveAt(page, { lat: 30, lng: 15 });
  await applyHash(page, `${view}&errorTarget=0.25`);
  // Level 4 must be asked for before the settle wait starts: with the same
  // target and tile count, the wait would pass at once.
  await page.waitForFunction(
    () => window.__globeLab.state().tileRequestsByLevel[4] > 0,
    null,
    { timeout: 120_000 },
  );
  const fine = await arriveAt(page, { lat: 30, lng: 15 });
  const report = (s) =>
    `per level ${s.tileRequestsByLevel.join("/")}, ${s.loadedTiles} loaded, ${s.refusedTiles} refused, ${(s.cachedBytes / 2 ** 20).toFixed(1)} MiB cached`;
  console.log(
    `z4: at 1 px ${report(fitted)}; at 0.25 px ${report(fine)}; tile errors ${fine.tileErrors}`,
  );
  expect(fine.tileRequestsByLevel[4]).toBeGreaterThan(0);
  expect(fine.tileErrors).toBe(0);
  expect(errors).toEqual([]);
});

/** Waits for two animation frames, so the page has drawn in between. */
const twoFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

// WHY (round-3 plan §4 F, §8 finding 17): the dive's hand-over will pass
// "the globe's time" on, and every probe in the globe smokes pins `time=`.
// A pinned clock must therefore stand still across frames (a clock that crept
// would move the sun under a probe), a typed offset must read as the same
// instant, `timeScale` must make the same pin run, and the plate must show
// the effective speed.
test("the lab's clock: pinned stands still, timeScale runs it", async ({
  page,
}) => {
  const view = "at=30,15&spinMs=0&turnMs=0";
  const errors = await bootLab(page, `${view}&time=${PINNED}`);
  const pinnedMs = Date.parse(PINNED);
  const first = await page.evaluate(() => window.__globeLab.state());
  await twoFrames(page);
  const second = await page.evaluate(() => window.__globeLab.state());
  expect(first.timeMs).toBe(pinnedMs);
  expect(second.timeMs).toBe(pinnedMs);
  expect(second.clock).toEqual({ startMs: pinnedMs, scale: 0 });
  await expect(page.locator('[data-hash-key="timeScale"]')).toHaveValue("0");

  // A hand-typed offset: "+" arrives as a space, and is put back.
  await applyHash(page, `${view}&time=2026-03-20T13:00:00+02:00`);
  expect(await page.evaluate(() => window.__globeLab.state().timeMs)).toBe(
    pinnedMs,
  );

  // The same pin, running at an hour per second.
  await applyHash(page, `${view}&time=${PINNED}&timeScale=3600`);
  await page.waitForFunction(
    (pin) => window.__globeLab.state().timeMs > pin + 60_000,
    pinnedMs,
  );
  expect(await page.evaluate(() => window.__globeLab.state().clock.scale)).toBe(
    3600,
  );
  await expect(page.locator('[data-hash-key="timeScale"]')).toHaveValue("3600");

  // No time at all: the wall clock, at real time.
  await applyHash(page, view);
  const now = await page.evaluate(() => ({
    scene: window.__globeLab.state().timeMs,
    wall: Date.now(),
  }));
  expect(Math.abs(now.scene - now.wall)).toBeLessThan(60_000);
  await expect(page.locator('[data-hash-key="timeScale"]')).toHaveValue("1");
  expect(errors).toEqual([]);
});

const readAt = (page, points) =>
  page.evaluate((p) => window.__globeLab.readPixels(p), points);
const DEG = Math.PI / 180;
/** The shortest angle between two angles in radians, in [0, π]. */
const angleBetween = (a, b) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

// WHY (round-2 plan 2026-09-26-2055 M3f): the clouds are a layer of their
// own, so they drift over the ground with the globe's clock. The offset must
// be a function of the instant (a pinned link shows the same clouds on every
// load; two pinned times a known distance apart), and it must reach the
// pixels: with the drift on, the same view at the same instant shows the
// clouds elsewhere, and with the clouds off it cannot (the control that
// proves the difference is the clouds, not anything else).
test("the clouds drift with the clock", async ({ page }) => {
  test.setTimeout(300_000);
  const view = "at=30,15&spinMs=0&turnMs=0";
  const t1 = PINNED;
  const t2 = "2026-03-20T11:01:00Z";
  const errors = await bootLab(page, `${view}&time=${t1}&cloudDrift=0.5`);
  const a = await page.evaluate(() => window.__globeLab.state());
  await applyHash(page, `${view}&time=${t2}&cloudDrift=0.5`);
  const b = await page.evaluate(() => window.__globeLab.state());
  // 60 s at 0.5 °/s: 30° further east, modulo a turn.
  const moved =
    (b.cloudLonOffsetRad - a.cloudLonOffsetRad + 4 * Math.PI) % (2 * Math.PI);
  console.log(
    `cloud offset: ${(a.cloudLonOffsetRad / DEG).toFixed(4)}° at ${t1}, ${(b.cloudLonOffsetRad / DEG).toFixed(4)}° at ${t2}, moved ${(moved / DEG).toFixed(4)}°`,
  );
  expect(angleBetween(moved, 30 * DEG)).toBeLessThan(1e-6);
  expect(b.cloudDrift).toBe(0.5);
  // Pinned: the same instant gives the same offset again.
  await applyHash(page, `${view}&time=${t1}&cloudDrift=0.5`);
  await applyHash(page, `${view}&time=${t2}&cloudDrift=0.5`);
  expect(
    await page.evaluate(() => window.__globeLab.state().cloudLonOffsetRad),
  ).toBe(b.cloudLonOffsetRad);
  await applyHash(page, `${view}&time=${t1}&cloudDrift=0`);
  expect(
    await page.evaluate(() => window.__globeLab.state().cloudLonOffsetRad),
  ).toBe(0);

  // The pixels: the same view at t2, the clouds drifted 30° or not. (Not
  // at t1: 11:00:00 UTC is a whole number of 720 s turns at 0.5 °/s, so the
  // drift there is exactly 0, as the first line of this test logged.)
  await arriveAt(page, { lat: 30, lng: 15 });
  const grid = gridAround([0.5, 0.5], 0.15, 9);
  const shot = async (extra) => {
    await applyHash(page, `${view}&time=${t2}&${extra}`);
    return (await readAt(page, grid)).map(luminance);
  };
  const meanAbsDiff = (x, y) => meanOf(x.map((v, i) => Math.abs(v - y[i])));
  const moves = meanAbsDiff(
    await shot("cloudDrift=0"),
    await shot("cloudDrift=0.5"),
  );
  const bare = meanAbsDiff(
    await shot("cloudDrift=0&cloudOpacity=0"),
    await shot("cloudDrift=0.5&cloudOpacity=0"),
  );
  // The floor, reported across ±50 % (owner rule 2026-09-13).
  const FLOOR = 5;
  console.log(
    `cloud drift, mean |Δ luminance| over 81 probes: ${moves.toFixed(2)} (clouds off: ${bare.toFixed(2)}); floor ${FLOOR}: ` +
      [0.5, 1, 1.5]
        .map(
          (k) =>
            `x${k} ${moves > FLOOR * k && bare <= FLOOR * k ? "ok" : "NO"}`,
        )
        .join(" "),
  );
  expect(moves).toBeGreaterThan(FLOOR);
  expect(bare).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

/**
 * The equinox noon views for the sky (the sun stands over about 1.86°E):
 * - beside the Earth: a view centred 150° west of the subsolar point, so
 *   the sun is 30° off the view's axis, past the Earth's limb (about 23°
 *   off on a 1280x800 canvas at fovY 50°) and inside the frame (37°);
 * - behind the Earth: the antisolar point (1.86° - 180°), so the sun is at
 *   the centre, behind the Earth's night side.
 */
const NOON = "time=2026-03-20T12:00:00Z&cloudDrift=0";
const BESIDE = { lat: 0, lng: -148.14 };
const BEHIND = { lat: 0, lng: -178.14 };
const at = ({ lat, lng }) => `at=${lat},${lng}&spinMs=0&turnMs=0&${NOON}`;

// WHY (round-2 plan M3e): the sun is a disc with a soft glow, drawn where the
// sun direction says, in a background pass. Where: the brightest pixels near
// the projected sun direction must be centred on it (a mirrored or unsynced
// sky camera puts them elsewhere), white (tone mapping of the disc), black
// with the sky pass off (so the sky pass drew it, and the sun is not over
// the Earth in this view), and the glow must fall off with the angle.
test("the sun is a disc with a soft glow, where the sun is", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await bootLab(page, at(BESIDE));
  await arriveAt(page, BESIDE);
  const state = await page.evaluate(() => window.__globeLab.state());
  const sun = state.sky.sunScreen;
  console.log(`sun at ${JSON.stringify(sun)}, ${JSON.stringify(state.sky)}`);
  expect(sun).not.toBeNull();
  for (const c of sun) {
    expect(c).toBeGreaterThan(0.02);
    expect(c).toBeLessThan(0.98);
  }
  const { width, height } = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    return { width: c.width, height: c.height };
  });
  // A 31 x 31 pixel window around the projected sun.
  const window31 = [];
  for (let i = -15; i <= 15; i++) {
    for (let j = -15; j <= 15; j++) {
      window31.push([sun[0] + i / width, sun[1] + j / height]);
    }
  }
  const lum = (await readAt(page, window31)).map(luminance);
  const peak = Math.max(...lum);
  const brightest = window31.filter((_, k) => lum[k] >= peak - 1);
  const cx = meanOf(brightest.map((p) => p[0]));
  const cy = meanOf(brightest.map((p) => p[1]));
  const offPx = Math.hypot((cx - sun[0]) * width, (cy - sun[1]) * height);
  const [centreOn] = await readAt(page, [sun]);
  // The glow along the great circle from the sun towards the north (up
  // the screen, away from the Earth beside it), at 0.5° to 8°.
  const [sx, sy, sz] = state.sky.sunDirection;
  const north = [-sz * sx, -sz * sy, 1 - sz * sz];
  const nl = Math.hypot(...north);
  const perp = north.map((v) => v / nl);
  const profile = [];
  for (const deg of [0.5, 1, 2, 4, 8]) {
    const a = deg * DEG;
    const dir = [sx, sy, sz].map(
      (v, k) => v * Math.cos(a) + perp[k] * Math.sin(a),
    );
    const p = await page.evaluate(
      (d) => window.__globeLab.projectDirection(d),
      dir,
    );
    profile.push([deg, p ? luminance((await readAt(page, [p]))[0]) : null]);
  }
  await applyHash(page, `${at(BESIDE)}&sky=0`);
  const [centreOff] = await readAt(page, [sun]);
  console.log(
    `sun disc: peak ${peak.toFixed(1)}, ${brightest.length} px at peak, centroid ${offPx.toFixed(2)} px from the projected sun; centre ${centreOn} (sky off ${centreOff}); glow ${profile.map(([d, l]) => `${d}°: ${l?.toFixed(1)}`).join(", ")}`,
  );
  expect(luminance(centreOn)).toBeGreaterThan(240);
  expect(offPx).toBeLessThan(2);
  expect(centreOff.slice(0, 3)).toEqual([0, 0, 0]);
  // The glow is there and falls off.
  const glow = profile.map(([, l]) => l);
  for (const l of glow) expect(l).not.toBeNull();
  for (let k = 1; k < glow.length; k++) {
    expect(glow[k]).toBeLessThanOrEqual(glow[k - 1]);
  }
  expect(glow[0]).toBeGreaterThan(glow[glow.length - 1] + 20);
  expect(errors).toEqual([]);
});

// WHY (round-2 plan M3d/e): the sky is drawn FIRST and without depth, so the
// Earth must cover it: with the sun straight behind the Earth, the Earth's
// pixels are the same with the sky pass on and off. A sky drawn after the
// Earth, or one that wrote depth, would put a white disc on the night side.
test("the Earth covers the sky: the sun behind it does not show through", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await bootLab(page, at(BEHIND));
  await arriveAt(page, BEHIND);
  const state = await page.evaluate(() => window.__globeLab.state());
  const sun = state.sky.sunScreen;
  expect(sun).not.toBeNull();
  expect(Math.hypot(sun[0] - 0.5, sun[1] - 0.5)).toBeLessThan(0.01);
  const grid = gridAround(sun, 0.01, 5);
  const on = (await readAt(page, grid)).map(luminance);
  await applyHash(page, `${at(BEHIND)}&sky=0`);
  const off = (await readAt(page, grid)).map(luminance);
  const worst = Math.max(...on.map((v, k) => Math.abs(v - off[k])));
  console.log(
    `behind the Earth: max luminance ${Math.max(...on).toFixed(1)} (sky off ${Math.max(...off).toFixed(1)}), worst difference ${worst.toFixed(2)}`,
  );
  expect(worst).toBeLessThan(1);
  expect(Math.max(...on)).toBeLessThan(200);
  expect(errors).toEqual([]);
});

// WHY (terrain plan 2026-09-27-0605 §7): the terrain dive needs float
// textures filtered linearly, which not every phone offers. The lab states
// it in a line the owner can read on his phone before that work starts.
test("the device line says whether float textures filter linearly", async ({
  page,
}) => {
  const errors = await bootLab(page, "at=30,15&spinMs=0&turnMs=0");
  const state = await page.evaluate(() => window.__globeLab.state());
  console.log(`device: ${JSON.stringify(state.device)}; "${state.deviceLine}"`);
  expect(typeof state.device.floatLinear).toBe("boolean");
  await expect(page.locator("#globe-device")).toHaveText(
    `This device filters float textures (OES_texture_float_linear): ${state.device.floatLinear ? "yes" : "NO"}`,
  );
  // Against a context of its own, not the page's report.
  const direct = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    return gl ? gl.getExtension("OES_texture_float_linear") !== null : null;
  });
  expect(state.device.floatLinear).toBe(direct);
  expect(errors).toEqual([]);
});
