// @ts-check
import { expect, test } from "@playwright/test";

import {
  downloadedZip,
  enterArAndMeasure,
  finishAndDownload,
  installTourViewerArFakes,
  openFixtureTour,
  standAt,
} from "./ar-fakes.js";

/**
 * Stations in the creator's AR view, end to end (tour editor plan
 * 2026-10-17-1816, W3 "AR authoring", D20, D21). Why these tests matter:
 * the unit tests prove the rule and the words, but only the composed page
 * shows that the line over the camera, the ring on the ground, the
 * placement's note and the written tour all tell the same story - a pin
 * inside the open station joins it, leaving its radius closes it, and a
 * pin placed with no station open starts one, which the Finish writes.
 *
 * The fixture tour holds one station, its pin about 10 m north of the
 * fakes' zero (archive-server.mjs); R is 25 m.
 */

const TEST_KEY = "__tourViewerTest";

/** Seconds of the fakes' fix clock, one per stand. */
let clock = 0;

/**
 * Stand the creator `north`/`east` m from the zero (the shared
 * `standAt`: a fix there, the camera taken back through the CURRENT
 * alignment), aim the reticle at the ground there (the HUD judges the
 * open station where a pin would land, M5c review #3) and let a camera
 * frame tick the HUD.
 * @param {import("@playwright/test").Page} page
 */
async function stand(page, north, east) {
  clock += 1;
  await standAt(page, north, east, clock);
  await page.evaluate(
    ({ key, north, east }) => {
      const test = /** @type {any} */ (window)[key];
      test.reticlePosition = [north, 400.5, east];
      test.emitFrames(1);
    },
    { key: TEST_KEY, north, east },
  );
}

/** The ring in the fakes' scene, as `{ x, z }` and its radius, or null. */
async function ring(page) {
  return page.evaluate((key) => {
    const scene = /** @type {any} */ (window)[key].fakeScene;
    const mesh = scene.children.find(
      (/** @type {any} */ c) => c.name === "station-ring",
    );
    if (mesh === undefined) return null;
    const { innerRadius, outerRadius } = mesh.geometry.parameters;
    return {
      x: mesh.position.x,
      z: mesh.position.z,
      radiusM: (innerRadius + outerRadius) / 2,
    };
  }, TEST_KEY);
}

/**
 * Place a pin at `north`/`east` (the reticle, GPS-world NUE) with `label`.
 * @param {import("@playwright/test").Page} page
 */
async function placePin(page, label, north, east) {
  await page.evaluate(
    ({ key, north, east }) => {
      /** @type {any} */ (window)[key].reticlePosition = [north, 400.5, east];
    },
    { key: TEST_KEY, north, east },
  );
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill(label);
  await page.getByTestId("pin-save").click();
}

/**
 * The written tour holds "Inside" in the fixture's station and "Outside" in
 * a second station, anchored where "Outside" stands (D20).
 * @param {import("@playwright/test").Page} page
 */
async function expectWrittenAsTold(page) {
  const { manifest } = await downloadedZip(page, 0);
  const holding = (/** @type {string} */ label) =>
    manifest.stations.find((s) =>
      s.items.some((i) => i.kind === "pin" && i.label === label),
    );
  const fixture = holding("Fixture pin");
  const started = holding("Outside");
  const outside = manifest.objects.find(
    (o) => o.kind === "pin" && o.label === "Outside",
  );
  if (fixture === undefined || started === undefined || outside === undefined) {
    throw new Error("the written tour lost a pin or its station");
  }
  expect(holding("Inside")?.id).toBe(fixture.id);
  expect(started.id).not.toBe(fixture.id);
  expect(manifest.stations.indexOf(started)).toBe(1);
  expect(started.geo.lat).toBeCloseTo(outside.geo.lat, 9);
  expect(started.geo.lon).toBeCloseTo(outside.geo.lon, 9);
}

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

test("the creator's open station is named and ringed; a pin inside joins it, leaving closes it, and a pin with none open starts one the Finish writes", async ({
  page,
}) => {
  await openFixtureTour(page);
  await enterArAndMeasure(page);
  const chip = page.getByTestId("creator-station");

  // At the zero: inside the fixture's station (its anchor ~10 m north).
  await stand(page, 0, 0);
  await expect(chip).toHaveText("In Station 1 - what you place here joins it.");
  await expect.poll(() => ring(page)).not.toBeNull();
  const drawn = await ring(page);
  expect(drawn?.radiusM).toBeCloseTo(25, 6);
  expect(drawn?.x).toBeCloseTo(10, 0);
  expect(drawn?.z).toBeCloseTo(0, 0);

  // A pin inside joins it.
  await placePin(page, "Inside", 3, -2);
  await expect(page.getByTestId("setup-status")).toContainText(
    'Pin "Inside" placed - in Station 1',
  );

  // Walking out of its radius closes it: the line says so, the ring goes.
  await stand(page, 60, 0);
  await expect(chip).toHaveText(
    "You left Station 1 - what you place next starts a new station.",
  );
  await expect.poll(() => ring(page)).toBeNull();

  // "Place a pin" with no station open starts one holding it (D21).
  await placePin(page, "Outside", 60, 0);
  await expect(page.getByTestId("setup-status")).toContainText(
    'Pin "Outside" placed - it starts Station 2',
  );
  await stand(page, 61, 0);
  await expect(chip).toHaveText("In Station 2 - what you place here joins it.");
  await expect.poll(async () => (await ring(page))?.x).toBeCloseTo(60, 0);

  // The Finish writes what the HUD said.
  await finishAndDownload(page, 0);
  await expectWrittenAsTold(page);
});

/** The box of a test id, in viewport pixels. */
async function box(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 915, height: 412 },
]) {
  test(`the station line sits just above the chips, centred and on screen, on ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    // Why: the line follows H1 (the owner's chosen HUD): the camera view
    // stays clear, the readout card at the top, the place chips at the
    // bottom. The line belongs with the chips it is about, never over the
    // readout and never off screen (root CLAUDE.md: positions, not
    // presence).
    await page.setViewportSize(viewport);
    await openFixtureTour(page);
    await enterArAndMeasure(page);
    await stand(page, 0, 0);
    await expect(page.getByTestId("creator-station")).toBeVisible();
    const line = await box(page, "creator-station");
    const pin = await box(page, "setup-pin");
    const status = await box(page, "setup-status");
    expect(line.bottom).toBeLessThanOrEqual(pin.top);
    expect(pin.top - line.bottom).toBeLessThan(24);
    expect(line.top).toBeGreaterThanOrEqual(status.bottom);
    expect(line.left).toBeGreaterThanOrEqual(0);
    expect(line.right).toBeLessThanOrEqual(viewport.width);
    const centre = (line.left + line.right) / 2;
    expect(Math.abs(centre - viewport.width / 2)).toBeLessThan(2);
  });
}
