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
import { SQUARE_GROUND_M, answerHosts, openZip } from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";

/**
 * Why these tests matter: a character of a station's story is set in the
 * 3D editor's station inspector - his view, how the step showing him
 * moves on, the heading he faces. Only the page shows the chips, the
 * shell, the session and the save working together: each change must be
 * one undo step, be saved as the format reads it, and come back pressed
 * on the next open. The character is declared by the fixture tour (the
 * editor has no UI for declaring one yet).
 */

test.describe.configure({ mode: "default" });

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/** A tour of one station whose story shows Wendel, a declared character,
 *  in the speak view, moving on by a tap. As a zip. */
async function characterTour() {
  const manifest = {
    ...createEmptyTourManifest(),
    minor: 2,
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
        blocks: [
          {
            id: "w1",
            kind: "character",
            view: "speak",
            character: "wendel",
            name: "Wendel",
            image: "wendel",
            caption: "Good day, traveller!",
            pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
          },
        ],
        steps: [
          {
            id: "s1",
            action: { kind: "show", block: "w1" },
            advance: { mode: "tap" },
          },
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
 * The editor with `zip` open in the 3D view and its station selected.
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
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "wendel.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await page.locator('#tree-body .card[data-station="gate"] .pick').click();
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe("station:gate");
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

test("a story character's view, advance and facing set in the station's inspector are one step each, saved, and open again pressed", async ({
  page,
  context,
}) => {
  test.slow();
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
  await expect(facing).toHaveValue("90");
  const start = await revision(page);

  // The view: one step, the chip pressed after the inspector's draw.
  await chip(page, "character-view:w1:two-stations").click();
  await expect
    .poll(async () => (await gateNow(page)).blocks[0].view)
    .toBe("two-stations");
  expect(await revision(page)).toBe(start + 1);
  await expect(chip(page, "character-view:w1:two-stations")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The chip already pressed writes nothing.
  await chip(page, "character-view:w1:two-stations").click();
  expect(await revision(page)).toBe(start + 1);

  // How his step moves on.
  await chip(page, "character-advance:w1:lineEnd").click();
  await expect
    .poll(async () => (await gateNow(page)).steps[0].advance)
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
  expect((await gateNow(page)).steps[0].advance).toEqual({ mode: "lineEnd" });
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
  expect(gate.blocks[0]).toMatchObject({
    id: "w1",
    view: "two-stations",
    character: "wendel",
    pose: { position: [3, 0, 0] },
  });
  // Facing south: a quarter turn about Up alone from no turn (east).
  const [x, y, z, w] = gate.blocks[0].pose.rotation;
  expect([x, z]).toEqual([0, 0]);
  expect(Math.abs(y)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(Math.abs(w)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(gate.steps[0].advance).toEqual({ mode: "lineEnd" });

  const next = await context.newPage();
  await openAndSelect(next, zip);
  await expect(chip(next, "character-view:w1:two-stations")).toHaveAttribute(
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
