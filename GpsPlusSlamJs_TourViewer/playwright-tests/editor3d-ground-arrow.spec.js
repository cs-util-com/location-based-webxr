// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  capture,
  keepRejections,
  openSampleIn3d,
  rejections,
} from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a short text laid on the ground as an arrow gets
 * its style, its floor placement, its caption on the arrow, its colours
 * and its bend from the inspector alone, and the sun check warns of a
 * pale colour the moment it is picked. Only the page shows the panel, the
 * edit store and the 3D view working together. Each control is found by
 * its role and its name, as a creator (and a screen reader) finds it, on
 * a desktop and on a phone on its side, and must write exactly its own
 * field.
 */

// One worker for the file: software-drawn 3D views side by side are
// several times slower than one after another.
test.describe.configure({ mode: "default" });

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
];

/**
 * The tour's blocks, each with its station's id.
 * @param {import("@playwright/test").Page} page
 */
async function blocksNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  return tour.stations.flatMap((/** @type {any} */ station) =>
    stationBlocks(station).map((/** @type {any} */ block) => ({
      block,
      station: station.id,
    })),
  );
}

/**
 * The short text `id` as the tour has it now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function shortTextNow(page, id) {
  const found = (await blocksNow(page)).find((b) => b.block.id === id);
  return found?.block ?? null;
}

/**
 * A chip of the inspector's group `group`, by its name.
 * @param {import("@playwright/test").Page} page
 * @param {string} group
 * @param {string} name
 */
function chip(page, group, name) {
  return page
    .locator("#shell-inspector")
    .getByRole("group", { name: group })
    .getByRole("button", { name, exact: true });
}

for (const viewport of VIEWPORTS) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;
  test(`a short text becomes a ground arrow with its own look, at ${size}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await keepRejections(page);
    await answerHosts(page);
    await openSampleIn3d(page);
    const first = (await blocksNow(page)).find(
      (b) => b.block.kind === "shortText",
    );
    if (first === undefined) throw new Error("the sample has no short text");
    const { block, station } = first;
    const row = page.locator(`#tree-body [data-select="${block.id}"]`);
    if (!(await row.isVisible())) {
      await page
        .locator(`#tree-body [data-select="station:${station}"]`)
        .click();
    }
    await row.click();
    const inspector = page.locator("#shell-inspector");

    // On the ground: the ribbon by default, with its turn and its bend.
    await chip(page, "Shows as", "Ground arrow").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.view)
      .toBe("ground");
    await expect(chip(page, "Ground style", "Ribbon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(inspector.getByRole("group", { name: "Turns" })).toHaveCount(
      1,
    );

    // A floor arrow standing upright, its caption on it.
    await chip(page, "Ground style", "Floor arrow").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.style)
      .toBe("floor");
    await chip(page, "Floor arrow", "Upright").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.floorPlacement)
      .toBe("upright");
    await inspector
      .getByRole("checkbox", { name: "Caption on the arrow" })
      .check();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.captionOnArrow)
      .toBe(true);

    // Vanes, its rim pale: the sun check warns at once.
    await chip(page, "Ground style", "Vanes").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.style)
      .toBe("vanes");
    await expect(
      inspector.getByRole("checkbox", { name: "Caption on the arrow" }),
    ).toHaveCount(0);
    await inspector.getByLabel("Rim colour").fill("#eeeeee");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.darkColor)
      .toBe("#eeeeee");
    await expect(inspector.getByText(/^Sun warning/)).toBeVisible();

    // The role's colours back: both colours gone from the file.
    await inspector.getByRole("button", { name: "Role colours" }).click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.darkColor)
      .toBeUndefined();
    await expect(inspector.getByText(/^Sun check/)).toBeVisible();

    // Bent 25 degrees to the right, typed.
    const bend = inspector.getByLabel("Bend", { exact: true });
    await bend.fill("25");
    await bend.press("Enter");
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.bendDeg)
      .toBe(25);

    const after = await shortTextNow(page, block.id);
    expect(after.caption).toBe(block.caption);
    await capture(page, `test-results/ground-arrow-${size}.png`);
    expect(await rejections(page)).toEqual([]);
  });
}
