// @ts-check
/**
 * The globe lab's imagery depth, sky and time (round-2 plan 2026-09-26-2055
 * M3 c-f, round-3 plan 2026-09-27-0532 §4 F): level 4 of the imagery, the
 * clock the lab owns, the cloud drift it drives, the background pass with
 * the sun disc and the procedural stars, and the device line.
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
  withPreRound4Look,
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
// pyramid is committed for closer views. It must be served, requested and
// loaded where a level-3 texel is too coarse for the error target, without
// a tile error. (Whether a level-4 tile is DRAWN is not asserted: at 0.25
// px the 64 MiB cache refuses hundreds of tiles, and the lab has no closer
// camera until stream E; stream F review, finding 9.) On the fitted view a level-3 texel is about half a pixel, so
// the default 1 px target should not need level 4 at all (logged, not
// asserted: stream E's closer views change it); a 0.25 px target must.
test("level 4 of the imagery is requested and loads without an error where level 3 is too coarse", async ({
  page,
}) => {
  // Two settled views of up to 120 s each (see arriveAt).
  test.setTimeout(300_000);
  // The atmosphere pass is off (`atmo=0`): this test is about the imagery
  // and the camera, and on the CPU rasteriser the pass doubles the frame
  // time, and the tiles stream about one a frame, so a cold settle took
  // 117-120 s with it on against 51 s off (fresh contexts, both orders,
  // 2026-09-30), against a 120 s settle bound.
  const view = "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&atmo=0";
  const errors = await bootLab(page, view);
  const fitted = await arriveAt(page, { lat: 30, lng: 15 });
  await applyHash(page, `${view}&errorTarget=0.25`);
  // Not a settle: at 0.25 px the 64 MiB cache is full and refuses tiles,
  // so the tile count may never hold still (a settle wait timed out there
  // under load, 3 of 5 runs). The claim needs COMPLETED level-4 responses:
  // the resource timing log records a request only once it has finished.
  await page.waitForFunction(
    () => window.__globeLab.state().tileRequestsByLevel[4] >= 16,
    null,
    { timeout: 120_000 },
  );
  const fine = await page.evaluate(() => window.__globeLab.state());
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

// WHY (stream F review, finding 1): a fast clock must not strobe the
// clouds. The drift per real second, measured over half a second of the
// page's own clock: at 600x it must be the 1x rate (0.5 °/s); it was
// 300 °/s. No settle: this reads the page's state.
test("at 600x the clouds drift at the real-time rate", async ({ page }) => {
  const view = "at=30,15&spinMs=0&turnMs=0";
  const errors = await bootLab(page, `${view}&time=${PINNED}&timeScale=600`);
  const rate = await page.evaluate(async () => {
    const a = window.__globeLab.state();
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 500));
    const b = window.__globeLab.state();
    const seconds = (performance.now() - t0) / 1000;
    const turn = 2 * Math.PI;
    let d = (b.cloudLonOffsetRad - a.cloudLonOffsetRad) % turn;
    if (d > Math.PI) d -= turn;
    if (d < -Math.PI) d += turn;
    return { degPerS: (d * 180) / Math.PI / seconds, drift: b.cloudDrift };
  });
  console.log(
    `drift at 600x: ${rate.degPerS.toFixed(3)} °/s (the 1x rate ${rate.drift} °/s)`,
  );
  expect(Math.abs(rate.degPerS - rate.drift)).toBeLessThan(rate.drift * 0.25);
  expect(errors).toEqual([]);
});

// WHY (stream F review, finding 12): the hour label must follow a running
// clock (it stood at the pin's hour) and say the speed it runs at.
test("the hour label follows a running clock and names its speed", async ({
  page,
}) => {
  const view = "at=30,15&spinMs=0&turnMs=0";
  const errors = await bootLab(page, `${view}&time=${PINNED}&timeScale=3600`);
  const first = await page.evaluate(() => window.__globeLab.state().hourLabel);
  console.log(`hour label at the start: "${first}"`);
  expect(first).toContain("x3600");
  await page.waitForFunction(
    (was) => window.__globeLab.state().hourLabel !== was,
    first,
    { timeout: 5000 },
  );
  expect(errors).toEqual([]);
});

// WHY (stream F review, finding 6): a speed change from the plate must
// carry on from the current instant; it rewound to the old pin.
test("a speed change from the plate carries on from the current instant", async ({
  page,
}) => {
  const view = "at=30,15&spinMs=0&turnMs=0";
  const errors = await bootLab(page, `${view}&time=${PINNED}&timeScale=3600`);
  await page.waitForFunction(
    (pin) => window.__globeLab.state().timeMs > pin + 2 * 3_600_000,
    Date.parse(PINNED),
  );
  const before = await page.evaluate(() => window.__globeLab.state().timeMs);
  await page.locator('[data-hash-key="timeScale"]').selectOption("60");
  const after = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `speed change: ${new Date(before).toISOString()} before, ${new Date(after.timeMs).toISOString()} after; hash ${after.appliedHash}`,
  );
  expect(after.clock.scale).toBe(60);
  expect(after.timeMs).toBeGreaterThanOrEqual(before);
  expect(new URLSearchParams(after.appliedHash).get("time")).not.toBe(PINNED);
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
  // The look its floor was measured on (none of these keys varies below).
  const view = withPreRound4Look("at=30,15&spinMs=0&turnMs=0");
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
  // The stars and the Milky Way off: a star on a probe would pass for glow.
  // The disc and glow it was measured with (`withPreRound4Look`).
  const disc = withPreRound4Look(`${at(BESIDE)}&stars=0&milkyWay=0`);
  const errors = await bootLab(page, disc);
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
  await applyHash(page, `${disc}&sky=0`);
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
  const behind = withPreRound4Look(at(BEHIND));
  const errors = await bootLab(page, behind);
  await arriveAt(page, BEHIND);
  const state = await page.evaluate(() => window.__globeLab.state());
  const sun = state.sky.sunScreen;
  expect(sun).not.toBeNull();
  expect(Math.hypot(sun[0] - 0.5, sun[1] - 0.5)).toBeLessThan(0.01);
  const grid = gridAround(sun, 0.01, 5);
  const on = (await readAt(page, grid)).map(luminance);
  await applyHash(page, `${behind}&sky=0`);
  const off = (await readAt(page, grid)).map(luminance);
  const worst = Math.max(...on.map((v, k) => Math.abs(v - off[k])));
  console.log(
    `behind the Earth: max luminance ${Math.max(...on).toFixed(1)} (sky off ${Math.max(...off).toFixed(1)}), worst difference ${worst.toFixed(2)}`,
  );
  expect(worst).toBeLessThan(1);
  expect(Math.max(...on)).toBeLessThan(200);
  expect(errors).toEqual([]);
});

// WHY (round-2 plan M3d, owner decision on Q2: procedural stars): the stars
// fill space behind the Earth and the Earth covers them. In the view with
// the sun behind the Earth (no glow in space), the Milky Way off: with the
// stars on, pixels brighter than the threshold appear OUTSIDE the Earth's
// disc and none with the stars off; INSIDE the disc the image is the same
// with the stars on and off. A sky drawn after the Earth, or one that wrote
// depth, would add stars to the night side.
test("procedural stars shine in space, and never over the Earth", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const view = withPreRound4Look(`${at(BEHIND)}&milkyWay=0`);
  const errors = await bootLab(page, view);
  const state = await arriveAt(page, BEHIND);
  const { height } = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    return { height: c.height };
  });
  // The Earth's disc: its angular radius from the camera, in device pixels.
  const angular = Math.asin(state.radiusM / state.distance);
  const rPx =
    ((height / 2) * Math.tan(angular)) / Math.tan((state.fovY * DEG) / 2);
  const stats = (r, t) =>
    page.evaluate(
      ([circle, threshold]) => window.__globeLab.regionStats(circle, threshold),
      [{ cx: 0.5, cy: 0.5, rPx: r }, t],
    );
  const THRESHOLDS = [10, 20, 40];
  const on = { inside: await stats(rPx * 0.97, 20) };
  on.outside = await Promise.all(THRESHOLDS.map((t) => stats(rPx * 1.03, t)));
  await applyHash(page, `${view}&stars=0`);
  const off = { inside: await stats(rPx * 0.97, 20) };
  off.outside = await Promise.all(THRESHOLDS.map((t) => stats(rPx * 1.03, t)));
  console.log(
    `stars: ${state.sky.stars.count} to mag ${state.sky.stars.magLimit}; Earth disc ${rPx.toFixed(1)} px; ` +
      `bright pixels in space on/off at ${THRESHOLDS.map((t, k) => `${t}: ${on.outside[k].outsideBright}/${off.outside[k].outsideBright}`).join(", ")}; ` +
      `luminance over the Earth on ${on.inside.insideSum.toFixed(0)}, off ${off.inside.insideSum.toFixed(0)}`,
  );
  for (let k = 0; k < THRESHOLDS.length; k++) {
    expect(off.outside[k].outsideBright).toBe(0);
  }
  expect(on.outside[1].outsideBright).toBeGreaterThan(20);
  expect(on.inside.insideSum).toBe(off.inside.insideSum);
  expect(errors).toEqual([]);
});

// WHY (round-2 plan M3d): the stars turn with Greenwich sidereal time, and
// the sun is placed by the framework's solar position; both must share one
// frame, or the stars would wheel against the sun. At the March equinox
// the sun's right ascension is 0h, and at the June solstice 6h (90°): the
// sun's ECEF longitude plus the sidereal angle must give exactly that.
// Two instants, so a flipped sign cannot pass both. And through what is
// RENDERED (stream F review, finding 5): the sun's celestial direction at
// those instants, turned by the rotation the sky pass draws the stars with,
// must land on the direction the sky pass draws the sun in.
test("the star frame and the sun agree: right ascension 0h at the equinox, 6h at the solstice", async ({
  page,
}) => {
  const errors = await bootLab(page, "at=0,0&spinMs=0&turnMs=0");
  const cases = [
    ["2026-03-20T14:46:00Z", 0],
    ["2026-06-21T08:24:00Z", 90],
  ];
  // The sun's celestial direction: RA 0h Dec 0 at the equinox; RA 6h Dec
  // +23.436° (the obliquity) at the solstice.
  const eps = 23.436 * DEG;
  const celestialSun = {
    0: [1, 0, 0],
    90: [0, Math.cos(eps), Math.sin(eps)],
  };
  const report = [];
  for (const [time, expectedDeg] of cases) {
    await applyHash(page, `at=0,0&spinMs=0&turnMs=0&time=${time}`);
    const s = await page.evaluate(() => window.__globeLab.state());
    const [x, y] = s.sunEcef;
    const ra =
      ((((Math.atan2(y, x) + s.sky.siderealAngleRad) / DEG) % 360) + 360) % 360;
    const miss = Math.min(
      Math.abs(ra - expectedDeg),
      360 - Math.abs(ra - expectedDeg),
    );
    const drawn = await page.evaluate(
      (v) => window.__globeLab.celestialToWorld(v),
      celestialSun[expectedDeg],
    );
    const [ux, uy, uz] = s.sky.sunDirection;
    const apart =
      Math.acos(Math.min(1, drawn[0] * ux + drawn[1] * uy + drawn[2] * uz)) /
      DEG;
    report.push(
      `${time}: RA ${ra.toFixed(3)}° (expected ${expectedDeg}°), the drawn star frame's sun ${apart.toFixed(3)}° from the drawn sun`,
    );
    expect(miss).toBeLessThan(0.3);
    expect(apart).toBeLessThan(0.3);
  }
  console.log(`sun against the star frame: ${report.join("; ")}`);
  // The credits say the stars are not a catalogue.
  await expect(page.locator("#globe-credits")).toContainText(
    "Stars: procedural, not a star catalogue.",
  );
  expect(errors).toEqual([]);
});

// WHY (stream F review, finding 2): the faintest-star limit must reach the
// pixels. Stars past it used a point size of 0, which WebGL leaves undefined
// and ANGLE draws as one pixel, so the limit hid nothing. In space beside
// the Earth, with the Milky Way off, the light from the stars must fall as
// the limit rises: at 0.5 (a handful of stars in the whole sky) almost
// nothing is left.
test("the faintest-star limit reaches the pixels", async ({ page }) => {
  const view = `${at(BEHIND)}&milkyWay=0`;
  const errors = await bootLab(page, view);
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
  );
  const state = await page.evaluate(() => window.__globeLab.state());
  const { height } = await page.evaluate(() => ({
    height: document.getElementById("globe-canvas").height,
  }));
  const rPx =
    ((height / 2) * Math.tan(Math.asin(state.radiusM / state.distance))) /
    Math.tan((state.fovY * DEG) / 2);
  const light = {};
  for (const mag of [6.5, 3.5, 0.5]) {
    // The pre-round-4 gain, appended AFTER the limit (the first key wins).
    await applyHash(page, withPreRound4Look(`${view}&starMag=${mag}`));
    light[mag] = await page.evaluate(
      (r) => window.__globeLab.regionStats({ cx: 0.5, cy: 0.5, rPx: r }, 10),
      rPx * 1.03,
    );
  }
  console.log(
    `star light in space by limit: ${Object.entries(light)
      .map(
        ([m, s]) =>
          `${m}: sum ${s.outsideSum.toFixed(0)}, ${s.outsideBright} px > 10`,
      )
      .join("; ")}`,
  );
  expect(light[3.5].outsideSum).toBeLessThan(light[6.5].outsideSum * 0.5);
  expect(light[0.5].outsideSum).toBeLessThan(light[6.5].outsideSum * 0.05);
  expect(errors).toEqual([]);
});

// WHY (stream F review, finding 3): Neutral tone mapping squares values
// under 0.08, which crushed the faint band to nothing. The Milky Way must
// show: beside the Earth, looking 30° past the galactic centre, the pixels
// around the centre's projected point are brighter with the band on than
// off (the stars off, so only the band differs). The floor is reported
// across ±50 % (owner rule 2026-09-13).
test("the Milky Way is visible towards the galactic centre", async ({
  page,
}) => {
  const time = "time=2026-03-20T12:00:00Z&cloudDrift=0&stars=0";
  const errors = await bootLab(page, `at=0,0&spinMs=0&turnMs=0&${time}`);
  // The galactic centre (J2000) in the world frame the sky pass renders.
  const gcCelestial = [
    Math.cos(-28.93617 * DEG) * Math.cos(266.40499 * DEG),
    Math.cos(-28.93617 * DEG) * Math.sin(266.40499 * DEG),
    Math.sin(-28.93617 * DEG),
  ];
  const g = await page.evaluate(
    (v) => window.__globeLab.celestialToWorld(v),
    gcCelestial,
  );
  // The view's axis 30° east of the centre (so it sits beside the Earth,
  // whose disc spans about 23°), the camera over the antipode of the axis.
  const east = [-g[1], g[0], 0];
  const el = Math.hypot(...east);
  const axis = g.map(
    (v, k) => v * Math.cos(30 * DEG) + (east[k] / el) * Math.sin(30 * DEG),
  );
  const cam = axis.map((v) => -v);
  const target = {
    lat: Math.round((Math.asin(cam[2]) / DEG) * 1000) / 1000,
    lng: Math.round((Math.atan2(cam[1], cam[0]) / DEG) * 1000) / 1000,
  };
  const view = `at=${target.lat},${target.lng}&spinMs=0&turnMs=0&${time}`;
  // The band's radiance its floor was measured with (0.02).
  await applyHash(page, withPreRound4Look(view));
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
  );
  const p = await page.evaluate(
    (v) => window.__globeLab.projectCelestial(v),
    gcCelestial,
  );
  expect(p).not.toBeNull();
  const grid = gridAround(p, 0.01, 7);
  const on = meanOf((await readAt(page, grid)).map(luminance));
  await applyHash(page, withPreRound4Look(`${view}&milkyWay=0`));
  const off = meanOf((await readAt(page, grid)).map(luminance));
  const FLOOR = 10;
  console.log(
    `Milky Way at the galactic centre (${p.map((c) => c.toFixed(3))}): luminance ${on.toFixed(1)} on, ${off.toFixed(1)} off; floor ${FLOOR}: ` +
      [0.5, 1, 1.5]
        .map((k) => `x${k} ${on - off > FLOOR * k ? "ok" : "NO"}`)
        .join(" "),
  );
  expect(on - off).toBeGreaterThan(FLOOR);
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
