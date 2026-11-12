// @ts-check
import { expect, test } from "@playwright/test";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { encodeRgbPng } from "../../scripts/e2e/terrarium-png.mjs";
import {
  GLOBE_VIEW,
  SQUARE_GROUND_M,
  answerHosts,
  noApproach,
  noClouds,
  openZip,
} from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";
import { stationBlocks, storyOf, told } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a character of a station's story is set in the
 * 3D editor's inspector of his entry - his view, how the step showing him
 * moves on, the heading he faces (shown in the pop-up view alone: a flat
 * figure faces the visitor fully, the facing turns only that stage). Only the page shows the chips, the
 * shell, the session and the save working together: each change must be
 * one undo step, be saved as the format reads it, and come back pressed
 * on the next open. The character is declared by the fixture tour (the
 * editor has no UI for declaring one yet).
 */

test.describe.configure({ mode: "default" });

// The walk runs on the globe, whose first frames on a software-WebGL
// runner are slow: measured 2.2 min (CI=1, one worker, 2026-11-03), so
// the budget is about twice that.
const BUDGET_MS = 270_000;

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/** A tour of one station whose story shows Wendel, a declared character,
 *  in the speak view, moving on by a tap. As a zip. */
async function characterTour() {
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Wendel's gate",
    tourId: "0123456789abcdef0123456789abcdef",
    assets: [
      {
        id: "wendel",
        path: "content/wendel.png",
        kind: "image",
        width: 1,
        height: 1,
      },
    ],
    characters: [{ id: "wendel", name: "Wendel", image: "wendel" }],
    stations: [
      {
        id: "gate",
        title: "The gate",
        geo: {
          lat: 48.13725,
          lon: 11.57549,
          alt: SQUARE_GROUND_M + N_M,
          headingDeg: 0,
        },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        children: [
          storyOf("wendel-story", [
            told({
              id: "w1",
              kind: "character",
              view: "speak",
              character: "wendel",
              name: "Wendel",
              image: "wendel",
              caption: "Good day, traveller!",
              pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
            }),
          ]),
        ],
      },
    ],
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  await writer.add(
    "content/wendel.png",
    new Uint8ArrayReader(new Uint8Array(encodeRgbPng(1, 1, [120, 90, 60]))),
  );
  return Buffer.from(await writer.close());
}

/**
 * The editor with `zip` open in the 3D view and Wendel's entry selected:
 * his settings are in his entry's inspector, reached through the
 * station's card and the story's folder in the tree.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} zip
 */
async function openAndSelect(page, zip) {
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await noApproach(page);
  // Not about the clouds: without them a click waits about 1.8 s rather
  // than 9-10 s (`noClouds`), and with them a CI runner ran out the 5 s
  // wait for the picked station.
  await noClouds(page);
  await page.goto(GLOBE_VIEW);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "wendel.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  const card = page.locator('#tree-body .card[data-station="gate"]');
  for (const fold of [
    card.locator(".head .tw"),
    card.locator('[data-folder="wendel-story"]'),
  ]) {
    if ((await fold.getAttribute("aria-expanded")) !== "true") {
      await fold.click();
    }
    await expect(fold).toHaveAttribute("aria-expanded", "true");
  }
  await card.locator('[data-select="w1"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe("w1");
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/** @param {import("@playwright/test").Page} page */
async function gateNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  return tour.stations.find((/** @type {any} */ s) => s.id === "gate");
}

/**
 * Wendel's section of the inspector.
 * @param {import("@playwright/test").Page} page
 */
function wendel(page) {
  return page.locator('#shell-inspector .character[data-block="w1"]');
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} act
 */
function chip(page, act) {
  return wendel(page).locator(`[data-act="${act}"]`);
}

/**
 * The tour.json of a saved zip.
 * @param {Buffer} zip
 */
async function savedTour(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "tour.json",
  );
  const text = (await entry?.getData?.(new TextWriter())) ?? "{}";
  await reader.close();
  return JSON.parse(text);
}

test("a story character's view, advance and facing set in his entry's inspector are one step each, saved, and open again pressed", async ({
  page,
  context,
}) => {
  test.setTimeout(BUDGET_MS);
  await openAndSelect(page, await characterTour());
  await expect(wendel(page)).toBeVisible();
  await expect(chip(page, "character-view:w1:speak")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chip(page, "character-advance:w1:tap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const facing = wendel(page).locator('[data-field="character-facing:w1"]');
  // In the speak view a turn shows nothing: no facing to set.
  await expect(facing).toHaveCount(0);
  const start = await revision(page);

  // The view: one step, the chip pressed after the inspector's draw.
  await chip(page, "character-view:w1:popup").click();
  await expect
    .poll(async () => stationBlocks(await gateNow(page))[0].view)
    .toBe("popup");
  expect(await revision(page)).toBe(start + 1);
  await expect(chip(page, "character-view:w1:popup")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The chip already pressed writes nothing.
  await chip(page, "character-view:w1:popup").click();
  expect(await revision(page)).toBe(start + 1);
  // The pop-up stage keeps his facing: its field shows.
  await expect(facing).toHaveValue("90");

  // How his step moves on.
  await chip(page, "character-advance:w1:lineEnd").click();
  await expect
    .poll(async () => stationBlocks(await gateNow(page))[0].advance)
    .toEqual({ mode: "lineEnd" });
  expect(await revision(page)).toBe(start + 2);

  // His facing, typed as a heading: south.
  await facing.fill("180");
  await facing.press("Enter");
  await expect.poll(() => revision(page)).toBe(start + 3);
  await expect(
    wendel(page).locator('[data-field="character-facing:w1"]'),
  ).toHaveValue("180");

  // One undo takes back the facing alone; redo brings it again.
  await page.locator("#studio-undo").click();
  await expect(
    wendel(page).locator('[data-field="character-facing:w1"]'),
  ).toHaveValue("90");
  expect(stationBlocks(await gateNow(page))[0].advance).toEqual({
    mode: "lineEnd",
  });
  await page.locator("#studio-redo").click();
  await expect(
    wendel(page).locator('[data-field="character-facing:w1"]'),
  ).toHaveValue("180");

  // Saved as the format reads it, and opened again with the chips pressed.
  const download = page.waitForEvent("download");
  await save(page);
  const saved = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const zip = readFileSync(saved);
  const gate = (await savedTour(zip)).stations[0];
  expect(stationBlocks(gate)[0]).toMatchObject({
    id: "w1",
    view: "popup",
    character: "wendel",
    pose: { position: [3, 0, 0] },
  });
  // Facing south: a quarter turn about Up alone from no turn (east), the
  // turn's SIGN included - north is the opposite quarter turn, whose
  // components have the same sizes. Read as y*w, which a quaternion's
  // other sign (-q, the same turn) leaves alone: -1/2 south, +1/2 north.
  const [x, y, z, w] = stationBlocks(gate)[0].pose.rotation;
  expect([x, z]).toEqual([0, 0]);
  expect(Math.abs(y)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(Math.abs(w)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(y * w).toBeCloseTo(-0.5, 6);
  expect(stationBlocks(gate)[0].advance).toEqual({ mode: "lineEnd" });

  const next = await context.newPage();
  await openAndSelect(next, zip);
  await expect(chip(next, "character-view:w1:popup")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chip(next, "character-advance:w1:lineEnd")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    wendel(next).locator('[data-field="character-facing:w1"]'),
  ).toHaveValue("180");
});
