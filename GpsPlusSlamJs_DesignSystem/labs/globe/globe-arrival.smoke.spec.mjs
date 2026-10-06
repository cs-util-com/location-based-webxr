// @ts-check
/**
 * The pin's arrival prefetch in the globe lab (round-5 plan 2026-10-01-0945
 * §3.6 step 1): at "pin", the lab loads OsmDemo's prefetch lazily, warms the
 * city's data during the dive, shows how far it got, and paces the dive by
 * it (`/globe/flight-pace.js`), within the 30 s cap (DEC-GL5-6).
 *
 * Why this file matters: every part of this fails quietly in a browser
 * only. A prefetch module that does not load leaves a dive that simply runs
 * at the cold pace; a status line that never moves reads as a hang; a
 * cancel that does not abort keeps pulling 21 MB tiles from donated
 * servers; and a static import of the prefetch would put about 1.7 MB of
 * modules in front of every globe's first frame. The network is answered
 * here (`routeCityData`): no request leaves the machine.
 */
import { expect, test } from "@playwright/test";

import {
  plainGlobe,
  routeCityData,
  withPreRound4Look,
} from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const COLOGNE = { latitude: 50.94128, longitude: 6.95817 };
/** A settled daylight view, the hand-over off so the page stays. */
const VIEW = withPreRound4Look(
  "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&handOver=0",
);

/** Boots with a granted GPS at Cologne; returns console errors and requests. */
async function boot(page, context, hash = VIEW) {
  const errors = [];
  const requests = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COLOGNE);
  await page.goto(`/labs/globe/#${plainGlobe(hash)}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
    null,
    { timeout: 90_000 },
  );
  return { errors, requests };
}

const arrival = (page) =>
  page.evaluate(() => ({
    ...window.__globeLab.state().pin.arrival,
    line: document.getElementById("globe-arrival-status").textContent,
    pin: window.__globeLab.state().pin.phase,
    phase: window.__globeLab.state().phase,
  }));

/** Requests that only the prefetch's lazily loaded graph makes. */
const prefetchGraph = (requests) =>
  requests.filter((u) =>
    /\/osm-lib\/|\/vendor\/h3-js\/|\/osm\/arrival-prefetch\.js/.test(u),
  );

// WHY: the pin starts the prefetch (loaded only now, not at boot), the
// status line shows a cold load in progress and then its end, and the dive
// clock runs at the cold pace while the data is missing and speeds up once
// it has landed.
test("the pin loads the prefetch lazily, shows its progress and paces the dive", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const city = await routeCityData(page, { holdOverpass: true });
  const { errors, requests } = await boot(page, context);
  expect(prefetchGraph(requests)).toEqual([]);

  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.counts?.overpass?.total > 0,
    null,
    { timeout: 60_000 },
  );
  expect(prefetchGraph(requests).length).toBeGreaterThan(0);
  const loading = await arrival(page);
  expect(loading.paced).toBe(true);
  expect(loading.outcome).toBeNull();
  expect(loading.line).toMatch(/loading/i);
  expect(loading.line).toMatch(/cold/i);
  // Before the data: the cold pace, the whole path over the 30 s cap.
  expect(loading.rate).toBeLessThan(1.5 / 30_000);
  expect(city.seen.overpass).toBeGreaterThan(0);

  city.release();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.outcome === "settled",
    null,
    { timeout: 60_000 },
  );
  // The dive speeds up towards the warm pace (whole path over 8 s).
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival.rate > 2 / 30_000,
    null,
    { timeout: 30_000 },
  );
  const done = await arrival(page);
  expect(done.line).toMatch(/ready/i);
  // It lands (held: the hand-over is off) well inside the cap.
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "idle",
    null,
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
});

// WHY: the second visit is the point of warming: the same place, with its
// data already stored, must fly at the warm pace from the start of the
// data's arrival and say so (warm), without any request for city data.
test("a second flight to the same place is warm, says so, and is quick", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const city = await routeCityData(page);
  const { errors } = await boot(page, context);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.outcome === "settled",
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "idle",
    null,
    { timeout: 60_000 },
  );
  const asked = { ...city.seen };

  const started = Date.now();
  await page.locator("#globe-pin").click();
  // The FIRST flight's settled arrival stays in the state until the new fix
  // starts the second one: wait for the new flight, or a slow locate reads
  // the old line.
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "flying",
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.outcome === "settled",
    null,
    { timeout: 60_000 },
  );
  const warm = await arrival(page);
  expect(warm.line).toMatch(/already stored|warm/i);
  expect(warm.counts.overpass.warm).toBe(warm.counts.overpass.total);
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "idle",
    null,
    { timeout: 60_000 },
  );
  // The warm pace lands in about 8.6 s; the cold cap is 30 s. The margin
  // covers locating and a slow software renderer's frames.
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(city.seen).toEqual(asked);
  expect(errors).toEqual([]);
});

// WHY: a cancelled flight must stop pulling city data at once: each
// Overpass tile is about 21 MB from a donated server.
test("stopping the flight aborts the prefetch and says so", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const city = await routeCityData(page, { holdOverpass: true });
  const { errors } = await boot(page, context);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.counts?.overpass?.total > 0,
    null,
    { timeout: 60_000 },
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.outcome === "aborted",
    null,
    { timeout: 30_000 },
  );
  expect((await arrival(page)).line).toMatch(/stopped/i);
  city.release();
  expect(errors).toEqual([]);
});

// WHY (the city plan 2026-10-05-0040, K0): a link that names a place warms
// its city data from load, while the globe still turns, not only from the
// pin's press, so a direct link to Zurich lands warm. With prefetch=0 it
// waits, as every other smoke does by pinning cityWarm=0.
test("a link that names a place warms its city data before any press", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const ZURICH =
    "at=47.3769,8.5417&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&handOver=0";
  const city = await routeCityData(page);
  const { errors, requests } = await boot(
    page,
    context,
    `${ZURICH}&cityWarm=1`,
  );
  await page.waitForFunction(
    () => window.__globeLab.state().pin.arrival?.counts?.overpass?.total > 0,
    null,
    { timeout: 120_000 },
  );
  const warming = await arrival(page);
  console.log(
    `warm from load at Zurich: pin ${warming.pin}, overpass ${JSON.stringify(warming.counts.overpass)}, line "${warming.line}", city requests ${city.seen.overpass}`,
  );
  expect(warming.pin).toBe("idle");
  expect(prefetchGraph(requests).length).toBeGreaterThan(0);
  expect(city.seen.overpass).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("with prefetch=0 a link that names a place loads no city data", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await routeCityData(page);
  const { errors, requests } = await boot(
    page,
    context,
    "at=47.3769,8.5417&spinMs=0&turnMs=0&cloudDrift=0&handOver=0&cityWarm=1&prefetch=0",
  );
  expect(
    await page.evaluate(() => window.__globeLab.state().pin.arrival),
  ).toBeNull();
  expect(prefetchGraph(requests)).toEqual([]);
  expect(errors).toEqual([]);
});
