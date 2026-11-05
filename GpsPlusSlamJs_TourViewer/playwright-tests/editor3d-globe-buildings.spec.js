// @ts-check
import { expect, test } from "@playwright/test";

import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  cityRequests,
  keepRejections,
  noClouds,
  rejections,
  reliefCarries,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the globe editor draws the OSM buildings at the
 * tour (the Globe package's city, built in the editor's own worker), and
 * they must not get in the creator's way. Read on the real page, with
 * Overpass answered by a grid of fixture buildings around the sample's
 * first station and the heights by the flat square (nothing leaves the
 * machine):
 *
 * - the city loads in its worker and stands on the relief's ground (the
 *   height parity at the tour's centre within half a metre);
 * - picking still meets the ground: a station inside a building is picked
 *   by a click on it, and a new station placed inside a building's
 *   footprint stands on the ground, not on its roof (20 m up), the place
 *   checked to lie inside that footprint (else the check proves nothing);
 * - the selection's surroundings turn see-through;
 * - the view's toggle hides and restores the buildings, and `buildings=0`
 *   makes none (no Overpass request at all);
 * - no console error and no rejected promise along the way.
 *
 * The frame cost is not read here: a software renderer's frame times say
 * little about a phone's, and a reading nothing asserts on cost a second
 * cold landing per run.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** The sample's first station: the column of Marienplatz, Munich. */
const FIRST = { lat: 48.137393, lng: 11.575493 };

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/** A building's height in the fixture (m). */
const BUILDING_M = 20;

/** Half a fixture building's side (m). */
const HALF_SIDE_M = 15;

/** Metres per degree of latitude, and of longitude at the square. */
const M_PER_DEG_LAT = 110_946;
const M_PER_DEG_LNG = 111_319.49 * Math.cos((FIRST.lat * Math.PI) / 180);

/** A 5 x 5 grid of 30 m square buildings 60 m apart, one around the first
 *  station. */
function overpassFixture() {
  const elements = [];
  const mLat = 1 / M_PER_DEG_LAT;
  const mLng = 1 / M_PER_DEG_LNG;
  const dLat = HALF_SIDE_M * mLat;
  const dLng = HALF_SIDE_M * mLng;
  let id = 1;
  for (const i of [-2, -1, 0, 1, 2]) {
    for (const j of [-2, -1, 0, 1, 2]) {
      const lat = FIRST.lat + i * 60 * mLat;
      const lng = FIRST.lng + j * 60 * mLng;
      elements.push({
        type: "way",
        id: id++,
        tags: { building: "yes", height: String(BUILDING_M) },
        geometry: [
          { lat: lat - dLat, lon: lng - dLng },
          { lat: lat - dLat, lon: lng + dLng },
          { lat: lat + dLat, lon: lng + dLng },
          { lat: lat + dLat, lon: lng - dLng },
          { lat: lat - dLat, lon: lng - dLng },
        ],
      });
    }
  }
  return { version: 0.6, elements };
}

/**
 * The page's console errors from now on.
 * @param {import("@playwright/test").Page} page
 */
function consoleErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * The editor on the globe at the sample's landing (reduced motion: the
 * view cuts to the approach's end), the relief carrying the ground.
 * @param {import("@playwright/test").Page} page
 * @param {string} query
 */
async function landed(page, query) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await answerHosts(page, {
    globeAssets: "serve",
    overpass: overpassFixture(),
  });
  await keepRejections(page);
  await noClouds(page);
  await page.goto(`/edit.html${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect
    .poll(async () => (await view3d(page))?.globe?.approach?.ended ?? null, {
      timeout: 120_000,
    })
    .toBe("landed");
  await reliefCarries(page);
}

/** @param {import("@playwright/test").Page} page */
async function cityReady(page) {
  await expect
    .poll(
      async () => {
        const city = (await view3d(page))?.city;
        return city?.worker === "ready" && city.objects > 0 ? "ready" : city;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe("ready");
}

/** @param {import("@playwright/test").Page} page */
function firstStation(page) {
  return page.evaluate(
    () => /** @type {any} */ (window).__tourEditor.manifest().stations[0].id,
  );
}

test("the buildings load in their worker on the relief's ground, out of the picking's way @pr", async ({
  page,
}) => {
  // A cold landing, a city load and several frame waits: on a loaded
  // machine the software renderer draws about one frame a second.
  test.setTimeout(300_000);
  const errors = consoleErrors(page);
  const from = { ...cityRequests };
  await landed(page, "");
  await cityReady(page);
  const city = /** @type {any} */ ((await view3d(page))?.city);
  expect(city.tiles).toBeGreaterThan(0);
  expect(city.buildings).toBeGreaterThan(0);
  expect(city.geometryBytes).toBeGreaterThan(0);
  expect(city.shown).toBe(true);
  // Height parity: the city's ground at the tour is the relief's.
  expect(Math.abs(city.parityM)).toBeLessThan(0.5);
  expect(city.reliefGroundM).toBeCloseTo(SQUARE_GROUND_M, 0);
  expect(cityRequests.overpass).toBeGreaterThan(from.overpass);
  console.log(
    `city: ${String(city.tiles)} tiles, ${String(city.buildings)} buildings, ${String(city.objects)} objects, ${String(Math.round(city.geometryBytes / 1024))} KiB geometry, parity ${String(city.parityM)} m`,
  );

  // Picking: a click on the first station (inside a building) picks it.
  const id = await firstStation(page);
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  await afterFrames(page, 3);
  const at = await page.evaluate(
    (selection) =>
      /** @type {any} */ (window).__tourEditor.view3dScreenOf(selection),
    `station:${id}`,
  );
  expect(at).not.toBeNull();
  await page.mouse.click(canvas.x + at[0], canvas.y + at[1]);
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe(`station:${id}`);
  // The buildings around the selection are drawn see-through.
  await expect
    .poll(async () => (await view3d(page))?.city?.seeThrough?.on)
    .toBe(true);

  // A new station inside the first building's footprint, beside the
  // station's marker: on the ground, not on the roof.
  const here = { x: canvas.x + at[0] + 40, y: canvas.y + at[1] + 25 };
  await page.mouse.click(here.x, here.y, { button: "right" });
  const item = page.locator("#scene-new-station");
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await item.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          /** @type {any} */ (window).__tourEditor.manifest().stations.length,
      ),
    )
    .toBe(4);
  const added = await page.evaluate(
    () => /** @type {any} */ (window).__tourEditor.manifest().stations[3].geo,
  );
  // The offset beside the marker landed inside the building around the
  // first station (the grid's centre one), so its roof was under the
  // cursor and the ground check below means something.
  const eastM = (added.lon - FIRST.lng) * M_PER_DEG_LNG;
  const northM = (added.lat - FIRST.lat) * M_PER_DEG_LAT;
  expect(Math.abs(eastM)).toBeLessThan(HALF_SIDE_M);
  expect(Math.abs(northM)).toBeLessThan(HALF_SIDE_M);
  expect(added.alt).toBeCloseTo(SQUARE_GROUND_M + N_M, 0);
  expect(added.alt).toBeLessThan(SQUARE_GROUND_M + N_M + BUILDING_M / 2);

  // The view's toggle hides them and shows them again.
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dBuildings(false),
  );
  await afterFrames(page, 2);
  expect((await view3d(page))?.city).toMatchObject({
    shown: false,
    fade: 0,
  });
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dBuildings(true),
  );
  await expect
    .poll(async () => (await view3d(page))?.city?.fade, { timeout: 60_000 })
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
  expect(await rejections(page)).toEqual([]);
});

test("buildings=0 makes no buildings and asks Overpass nothing", async ({
  page,
}) => {
  // A cold landing on a loaded machine: longer than a tripled default.
  test.setTimeout(300_000);
  const errors = consoleErrors(page);
  const before = cityRequests.overpass;
  await landed(page, "?buildings=0");
  await afterFrames(page, 20);
  expect((await view3d(page))?.city).toBeNull();
  expect(cityRequests.overpass).toBe(before);
  expect(errors).toEqual([]);
  expect(await rejections(page)).toEqual([]);
});
