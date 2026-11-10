// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { makeCharacter } from "./character-sheet.js";
import { answerHosts, openSampleIn3d, openZip } from "./editor3d-fixture.js";
import { fileCommand, save } from "./editor-menus.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why this test matters: a guide character reaches a tour in four places
 * that only meet in the page - the maker (its cut worker and its library in
 * the origin-private file system), the maker shown over the editor in a
 * frame of the same origin, the editor's Characters list reading that
 * library when the maker closes, and the tour file written with the
 * character's two pictures. This walks it as a creator does: a station's
 * "+" menu, "Character", the maker over the editor, a character made and
 * saved there, back to the tour, where he stands in the station; then the
 * tour saved and opened again in a new page, the character and his
 * pictures still in it, and the Characters list showing him as in this
 * tour. The sheet is drawn by the test, not by the code under test.
 *
 * What it cannot catch: how good the cut is on real image-AI pictures, and
 * how the free character looks in the 3D view (he is not drawn there yet).
 */

test.describe.configure({ mode: "default" });

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {Buffer} zip */
async function entries(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
  return out;
}

/** The station's free character naming `characterId`, if any.
 *  @param {any} manifest @param {string} stationId @param {string} characterId */
function standing(manifest, stationId, characterId) {
  const station = manifest.stations.find(
    (/** @type {any} */ s) => s.id === stationId,
  );
  return stationBlocks(station).find(
    (/** @type {any} */ b) =>
      b.kind === "character" && b.character === characterId,
  );
}

test("the add menu's Character: made in the maker over the editor, standing in the station, saved and opened again", async ({
  page,
  context,
}) => {
  // Two editor pages and the maker beside software-drawn 3D views:
  // measured 2026-11-10 alone on this machine, the run took 3.3 min with
  // its server start (CI=1, one worker); the budget leaves room for a
  // slower runner.
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // The save goes to a download, and the file input opens it again.
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await openSampleIn3d(page);

  // The station's "+": the type menu, then "Character".
  const gate = page.locator('#tree-body .card[data-station="gate"]');
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  const menu = page.locator("#tree-add-menu");
  await expect(menu).toBeVisible();
  await menu.locator('[data-kind="character"]').click();

  // The maker over the editor, on a new character.
  const dialog = page.locator("#characters-maker");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#characters-maker-frame")).toHaveAttribute(
    "src",
    /characters\.html\?in=editor&start=new$/,
  );
  const maker = page.frameLocator("#characters-maker-frame");
  await makeCharacter(maker, page, "Ranger Rita");
  await expect(maker.locator("#savedBox")).toContainText(
    "Go back to your tour with the button at the top",
  );
  await page.locator("#characters-maker-back").click();
  await expect(dialog).toBeHidden();

  // Back in the tour: declared, standing in the station, selected, said.
  // His pictures are read and copied in beside the software-drawn view,
  // so the outcome gets time; any outcome is waited for, so a refusal
  // fails with the words the page said.
  const outcome = page
    .locator(".toast")
    .filter({ hasText: /Ranger Rita|nothing was added|could not be read/ });
  await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
  await expect(outcome.first()).toContainText('Added Ranger Rita to "');
  const made = await tourNow(page);
  const rita = (made.characters ?? []).find(
    (/** @type {any} */ c) => c.name === "Ranger Rita",
  );
  expect(rita).toBeTruthy();
  const item = standing(made, "gate", rita.id);
  expect(item).toMatchObject({ kind: "character", view: "speak" });
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(item.id);

  // Saved: the declaration with both pictures, the item naming him.
  const download = page.waitForEvent("download");
  await save(page);
  const saved = readFileSync(await (await download).path());
  const files = await entries(saved);
  const written = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  const declared = written.characters.find(
    (/** @type {any} */ c) => c.id === rita.id,
  );
  expect(declared?.name).toBe("Ranger Rita");
  for (const assetId of [declared.image, declared.frames]) {
    const path = written.assets.find(
      (/** @type {any} */ a) => a.id === assetId,
    )?.path;
    expect(path, `the file for ${String(assetId)}`).toBeTruthy();
    expect(files.get(path)?.byteLength ?? 0).toBeGreaterThan(100);
  }
  expect(standing(written, "gate", rita.id)).toBeTruthy();

  // Opened again in a new page: he is still there, and the list says so.
  await page.close();
  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, saved, "sample-with-rita.zip");
  await expect(next.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  const reopened = await tourNow(next);
  expect(standing(reopened, "gate", rita.id)).toBeTruthy();
  await fileCommand(next, "characters");
  await expect(next.locator("#characters-panel")).toBeVisible();
  await expect(next.locator("#characters-tour li")).toHaveCount(1);
  await expect(next.locator("#characters-tour li")).toContainText(
    "Ranger Rita",
  );
  const onDevice = next.locator("#characters-lib li", {
    hasText: "Ranger Rita",
  });
  await expect(onDevice).toContainText("In this tour");
  await expect(onDevice.locator("[data-add]")).toHaveCount(0);
});
