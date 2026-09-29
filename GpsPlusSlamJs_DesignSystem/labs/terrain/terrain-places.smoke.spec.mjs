// @ts-check
/**
 * The terrain lab's places and cameras in the browser (terrain plan
 * 2026-09-27-0605 §5 T3, DEC-TR-3).
 *
 * Why this file matters: a place is a centre, a tile set and a frame, and
 * each can be wrong without an error: a centre that asks for a tile nobody
 * committed (the smoke would fetch it), a GPS region built around the old
 * place, a position asked for on load (a permission prompt nobody pressed
 * for), or a preset that looks past the region at the background. So each
 * place is booted on its committed tiles with nothing leaving the machine,
 * the GPS place is driven through a granted and a denied answer with the
 * browser's geolocation mocked, and every preset is held to framing the
 * region on every place.
 */
import { expect, test } from "@playwright/test";

import { terrariumPng } from "../../../scripts/e2e/terrarium-png.mjs";
import {
  applyHash,
  boot,
  fixtureTile,
  readPixels,
  routeAll,
  state,
} from "./terrain-smoke-helpers.mjs";

/** Each committed place's z8 tile range (fixtures/PROVENANCE.md). */
const PLACES = {
  appalachians: { x: [70, 72], y: [97, 99] },
  alps: { x: [133, 135], y: [89, 91] },
  germany: { x: [133, 135], y: [81, 83] },
};
const tilesOf = ({ x, y }) => {
  const out = [];
  for (let ty = y[0]; ty <= y[1]; ty++) {
    for (let tx = x[0]; tx <= x[1]; tx++) out.push(`8/${tx}/${ty}`);
  }
  return out.sort();
};

// WHY (DEC-TR-3, plan §9 findings 4 and 6): every committed place boots on
// exactly its own tiles, all served here, none from the network; and a
// place change on the plate loads the new region without a reload.
test("each place boots on its committed tiles, and the plate switches between them", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, "place=appalachians&preset=top&svf=0");
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  for (const id of Object.keys(PLACES)) {
    if (id !== "appalachians") {
      record.requested.length = 0;
      await page.locator('select[data-hash-key="place"]').selectOption(id);
      await page.waitForFunction(
        (p) =>
          window.__terrainLab.state().place === p &&
          window.__terrainLab.state().hasData !== null,
        id,
        { timeout: 90_000 },
      );
    }
    const s = await state(page);
    console.log(
      `${id}: ${s.tiles.length} tiles, ${Math.round(s.bytes / 1024)} KiB, datum ${Math.round(s.datum)} m, relief ${Math.round(s.reliefM)} m`,
    );
    expect(s.tiles.sort()).toEqual(tilesOf(PLACES[id]));
    if (id !== "appalachians") {
      expect([...record.requested].sort()).toEqual(tilesOf(PLACES[id]));
    }
    expect(s.hasData).toBe(true);
    expect(s.missing).toBe(0);
    expect(s.errorText).toBe("");
  }
  expect(loads).toBe(0);
  expect(record.external).toEqual([]);
  expect(record.missing).toEqual([]);
  expect(errors).toEqual([]);
});

// WHY (DEC-TR-3: "a flat region"): northern Germany is the flat counter-
// case to the Alps, and its region reaches the North Sea, so sea posts
// exist (the sea from h <= 0, DEC-TR-5; T5 checks its colours).
test("northern Germany is flat and reaches the sea", async ({ page }) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  await boot(page, "place=germany&preset=top&svf=0");
  const s = await state(page);
  const heights = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const f = window.__terrainLab.fieldAt(
          -120_000 + 6_000 * i,
          -120_000 + 6_000 * j,
        );
        out.push(f.heightM);
      }
    }
    return out;
  });
  const sea = heights.filter((h) => h <= 0).length;
  const land = heights.filter((h) => h > 0);
  console.log(
    `germany: relief ${Math.round(s.reliefM)} m, ${sea} of ${heights.length} samples at or below 0 m, highest land ${Math.round(Math.max(...land))} m`,
  );
  expect(Math.max(...land)).toBeLessThan(400);
  expect(sea).toBeGreaterThan(50);
  expect(land.length).toBeGreaterThan(500);
});

/**
 * Replaces `navigator.geolocation` before the page loads: it counts every
 * request, and answers only when the test calls `__answerGeolocation`, with
 * a position or a `GeolocationPositionError` code, so the in-progress state
 * is read while it lasts, not raced.
 */
async function mockGeolocation(page) {
  await page.addInitScript(() => {
    window.__geoRequests = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(ok, fail) {
          window.__geoRequests += 1;
          window.__answerGeolocation = (answer) =>
            answer.code
              ? fail({ code: answer.code, message: `mocked ${answer.code}` })
              : ok({
                  coords: {
                    latitude: answer.lat,
                    longitude: answer.lng,
                    accuracy: 12,
                  },
                  timestamp: Date.now(),
                });
        },
      },
    });
  });
}

/** The pin's view: label, state, busy and its status line. */
const pinView = (page) =>
  page.evaluate(() => {
    const b = document.getElementById("terrain-pin");
    return {
      label: b.getAttribute("aria-label"),
      state: b.dataset.state,
      busy: b.getAttribute("aria-busy"),
      status: document.getElementById("terrain-pin-status").textContent,
      phase: window.__terrainLab.state().pin,
    };
  });

/** Cologne cathedral: where the mocked GPS says the user stands. */
const COLOGNE = { lat: 50.94128, lng: 6.95817 };

/** A gentle synthetic slope for any tile: the GPS region has no fixtures. */
const anyTile = (() => {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) {
      const x = Number(key.split("/")[1]);
      cache.set(
        key,
        terrariumPng(256, 256, (col) => 50 + (x % 7) * 20 + col / 8),
      );
    }
    return { status: 200, body: cache.get(key) };
  };
})();

// WHY (the brief: "requested only on a press, never on load"; the async-
// feedback rule): no permission prompt the user did not ask for; while the
// fix is awaited the pin says so and stays pressable; a granted fix builds
// the region AROUND it (its tiles, its centre), and the link says
// `place=gps`, never the coordinates (plan §9 finding 20).
test("the GPS place: nothing asked on load, a granted fix builds the region there", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await mockGeolocation(page);
  const record = await routeAll(page, (key, r) =>
    /^8\/7[0-2]\/9[7-9]$/.test(key) ? fixtureTile(key, r) : anyTile(key),
  );
  const errors = await boot(page, "preset=top&svf=0");
  expect(await page.evaluate(() => window.__geoRequests)).toBe(0);
  expect(await pinView(page)).toMatchObject({ state: "idle", busy: "false" });
  await page.locator("#terrain-pin").click();
  expect(await pinView(page)).toMatchObject({
    phase: "locating",
    state: "locating",
    busy: "true",
    label: "Finding you... - tap to cancel",
  });
  expect(await page.evaluate(() => window.__geoRequests)).toBe(1);
  record.requested.length = 0;
  await page.evaluate((c) => window.__answerGeolocation(c), COLOGNE);
  await page.waitForFunction(
    () =>
      window.__terrainLab.state().place === "gps" &&
      window.__terrainLab.state().hasData === true,
    null,
    { timeout: 90_000 },
  );
  const s = await state(page);
  expect(s.centre.lat).toBeCloseTo(COLOGNE.lat, 6);
  expect(s.centre.lng).toBeCloseTo(COLOGNE.lng, 6);
  // The 4 x 4 tiles around Cologne (z8 x 131-134, y 84-87), no Blue Ridge
  // tile among them.
  expect(s.tiles).toHaveLength(16);
  expect(s.tiles).toContain("8/132/85");
  expect([...record.requested].sort()).toEqual([...s.tiles].sort());
  expect(record.requested.every((k) => !/^8\/7[0-2]\//.test(k))).toBe(true);
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain("place=gps");
  expect(hash).not.toContain("50.9");
  expect(await pinView(page)).toMatchObject({
    phase: "idle",
    state: "located",
  });
  expect(record.external).toEqual([]);
  expect(errors).toEqual([]);
});

// WHY: a link with place=gps opens without asking (no press yet), says
// what to press, and the press then loads the region.
test("a place=gps link asks for nothing until the pin is pressed", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mockGeolocation(page);
  await routeAll(page, anyTile);
  const errors = await boot(page, "place=gps&preset=top&svf=0");
  const s = await state(page);
  expect(s.place).toBe("gps");
  expect(s.awaitingFix).toBe(true);
  expect(await page.evaluate(() => window.__geoRequests)).toBe(0);
  expect((await pinView(page)).status).toMatch(/press/i);
  await page.locator("#terrain-pin").click();
  await page.evaluate((c) => window.__answerGeolocation(c), COLOGNE);
  await page.waitForFunction(
    () => window.__terrainLab.state().hasData === true,
    null,
    { timeout: 90_000 },
  );
  expect((await state(page)).awaitingFix).toBe(false);
  expect(errors).toEqual([]);
});

// WHY (locate-state.ts: three failures, three fixes): a denied position
// names its fix, the pin returns to idle with the warning look, and the
// place drawn before stays drawn.
for (const [code, name, fix] of [
  [1, "denied", /settings/i],
  [3, "timeout", /sky/i],
]) {
  test(`the GPS place when the position is ${name}: the fix is named, the place stays`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mockGeolocation(page);
    await routeAll(page, fixtureTile);
    const errors = await boot(page, "place=alps&preset=top&svf=0");
    await page.locator("#terrain-pin").click();
    await page.evaluate((c) => window.__answerGeolocation({ code: c }), code);
    await page.waitForFunction(
      () => window.__terrainLab.state().pin === "idle",
    );
    const view = await pinView(page);
    expect(view.state).toBe(name);
    expect(view.status).toMatch(fix);
    const s = await state(page);
    expect(s.place).toBe("alps");
    expect(s.hasData).toBe(true);
    expect(errors).toEqual([]);
  });
}

// WHY: a browser can leave the request pending (an open permission
// prompt), so a second press cancels, and the late answer changes nothing.
test("a second press cancels the wait, and the late answer is dropped", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mockGeolocation(page);
  await routeAll(page, fixtureTile);
  await boot(page, "place=alps&preset=top&svf=0");
  await page.locator("#terrain-pin").click();
  await page.locator("#terrain-pin").click();
  expect(await pinView(page)).toMatchObject({
    phase: "idle",
    state: "idle",
    status: "Stopped looking for your location.",
  });
  await page.evaluate((c) => window.__answerGeolocation(c), COLOGNE);
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  expect((await state(page)).place).toBe("alps");
});

/**
 * What "framing" means per preset, on the smoke's 1280 x 800 canvas:
 * - `top` and `oblique` show the WHOLE region (the map and the slab): its
 *   four corners project inside the canvas, with a margin of `FRAME_MARGIN`;
 * - `low` stands inside it: the lower half of the canvas is terrain, at
 *   least `LOW_GROUND_SHARE` of a grid over it.
 * Every preset puts the region's centre in the middle half of the canvas.
 * The shares are measured per place and preset and swept below.
 */
const FRAME_MARGIN = 0.02;
const LOW_GROUND_SHARE = 0.95;

// WHY (plan §4 "Camera presets", §5 T3): the three presets frame the
// region on every place: a preset that looks past the region at the
// background, or cuts the slab off, would still draw without an error.
test("the three camera presets frame every place", async ({ page }) => {
  test.setTimeout(360_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(page, "place=appalachians&svf=0&tau=0&preset=top");
  const bg = await page.evaluate(() => window.__terrainLab.background);
  const grid = (v0, v1) => {
    const out = [];
    for (let i = 0; i < 11; i++) {
      for (let j = 0; j < 7; j++)
        out.push([0.05 + 0.09 * i, v0 + ((v1 - v0) * j) / 6]);
    }
    return out;
  };
  const isTerrain = (p) => [0, 1, 2].some((c) => Math.abs(p[c] - bg[c]) > 2);
  const shareOf = async (points) =>
    (await readPixels(page, points)).filter(isTerrain).length / points.length;
  const H = 128_000;
  for (const id of Object.keys(PLACES)) {
    for (const preset of ["top", "oblique", "low"]) {
      await applyHash(page, `place=${id}&svf=0&tau=0&preset=${preset}`);
      await page.waitForFunction(
        (p) =>
          window.__terrainLab.state().place === p &&
          window.__terrainLab.state().hasData === true,
        id,
        { timeout: 90_000 },
      );
      const [centre, ...corners] = await page.evaluate(
        (h) =>
          window.__terrainLab.projectAll([
            [0, 0, 0],
            [-h, 0, -h],
            [h, 0, -h],
            [-h, 0, h],
            [h, 0, h],
          ]),
        H,
      );
      const whole = await shareOf(grid(0.05, 0.95));
      const lower = await shareOf(grid(0.55, 0.95));
      const inset = Math.min(...corners.flat().map((v) => Math.min(v, 1 - v)));
      console.log(
        `${id} ${preset}: centre at ${centre.map((v) => v.toFixed(2)).join(", ")}, ` +
          `corners inset ${inset.toFixed(3)}, terrain over ${(100 * whole).toFixed(0)} % of the canvas ` +
          `and ${(100 * lower).toFixed(0)} % of its lower half ` +
          `(lower half: ${[0.8, 0.9, 0.95, 1].map((t) => `${t}:${lower >= t ? "pass" : "fail"}`).join(" ")})`,
      );
      for (const v of centre) {
        expect(v).toBeGreaterThan(0.25);
        expect(v).toBeLessThan(0.75);
      }
      if (preset === "low")
        expect(lower).toBeGreaterThanOrEqual(LOW_GROUND_SHARE);
      else expect(inset).toBeGreaterThanOrEqual(FRAME_MARGIN);
    }
  }
  expect(errors).toEqual([]);
});
