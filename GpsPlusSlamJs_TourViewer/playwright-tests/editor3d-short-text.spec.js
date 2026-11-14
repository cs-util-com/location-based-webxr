// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  capture,
  keepRejections,
  openSampleIn3d,
  rejections,
  showList,
} from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a short text is turned into a sign or an edge
 * hint, given its role and, as a sign, its turn, on the inspector's chips
 * alone; only the page shows the panel, the edit store and the 3D view
 * working together. Each chip is found by its role and its name, as a
 * creator (and a screen reader) finds it, on a desktop and on a phone on
 * its side, and must write exactly its own field.
 */

// One worker for the file: software-drawn 3D views side by side are
// several times slower than one after another.
test.describe.configure({ mode: "default" });

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
];

/**
 * The first short text of the sample tour, as the tour has it.
 * @param {import("@playwright/test").Page} page
 */
async function firstShortText(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  for (const station of tour.stations) {
    const block = stationBlocks(station).find(
      (/** @type {any} */ b) => b.kind === "shortText",
    );
    if (block !== undefined) return { block, station: station.id };
  }
  throw new Error("the sample has no short text");
}

/**
 * The short text `id` as the tour has it now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function shortTextNow(page, id) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  for (const station of tour.stations) {
    const block = stationBlocks(station).find(
      (/** @type {any} */ b) => b.id === id,
    );
    if (block !== undefined) return block;
  }
  return null;
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
  test(`a short text becomes a sign and an edge hint on its chips, at ${size}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await keepRejections(page);
    await answerHosts(page);
    await openSampleIn3d(page);
    const { block, station } = await firstShortText(page);
    const row = page.locator(`#tree-body [data-select="${block.id}"]`);
    if (!(await row.isVisible())) {
      await page
        .locator(`#tree-body [data-select="station:${station}"]`)
        .click();
      // A phone shows the station's details in the list's place.
      await showList(page);
    }
    await row.click();

    // A pin: its view pressed, the reader's default role, no turn.
    await expect(chip(page, "Shows as", "Pin")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(chip(page, "Role", "Label")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.locator("#shell-inspector").getByRole("group", { name: "Turns" }),
    ).toHaveCount(0);

    // A sign, a warning, turning to the visitor.
    await chip(page, "Shows as", "Sign").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.view)
      .toBe("sign");
    await chip(page, "Role", "Warning").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.role)
      .toBe("warning");
    await expect(chip(page, "Turns", "Fixed")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await chip(page, "Turns", "Faces you").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.orientation)
      .toBe("face");
    await capture(page, `test-results/short-text-sign-${size}.png`);

    // An edge hint: the turn is a sign's only.
    await chip(page, "Shows as", "Edge hint").click();
    await expect
      .poll(async () => (await shortTextNow(page, block.id))?.view)
      .toBe("edgeHint");
    await expect(
      page.locator("#shell-inspector").getByRole("group", { name: "Turns" }),
    ).toHaveCount(0);
    const after = await shortTextNow(page, block.id);
    expect(after.caption).toBe(block.caption);
    expect(after.role).toBe("warning");
    await capture(page, `test-results/short-text-edge-hint-${size}.png`);
    expect(await rejections(page)).toEqual([]);
  });
}
