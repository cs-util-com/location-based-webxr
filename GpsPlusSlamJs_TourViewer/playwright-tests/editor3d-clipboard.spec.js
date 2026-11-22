// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: Copy and Paste reach the creator through two
 * doors, the Edit menu and Ctrl+C / Ctrl+V, and both take keys the
 * browser owns. The unit tests pin the rules and the reducers; only the
 * real page shows that the keys reach the editor from the tree, that a
 * paste lands in the station selected, is one undo step and can be
 * repeated, that the menu offers only what the selection allows, and
 * that the keys stay the browser's while the creator has text selected
 * (or text would stop copying as text).
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

/**
 * The page's tour as it would be written.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<any>}
 */
function tour(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/**
 * How many children station `id` holds at its top.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function childCount(page, id) {
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  return stations.find((s) => s.id === id)?.children.length ?? -1;
}

test("Ctrl+C and Ctrl+V copy a note into another station as one step each, the Edit menu offering only what the selection allows", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  const [from, to] = stations;
  const note = /** @type {any} */ (from.children).find(
    (/** @type {any} */ c) => c.kind !== "folder",
  );
  if (from === undefined || to === undefined || note === undefined) {
    throw new Error("the sample has no note in its first station");
  }

  // Nothing selected, nothing copied: Copy and Paste are disabled.
  const edit = page.locator("#edit-menu-btn");
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator("#edit-copy")).toBeVisible();
  await expect(page.locator("#edit-copy")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.locator("#edit-paste")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#edit-menu")).toBeHidden();

  // The note, from the tree: Ctrl+C puts it on the clipboard.
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await page.locator(`#tree-body [data-select="${note.id}"]`).click();
  await page.keyboard.press("Control+c");
  await expect(page.locator(".toast", { hasText: "Copied" })).not.toHaveCount(
    0,
  );

  // Into the other station, twice: each paste one child more.
  const was = await childCount(page, to.id);
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 1);
  await expect(
    page.locator(".toast", { hasText: "Pasted a copy" }),
  ).not.toHaveCount(0);
  // The copy is selected, so the next paste goes into its station too.
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 2);

  // One undo takes one paste back.
  await page.keyboard.press("Control+z");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 1);

  // The Edit menu's Paste does what Ctrl+V does. The undo took the
  // selected copy away, so the station is selected again as the target.
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  await edit.click();
  await expect(page.locator("#edit-paste")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.locator("#edit-paste").click();
  await expect.poll(() => childCount(page, to.id)).toBe(was + 2);

  // With text selected on the page the keys are the browser's: nothing is
  // pasted into the tour.
  await page.evaluate(() => {
    const text = document.getElementById("tour-name-text");
    if (text === null) throw new Error("no tour name");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+c");
  // A paste reads no picture here and lands in the same task: a key the
  // page took would have shown by now.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => done(null))),
  );
  expect(await childCount(page, to.id)).toBe(was + 2);
});
