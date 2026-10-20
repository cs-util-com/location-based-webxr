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

test("'New station here' makes the next pin start its own station within the radius; the Finish writes it apart (D8)", async ({
  page,
}) => {
  // Why (owner decision D8 of the editor round-2 plan): places closer than
  // about 40 m cannot be separated by any automatic radius. Only the
  // composed page shows the chip's armed state, the line, the placement's
  // note and the written tour telling the same story: a pin 5 m from the
  // fixture station's anchor starts Station 2 when armed, the arm is
  // one-shot, survives a cancelled label input, and the Finish writes the
  // new station anchored at that pin.
  await openFixtureTour(page);
  await enterArAndMeasure(page);
  const chip = page.getByTestId("creator-station");
  const arm = page.getByTestId("setup-new-station");
  await stand(page, 0, 0);
  await expect(chip).toHaveText("In Station 1 - what you place here joins it.");
  await expect(arm).toBeEnabled();
  await expect(arm).toHaveAttribute("aria-pressed", "false");

  // A second tap disarms.
  await arm.click();
  await expect(arm).toHaveAttribute("aria-pressed", "true");
  await arm.click();
  await expect(arm).toHaveAttribute("aria-pressed", "false");

  // Armed: the line says so on the next frame.
  await arm.click();
  await expect(arm).toHaveAttribute("aria-pressed", "true");
  await stand(page, 0, 0);
  await expect(chip).toHaveText(
    "What you place next starts a new station here.",
  );

  // A cancelled label input places nothing: still armed.
  await page.getByTestId("setup-pin").click();
  await expect(arm).toBeHidden();
  await page.getByTestId("pin-cancel").click();
  await expect(arm).toHaveAttribute("aria-pressed", "true");

  // 5 m from the fixture's anchor (~10 m north): inside its radius.
  await placePin(page, "Own", 5, 0);
  await expect(page.getByTestId("setup-status")).toContainText(
    'Pin "Own" placed - New station started: Station 2',
  );
  await expect(arm).toHaveAttribute("aria-pressed", "false");

  // One-shot: the next pin follows the rule and joins the nearer station.
  await placePin(page, "After", 4, 0);
  await expect(page.getByTestId("setup-status")).toContainText(
    'Pin "After" placed - in Station 2',
  );

  await finishAndDownload(page, 0);
  const { manifest } = await downloadedZip(page, 0);
  const holding = (/** @type {string} */ label) =>
    manifest.stations.find((s) =>
      s.items.some((i) => i.kind === "pin" && i.label === label),
    );
  const own = manifest.objects.find(
    (o) => o.kind === "pin" && o.label === "Own",
  );
  const fixture = holding("Fixture pin");
  const started = holding("Own");
  if (own === undefined || fixture === undefined || started === undefined) {
    throw new Error("the written tour lost a pin or its station");
  }
  expect(started.id).not.toBe(fixture.id);
  expect(holding("After")?.id).toBe(started.id);
  expect(fixture.items.map((i) => i.id)).toHaveLength(1);
  expect(started.geo.lat).toBeCloseTo(own.geo.lat, 9);
  expect(started.geo.lon).toBeCloseTo(own.geo.lon, 9);
});

/** A recording with no `tour.json` (archive-server.mjs): two photos about
 *  2 m and 12 m north of the zero, no code. */
const RECORDING = "http://127.0.0.1:5197/ranges-ok/recording-tour.zip";

/**
 * Open the recording on the creator's page and wait for the open to settle
 * (the bake of its photos included), with step 4 open.
 * @param {import("@playwright/test").Page} page
 */
async function openRecording(page) {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RECORDING);
  await page.getByTestId("open-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const step = page.getByTestId("step-measure");
  if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
    await page.getByTestId("station-measure").click();
  }
}

/**
 * The pin labelled `label` as the page's tour document holds it, the frame
 * of the station it names (null when the document has no such station),
 * and the ids of the stations the opened tour carries. The fakes hand
 * the page's store over when AR starts, so read it after an entry.
 * @param {import("@playwright/test").Page} page
 */
async function pinInStore(page, label) {
  return page.evaluate(
    ({ key, label }) => {
      const doc = /** @type {any} */ (window)[key].alignmentStore.getState()
        .tourDocument;
      const pin = doc.placed
        .map((/** @type {any} */ p) => p.object)
        .find((/** @type {any} */ o) => o.kind === "pin" && o.label === label);
      const frame =
        pin === undefined
          ? null
          : (doc.stations.find(
              (/** @type {any} */ f) => f.id === pin.station,
            ) ?? null);
      return {
        pin: pin ?? null,
        frame,
        opened: (doc.opened?.stations ?? []).map(
          (/** @type {any} */ st) => st.id,
        ),
      };
    },
    { key: TEST_KEY, label },
  );
}

test("a recording without tour.json is a tour from the open: a fresh pin's station is in the document before any Finish, after the visit's settle and after a reload", async ({
  page,
}) => {
  // Why this test matters: the station a pin stands in used to be decided
  // by the Finish, so before it the page showed stations a write could
  // still change, and a reload could bring a pin back naming a station the
  // tour lacked. Every object now belongs to a station of the document
  // from the moment it is placed; the recording's photos are in stations
  // from the open; and the station survives the visit's settle and a
  // reload. Read from the store, not from the words on screen.
  await openRecording(page);
  await enterArAndMeasure(page);
  // The recording's two photos, 10 m apart, share one station of the
  // walk, made at the open.
  expect((await pinInStore(page, "none")).opened).toEqual(["walk-1"]);

  // 100 m north: far from the walk's station, so the pin starts its own.
  await stand(page, 100, 0);
  await placePin(page, "Far", 100, 0);
  await expect(page.getByTestId("setup-status")).toContainText(
    'Pin "Far" placed - it starts Station 2',
  );
  const placed = await pinInStore(page, "Far");
  expect(placed.pin?.station).toBeDefined();
  expect(placed.frame).not.toBeNull();
  expect(placed.frame.id).not.toBe("walk-1");
  expect(placed.frame.geo.lat).toBeCloseTo(placed.pin.geo.lat, 9);

  // The visit ends: its settle re-poses the pin and its station together.
  await page.evaluate((key) => {
    /** @type {any} */ (window)[key].endXrSession();
  }, TEST_KEY);
  await expect(page.getByTestId("enter-ar")).not.toHaveAttribute(
    "data-ar-state",
    "running",
  );
  const settled = await pinInStore(page, "Far");
  expect(settled.pin?.station).toBe(placed.pin.station);
  expect(settled.frame).not.toBeNull();
  expect(settled.frame.geo.lat).toBeCloseTo(settled.pin.geo.lat, 9);
  expect(settled.frame.geo.lon).toBeCloseTo(settled.pin.geo.lon, 9);

  // A reload, the draft offered and restored: the same station, whole.
  await page.reload();
  await openRecording(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-restore").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveAttribute(
    "data-ar-state",
    "running",
  );
  await expect
    .poll(async () => (await pinInStore(page, "Far")).pin?.station)
    .toBe(placed.pin.station);
  const restored = await pinInStore(page, "Far");
  expect(restored.frame).toEqual(settled.frame);
  expect(restored.opened).toEqual(["walk-1"]);
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
    // The strip's top: "New station here" (D8) sits above the pin and
    // the photo, next to the line it changes.
    const strip = await box(page, "setup-controls");
    const pin = await box(page, "setup-pin");
    const status = await box(page, "setup-status");
    expect(line.bottom).toBeLessThanOrEqual(strip.top);
    expect(strip.top - line.bottom).toBeLessThan(24);
    expect(line.bottom).toBeLessThanOrEqual(pin.top);
    expect(line.top).toBeGreaterThanOrEqual(status.bottom);
    expect(line.left).toBeGreaterThanOrEqual(0);
    expect(line.right).toBeLessThanOrEqual(viewport.width);
    const centre = (line.left + line.right) / 2;
    expect(Math.abs(centre - viewport.width / 2)).toBeLessThan(2);
  });
}
