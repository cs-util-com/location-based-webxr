// @ts-check
/**
 * The look presets' glide on the page (round-3 plan 2026-09-27-0532,
 * feedback 1 and §8 findings 6 and 8; preset-glide.js).
 *
 * Why this file matters: the glide's arithmetic is unit-tested
 * (preset-glide.test.mjs); what only the page can show is the wiring. The
 * BUTTONS glide while `api.setPreset` and a link stay instant, the scene
 * actually moves on the glide's frames (a rebuild that never reached the
 * sky would pass every state check), the hash is written once, when the
 * glide settles, a link opened mid-glide wins, and the shadow configuration
 * holds across the 2° floor so no program compiles mid-glide.
 *
 * Every test pauses the render loop and drives the glide with a pinned
 * clock (`pinGlideClock`, `glideTick`): a SwiftShader frame of the slab
 * costs most of a second, so real time would test the machine, not the
 * glide.
 */
import { expect, test } from "@playwright/test";

import { boot, pinnedHash } from "./smoke-boot.mjs";

/** The framework's presets (look-presets.ts), as the page's state keys. */
const LOOKS = {
  golden: {
    elevation: 5,
    azimuth: 265,
    visibility: 45,
    exposureEv: -0.3,
    clouds: 0.3,
  },
  noon: {
    elevation: 58,
    azimuth: 180,
    visibility: 60,
    exposureEv: 0,
    clouds: 0.2,
  },
  dawn: {
    elevation: 2,
    azimuth: 75,
    visibility: 30,
    exposureEv: 0,
    clouds: 0.25,
  },
  blueHour: {
    elevation: -4,
    azimuth: 280,
    visibility: 60,
    exposureEv: -1,
    clouds: 0.15,
  },
  hazy: {
    elevation: 35,
    azimuth: 150,
    visibility: 12,
    exposureEv: 0,
    clouds: 0.5,
  },
};
const GLIDE_MS = 5000;
const lookOf = (state) => ({
  elevation: state.elevation,
  azimuth: state.azimuth,
  visibility: state.visibility,
  exposureEv: state.exposureEv,
  clouds: state.clouds,
});

/** A grid of sky and city points right of the control plate. */
const GRID = [];
for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 5; j++) GRID.push([0.4 + i * 0.13, 0.05 + j * 0.2]);
}

/** Boot, pause the loop, pin the clouds and the glide's clock at 0. */
async function bootPinned(page, hash) {
  const errors = await boot(page, hash);
  await page.evaluate(() => {
    const d = window.__lookdev;
    d.pauseLoop(true);
    d.setCloudOffset(0.1, 0.2);
    d.setView("city");
    d.pinGlideClock(0);
  });
  return errors;
}

/** Pin the clock at `ms`, run one glide frame, return the state after it. */
const tickAt = (page, ms) =>
  page.evaluate((t) => {
    const d = window.__lookdev;
    d.pinGlideClock(t);
    const step = d.glideTick();
    return { step, state: d.stats().state, hash: location.hash };
  }, ms);

test("a preset BUTTON glides: eased, every value moving, exact at the end, hash written when it settles", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const before = await page.evaluate(
    (grid) => window.__lookdev.readPixels(grid),
    GRID,
  );
  await page.locator('[data-preset="noon"]').click();
  // The click starts the glide; nothing has moved yet, and the button shows
  // where it is going.
  const clicked = await page.evaluate(() => ({
    state: window.__lookdev.stats().state,
    pressed: document
      .querySelector('[data-preset="noon"]')
      .getAttribute("aria-pressed"),
    glide: window.__lookdev.glideInfo(),
  }));
  expect(lookOf(clicked.state)).toEqual(LOOKS.golden);
  expect(clicked.pressed).toBe("true");
  expect(clicked.glide).toMatchObject({ active: true, id: "noon" });

  // t = 0.25: a half-way sample cannot see missing easing (round-3 plan §8
  // finding 8). Every value has moved, each by less than a quarter.
  const quarter = await tickAt(page, 0.25 * GLIDE_MS);
  expect(quarter.step).toMatchObject({ rebuild: true, done: false });
  for (const key of ["elevation", "exposureEv", "clouds", "visibility"]) {
    const from = LOOKS.golden[key];
    const to = LOOKS.noon[key];
    const moved = (quarter.state[key] - from) / (to - from);
    expect(moved, `${key} moved`).toBeGreaterThan(0.05);
    expect(moved, `${key} eased below linear`).toBeLessThan(0.22);
  }
  // Toward noon's 180° the short way (265° down), not up through north.
  expect(quarter.state.azimuth).toBeLessThan(265);
  expect(quarter.state.azimuth).toBeGreaterThan(180);
  // The hash still names where the glide started.
  expect(quarter.hash).toContain("preset=golden");
  // The scene moved with it: the rebuild reached the sky and the light.
  const moving = await page.evaluate(
    (grid) => window.__lookdev.readPixels(grid),
    GRID,
  );
  const changed = moving.filter((px, k) =>
    px.slice(0, 3).some((c, ch) => Math.abs(c - before[k][ch]) > 3),
  ).length;
  expect(changed, "grid points changed at t = 0.25").toBeGreaterThan(
    GRID.length / 3,
  );

  // The settling frame: the preset exactly, and the hash written now.
  const end = await tickAt(page, GLIDE_MS);
  expect(end.step).toMatchObject({ rebuild: true, done: true, id: "noon" });
  expect(lookOf(end.state)).toEqual(LOOKS.noon);
  expect(end.state.preset).toBe("noon");
  expect(end.hash).toContain("preset=noon");
  expect(await page.evaluate(() => window.__lookdev.glideInfo().active)).toBe(
    false,
  );
  // And the picture is the instant preset's: the same pixels as a direct
  // setPreset (via golden, so the sky really rebuilds).
  const [glided, direct] = await page.evaluate((grid) => {
    const d = window.__lookdev;
    const g = d.readPixels(grid);
    d.setPreset("golden");
    d.setPreset("noon");
    return [g, d.readPixels(grid)];
  }, GRID);
  const worst = Math.max(
    ...glided.flatMap((px, k) =>
      px.slice(0, 3).map((c, ch) => Math.abs(c - direct[k][ch])),
    ),
  );
  expect(worst, "glided end against the instant preset").toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("golden hour to dawn turns the azimuth the short way, through north", async ({
  page,
}) => {
  // 265° to 75°: 170° through north, not 190° through the south (round-3
  // plan §8 finding 8). Half-way is 350°.
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  // Every frame rebuilds here: this test is about the arc, not the rate.
  await page.evaluate(() => {
    window.__lookdev.setGlideRebuildEvery(1);
    window.__lookdev.glideToPreset("dawn");
  });
  const half = await tickAt(page, 0.5 * GLIDE_MS);
  expect(half.state.azimuth).toBeCloseTo(350, 6);
  const late = await tickAt(page, 0.8 * GLIDE_MS);
  // Past north: in (0°, 75°), reported in [0, 360).
  expect(late.state.azimuth).toBeGreaterThan(0);
  expect(late.state.azimuth).toBeLessThan(75);
  const end = await tickAt(page, GLIDE_MS);
  expect(end.state.azimuth).toBe(75);
  expect(errors).toEqual([]);
});

// The rate the sweep chose (every 2nd frame): the look moves on the first
// frame of a glide and on every second one after it, and holds between.
test("the page rebuilds the sky on every second glide frame", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const r = await page.evaluate((ms) => {
    const d = window.__lookdev;
    d.glideToPreset("noon");
    const out = [];
    for (let frame = 0; frame < 5; frame++) {
      d.pinGlideClock(0.3 * ms + frame * 16.7);
      const step = d.glideTick();
      out.push({ rebuild: step.rebuild, elevation: d.stats().state.elevation });
    }
    return { rows: out, every: d.glideInfo().rebuildEvery };
  }, GLIDE_MS);
  expect(r.every).toBe(2);
  expect(r.rows.map((x) => x.rebuild)).toEqual([
    true,
    false,
    true,
    false,
    true,
  ]);
  // The state moves only on the rebuild frames.
  expect(r.rows[1].elevation).toBe(r.rows[0].elevation);
  expect(r.rows[2].elevation).toBeGreaterThan(r.rows[1].elevation);
  expect(r.rows[3].elevation).toBe(r.rows[2].elevation);
  expect(errors).toEqual([]);
});

test("a click mid-glide turns toward the new preset from where the scene is", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  await page.locator('[data-preset="noon"]').click();
  const mid = await tickAt(page, 0.5 * GLIDE_MS);
  await page.locator('[data-preset="hazy"]').click();
  // The first frame of the new glide is where the scene was: no jump back
  // to golden hour, no jump ahead to noon.
  const turned = await tickAt(page, 0.5 * GLIDE_MS);
  expect(lookOf(turned.state)).toEqual(lookOf(mid.state));
  expect(turned.step.id).toBe("hazy");
  // Five full seconds from the second click.
  const almost = await tickAt(page, 1.5 * GLIDE_MS - 10);
  expect(almost.step.done).toBe(false);
  const end = await tickAt(page, 1.5 * GLIDE_MS);
  expect(lookOf(end.state)).toEqual(LOOKS.hazy);
  expect(end.hash).toContain("preset=hazy");
  expect(errors).toEqual([]);
});

test("a link opened mid-glide cancels the glide and applies the link at once", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  await page.evaluate(() => window.__lookdev.glideToPreset("noon"));
  await tickAt(page, 0.25 * GLIDE_MS);
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#${pinnedHash("preset=blueHour&tone=agx")}`,
  );
  await expect
    .poll(() => page.evaluate(() => window.__lookdev.stats().state.preset))
    .toBe("blueHour");
  expect(
    lookOf(await page.evaluate(() => window.__lookdev.stats().state)),
  ).toEqual(LOOKS.blueHour);
  // The old glide is gone: a later frame changes nothing.
  const later = await tickAt(page, 0.9 * GLIDE_MS);
  expect(later.step).toBeNull();
  expect(lookOf(later.state)).toEqual(LOOKS.blueHour);
  expect(errors).toEqual([]);
});

test("api.setPreset and a moved slider stay instant, and stop a glide", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const r = await page.evaluate(() => {
    const d = window.__lookdev;
    d.glideToPreset("noon");
    d.setPreset("hazy");
    const afterSetPreset = { state: d.stats().state, glide: d.glideInfo() };
    d.glideToPreset("dawn");
    const slider = document.querySelector("#exposure");
    slider.value = "1.5";
    slider.dispatchEvent(new Event("input"));
    return {
      afterSetPreset,
      afterSlider: { state: d.stats().state, glide: d.glideInfo() },
    };
  });
  expect(r.afterSetPreset.glide.active).toBe(false);
  expect(r.afterSetPreset.state.preset).toBe("hazy");
  expect(r.afterSlider.glide.active).toBe(false);
  expect(r.afterSlider.state.preset).toBe("custom");
  expect(r.afterSlider.state.exposureEv).toBe(1.5);
  expect(errors).toEqual([]);
});

// Round-3 plan §8 finding 6: golden hour (5°) to blue hour (-4°) crosses
// the page's 2° shadow floor. Switching the shadow off mid-glide changes
// every lit material's shadow count, and three compiles new programs: a
// hitch in the middle of the glide. The configuration is held for the
// whole glide and changes only when it settles (off at blue hour) or when
// it starts (on, for blue hour to golden hour).
for (const [from, to] of [
  ["golden", "blueHour"],
  ["blueHour", "golden"],
]) {
  test(`no program compiles mid-glide across the 2° shadow floor (${from} to ${to})`, async ({
    page,
  }) => {
    const errors = await bootPinned(page, `preset=${from}&tone=agx&shadows=1`);
    const r = await page.evaluate(
      ([target, ms]) => {
        const d = window.__lookdev;
        const ids = () => d.programIds().join(",");
        d.readPixels([[0.5, 0.5]]);
        const before = ids();
        d.glideToPreset(target);
        const frames = [];
        for (const t of [0.02, 0.2, 0.4, 0.5, 0.6, 0.8, 0.98]) {
          d.pinGlideClock(t * ms);
          d.glideTick();
          d.readPixels([[0.5, 0.5]]);
          frames.push({
            t,
            elevation: d.stats().state.elevation,
            ids: ids(),
            shadows: d.shadowRenders() !== null,
          });
        }
        d.pinGlideClock(ms);
        d.glideTick();
        d.readPixels([[0.5, 0.5]]);
        return {
          before,
          frames,
          after: ids(),
          shadowsAfter: d.shadowRenders() !== null,
        };
      },
      [to, GLIDE_MS],
    );
    console.log(
      `glide ${from} -> ${to}: programs before ${r.before.split(",").length}, ` +
        `first frame ${r.frames[0].ids.split(",").length}, after ${r.after.split(",").length}`,
    );
    // It did cross the floor.
    const elevations = r.frames.map((f) => f.elevation);
    expect(Math.min(...elevations)).toBeLessThan(2);
    expect(Math.max(...elevations)).toBeGreaterThan(2);
    // The shadow stays on for the whole glide, below the floor too.
    expect(r.frames.every((f) => f.shadows)).toBe(true);
    // From the first glide frame on, not one new program until it settles.
    for (const f of r.frames) {
      expect(f.ids, `programs at t = ${f.t}`).toBe(r.frames[0].ids);
    }
    // Settled at blue hour, the floor applies again: the shadow is off,
    // exactly as an instant preset leaves it.
    expect(r.shadowsAfter).toBe(to !== "blueHour");
    expect(errors).toEqual([]);
  });
}

// --- The milestone review's findings (2026-09-28) ------------------------

// Review finding 1: a link that names no preset stops a glide where it is,
// and the look it leaves is no preset's. Before the fix the state kept the
// glide's TARGET as its preset, and the page wrote `preset=noon` for a sky
// a quarter of the way there: a link that lied about its own view.
test("a link without a preset, opened mid-glide, leaves the look custom", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  await page.evaluate(() => window.__lookdev.glideToPreset("noon"));
  const mid = await tickAt(page, 0.25 * GLIDE_MS);
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#${pinnedHash("tone=aces")}`,
  );
  await expect
    .poll(() => page.evaluate(() => window.__lookdev.stats().state.tone))
    .toBe("aces");
  const r = await page.evaluate(() => ({
    state: window.__lookdev.stats().state,
    glide: window.__lookdev.glideInfo(),
    hash: location.hash,
  }));
  expect(r.glide.active).toBe(false);
  expect(r.state.preset).toBe("custom");
  expect(r.hash).toContain("preset=custom");
  expect(lookOf(r.state)).toEqual(lookOf(mid.state));
  expect(errors).toEqual([]);
});

// Review findings 1 and 4b: every way of stopping a glide stops it, leaves
// no false preset, and releases the held shadow (a hold left on would keep
// the maps rendering below the 2° floor for good). Each case checks that
// the hold WAS on first, so the "false" after it is not vacuous.
test("every way of stopping a glide releases the shadow hold", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const expected = {
    setPreset: "hazy",
    setCloudCover: "custom",
    slider: "custom",
    settle: "noon",
  };
  for (const [name, preset] of Object.entries(expected)) {
    const r = await page.evaluate(
      ([path, ms]) => {
        const d = window.__lookdev;
        d.setPreset("golden");
        d.pinGlideClock(0);
        d.glideToPreset("noon");
        d.pinGlideClock(0.25 * ms);
        d.glideTick();
        const before = d.glideInfo();
        if (path === "setPreset") d.setPreset("hazy");
        if (path === "setCloudCover") d.setCloudCover(0.6);
        if (path === "slider") {
          const slider = document.querySelector("#exposure");
          slider.value = "0.5";
          slider.dispatchEvent(new Event("input"));
        }
        if (path === "settle") {
          d.pinGlideClock(ms);
          d.glideTick();
        }
        return { before, after: d.glideInfo(), state: d.stats().state };
      },
      [name, GLIDE_MS],
    );
    expect(r.before, name).toMatchObject({ active: true, holdsShadows: true });
    expect(r.after, name).toMatchObject({ active: false, holdsShadows: false });
    expect(r.state.preset, name).toBe(preset);
  }
  // The link path (a hash naming a preset) is its own event.
  await page.evaluate((ms) => {
    const d = window.__lookdev;
    d.setPreset("golden");
    d.pinGlideClock(0);
    d.glideToPreset("noon");
    d.pinGlideClock(0.25 * ms);
    d.glideTick();
  }, GLIDE_MS);
  expect(
    await page.evaluate(() => window.__lookdev.glideInfo().holdsShadows),
  ).toBe(true);
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#${pinnedHash("preset=dawn&tone=agx")}`,
  );
  await expect
    .poll(() => page.evaluate(() => window.__lookdev.glideInfo()))
    .toMatchObject({ active: false, holdsShadows: false });
  expect(errors).toEqual([]);
});

// Review finding 4b with shadows on: a glide into blue hour holds the
// shadow below the floor; stopping it there (an instant blue hour) must
// switch the shadow off, as an instant blue hour always did.
test("a glide stopped below the 2° floor switches the shadow off", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx&shadows=1");
  const r = await page.evaluate((ms) => {
    const d = window.__lookdev;
    d.glideToPreset("blueHour");
    d.pinGlideClock(0.8 * ms);
    d.glideTick();
    const held = {
      elevation: d.stats().state.elevation,
      renders: d.shadowRenders(),
    };
    d.setPreset("blueHour");
    return { held, renders: d.shadowRenders(), glide: d.glideInfo() };
  }, GLIDE_MS);
  expect(r.held.elevation).toBeLessThan(2);
  expect(r.held.renders).not.toBeNull();
  expect(r.renders).toBeNull();
  expect(r.glide.holdsShadows).toBe(false);
  expect(errors).toEqual([]);
});

// Review finding 3: the held shadow renders from the TRUE sun wherever the
// rig accepts it; only a sun too close to or below the horizon is
// replaced, by one just above it at the same azimuth. The first cut
// replaced everything below 2°, so between 0° and 2°, where the sun still
// lights the scene, the shadows fell from a higher sun than the light.
test("a held shadow follows the true sun between 0° and 2°", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx&shadows=1");
  const rows = await page.evaluate((ms) => {
    const d = window.__lookdev;
    d.setGlideRebuildEvery(1);
    d.glideToPreset("blueHour");
    const out = [];
    for (let k = 0; k <= 30; k++) {
      d.pinGlideClock((0.3 + 0.02 * k) * ms);
      d.glideTick();
      out.push({
        elevation: d.stats().state.elevation,
        sun: d.sunDirection(),
        shadow: d.shadowLightDirection(),
      });
    }
    return out;
  }, GLIDE_MS);
  const deg = (u, v) =>
    (Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) * 180) /
    Math.PI;
  const flat = (v) => {
    const h = Math.hypot(v[0], v[2]);
    return [v[0] / h, 0, v[2] / h];
  };
  const band = rows.filter((x) => x.elevation > 0.2 && x.elevation < 1.9);
  const below = rows.filter((x) => x.elevation <= 0);
  expect(band.length).toBeGreaterThan(1);
  expect(below.length).toBeGreaterThan(1);
  for (const x of band) {
    expect(deg(x.sun, x.shadow), `at ${x.elevation}°`).toBeLessThan(1e-3);
  }
  for (const x of below) {
    // Just above the horizon, toward the sun's azimuth.
    const elevation = (Math.asin(x.shadow[1]) * 180) / Math.PI;
    expect(elevation, `at ${x.elevation}°`).toBeGreaterThan(0);
    expect(elevation, `at ${x.elevation}°`).toBeLessThan(0.2);
    expect(deg(flat(x.sun), flat(x.shadow))).toBeLessThan(1e-3);
  }
  expect(errors).toEqual([]);
});

// Review finding 4a: the hash names where a glide started until it
// settles, even when another control is used mid-glide (the page's other
// setters all write the hash; mid-glide that would write the TARGET's name
// for a half-way sky).
test("a control used mid-glide does not write the hash until the glide settles", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const r = await page.evaluate((ms) => {
    const d = window.__lookdev;
    const start = location.hash;
    d.glideToPreset("noon");
    d.pinGlideClock(0.3 * ms);
    d.glideTick();
    d.setHaze(false);
    d.setHaze(true);
    const mid = location.hash;
    const active = d.glideInfo().active;
    d.pinGlideClock(ms);
    d.glideTick();
    return { start, mid, active, end: location.hash };
  }, GLIDE_MS);
  expect(r.active).toBe(true);
  expect(r.mid).toBe(r.start);
  expect(r.end).toContain("preset=noon");
  expect(errors).toEqual([]);
});

// Review finding 5: clicking the preset a glide is already heading to does
// not restart its 5 s, and clicking the preset already shown starts none.
test("a repeated click neither restarts a glide nor starts an empty one", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  await page.locator('[data-preset="golden"]').click();
  expect(await page.evaluate(() => window.__lookdev.glideInfo().active)).toBe(
    false,
  );
  await page.locator('[data-preset="noon"]').click();
  await tickAt(page, 0.5 * GLIDE_MS);
  await page.locator('[data-preset="noon"]').click();
  const end = await tickAt(page, GLIDE_MS);
  expect(end.step).toMatchObject({ done: true, id: "noon" });
  expect(lookOf(end.state)).toEqual(LOOKS.noon);
  expect(errors).toEqual([]);
});

// Review finding 6: the page keeps ONE fog and updates its colour. A new
// `THREE.Fog` per sky rebuild makes three re-derive every fogged
// material's program on the next frame (a cache hit, but work at the
// glide's 30 Hz).
test("a sky rebuild recolours the one fog instead of replacing it", async ({
  page,
}) => {
  const errors = await bootPinned(page, "preset=golden&tone=agx");
  const r = await page.evaluate((ms) => {
    const d = window.__lookdev;
    const fog = d.fog();
    const golden = fog.color.getHex();
    d.glideToPreset("noon");
    d.pinGlideClock(0.5 * ms);
    d.glideTick();
    d.pinGlideClock(ms);
    d.glideTick();
    d.setCloudCover(0.5);
    return { same: d.fog() === fog, golden, noon: d.fog().color.getHex() };
  }, GLIDE_MS);
  expect(r.same).toBe(true);
  expect(r.noon).not.toBe(r.golden);
  expect(errors).toEqual([]);
});

// --- ON DEMAND (`GLIDE_COST=1`): the rebuild rate's numbers --------------
//
// Measured on the page's own defaults (shadows, the dense city, the slab,
// the catalog, round-3 plan §8 finding 6), minutes on SwiftShader, for the
// round-3 record (preset-glide results). SwiftShader times are RELATIVE
// only: every number is read as a ratio within the same page load.

const PAIRS = [
  // The visibility changes: every rebuild re-renders all three LUTs.
  ["golden", "noon"],
  // The long azimuth turn (170°), visibility changing too.
  ["golden", "dawn"],
  // The visibility unchanged (60 km both): the sky view LUT alone.
  ["noon", "blueHour"],
];

// Each sample is one glide frame followed by the frame it causes and a
// steady frame, INTERLEAVED across the conditions so the machine's load
// drifts equally over all of them (a first cut ran the conditions in turn,
// and a second session's suite made its differences noise). Every time is
// read against the steady frame of its own sample. The draw and triangle
// counts, which include the shadow passes, are exact.
test("the glide's cost per sky rebuild, split (logged)", async ({ page }) => {
  test.skip(!process.env.GLIDE_COST, "on demand: GLIDE_COST=1");
  test.setTimeout(3_600_000);
  const errors = await boot(page, "preset=golden", { pageDefaults: true });
  const conditions = [
    { id: "follow all-LUTs", shadows: "follow", pair: ["golden", "noon"] },
    { id: "follow sky-view", shadows: "follow", pair: ["noon", "blueHour"] },
    { id: "freeze all-LUTs", shadows: "freeze", pair: ["golden", "noon"] },
    { id: "freeze sky-view", shadows: "freeze", pair: ["noon", "blueHour"] },
  ];
  const r = await page.evaluate(
    ([list, ms, samples]) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setCloudOffset(0.1, 0.2);
      d.setView("city");
      d.setGlideRebuildEvery(1);
      const one = (options = {}) =>
        d.timeFrames(1, { warmup: false, ...options });
      const out = { state: d.stats().state, rows: [], maps: [], bake: [] };
      for (let i = 0; i < samples; i++) {
        const t = 0.1 + (0.8 * i) / (samples - 1);
        for (const c of list) {
          d.setGlideShadows(c.shadows);
          d.setPreset(c.pair[0]);
          one();
          d.pinGlideClock(0);
          d.glideToPreset(c.pair[1]);
          d.pinGlideClock(t * ms);
          const start = performance.now();
          d.glideTick();
          const tick = performance.now() - start;
          const first = one();
          const steady = one();
          out.rows.push({
            id: c.id,
            t,
            tick,
            atmosphereMs: d.stats().atmosphereMs,
            first: first.medianMs,
            steady: steady.medianMs,
            firstDraws: first.draws,
            steadyDraws: steady.draws,
            firstTris: first.triangles,
            steadyTris: steady.triangles,
          });
          d.setPreset(c.pair[0]);
        }
        // The shadow maps alone (no sky change), and the environment bake
        // alone (a cloud cover change re-bakes, no LUT, no map).
        d.setGlideShadows("follow");
        one();
        const maps = one({ shadowMaps: true });
        out.maps.push({
          maps: maps.medianMs,
          steady: one().medianMs,
          draws: maps.draws,
          tris: maps.triangles,
        });
        const cover = d.stats().state.clouds;
        const start = performance.now();
        d.setCloudCover(cover === 0.3 ? 0.31 : 0.3);
        const bakeCpu = performance.now() - start;
        const baked = one();
        out.bake.push({
          cpu: bakeCpu,
          first: baked.medianMs,
          steady: one().medianMs,
        });
      }
      d.setGlideShadows("follow");
      return out;
    },
    [conditions, GLIDE_MS, 9],
  );
  console.log(`glide cost: ${JSON.stringify(r)}`);
  expect(errors).toEqual([]);
});

test("the glide's visible stepping per rebuild interval (logged)", async ({
  page,
}) => {
  test.skip(!process.env.GLIDE_COST, "on demand: GLIDE_COST=1");
  test.setTimeout(3_600_000);
  const errors = await boot(page, "preset=golden", { pageDefaults: true });
  // One rebuild interval of k frames at 60 and at 30 frames per second:
  // k = 1, 2, 4, 8 at 60 fps and 1, 2, 4, 8 at 30 fps cover these gaps.
  const gapsMs = [1, 2, 4, 8, 16].map((f) => (f * 1000) / 60);
  const r = await page.evaluate(
    ([pairs, ms, gaps]) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setCloudOffset(0.1, 0.2);
      d.setView("city");
      d.setGlideRebuildEvery(1);
      const out = [];
      const stats = (a, b) => {
        const n = a.length / 4;
        const deltas = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let c = 0; c < 3; c++) {
            m = Math.max(m, Math.abs(a[4 * i + c] - b[4 * i + c]));
          }
          deltas[i] = m;
        }
        const sorted = Array.from(deltas).sort((x, y) => x - y);
        const at = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
        const share = (v) => sorted.filter((x) => x > v).length / n;
        return {
          p50: at(0.5),
          p95: at(0.95),
          p99: at(0.99),
          max: sorted[n - 1],
          over2: share(2),
          over4: share(4),
          over8: share(8),
        };
      };
      const angle = (u, v) =>
        (Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) *
          180) /
        Math.PI;
      for (const [from, to] of pairs) {
        for (const t0 of [0.25, 0.5]) {
          d.setPreset(from);
          d.pinGlideClock(0);
          d.glideToPreset(to);
          d.pinGlideClock(t0 * ms);
          d.glideTick();
          const a = d.readFrame().data.slice();
          const sunA = d.sunDirection();
          for (const gap of gaps) {
            d.pinGlideClock(t0 * ms + gap);
            d.glideTick();
            const b = d.readFrame().data;
            out.push({
              pair: `${from}>${to}`,
              t0,
              gapMs: gap,
              sunDeg: angle(sunA, d.sunDirection()),
              ...stats(a, b),
            });
          }
          d.setPreset(to);
        }
      }
      return out;
    },
    [PAIRS, GLIDE_MS, gapsMs],
  );
  for (const row of r) console.log(`glide step: ${JSON.stringify(row)}`);
  expect(errors).toEqual([]);
});
