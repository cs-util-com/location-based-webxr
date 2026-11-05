// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: Add is the way in to the palette for a touch
 * screen, and it lives in two places: the top bar, and from 520 px down
 * the Edit menu, where the bar has no room for it. A unit test without a
 * layout cannot see which of the two a phone gets, and the closing menu
 * takes the palette's return target with it. So each side of 520 px opens
 * the palette, adds, and comes back with the focus on something shown.
 * And a station added during a search must be in the list: it is selected
 * and said, but its name matches nothing typed.
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

/**
 * The sample tour in the 3D view at `width`.
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 */
async function open3dAt(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await answerHosts(page);
  await openSampleIn3d(page);
}

/**
 * With the palette open: it lies inside the window, the focus in its
 * field, and Enter adds a short text to the default place.
 * @param {import("@playwright/test").Page} page
 */
async function addShortText(page) {
  const palette = page.locator("#add-palette");
  await expect(palette).toBeVisible();
  await expect(page.locator("#add-palette-input")).toBeFocused();
  const box = await palette.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(width);
  await page.locator("#add-palette-input").fill("short");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.locator(".toast", { hasText: "Added" })).not.toHaveCount(0);
}

test("just above a phone's width the top bar's Add opens the palette, and Escape comes back to it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open3dAt(page, 521);
  const add = page.locator("#studio-add");
  await expect(add).toBeVisible();
  await expect(page.locator("#edit-menu-btn")).toBeHidden();
  await add.click();
  await addShortText(page);
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#add-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#add-palette")).toBeHidden();
  await expect(add).toBeFocused();
});

test("at a phone's width the Edit menu's Add opens the palette, and Escape comes back to the menu's button", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open3dAt(page, 520);
  await expect(page.locator("#studio-add")).toBeHidden();
  const edit = page.locator("#edit-menu-btn");
  await expect(edit).toBeVisible();
  await edit.click();
  await page.locator("#edit-add").click();
  await addShortText(page);
  // By the keyboard: the item holds the focus until the menu closes under
  // it, so the palette must not take it for where the focus goes back.
  await edit.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#edit-add")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#add-palette")).toBeVisible();
  await expect(page.locator("#edit-menu")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#add-palette")).toBeHidden();
  await expect(edit).toBeFocused();
});

test("a station added during a search is in the list, and the grips say they drag nothing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const cards = page.locator("#tree-body .card[data-station]");
  await expect(cards).toHaveCount(3);
  const search = page.locator("#tree-search");
  const words = (await cards.first().locator(".head").innerText()).split(/\s+/);
  await search.fill(words.filter(Boolean).pop() ?? "");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator(".grip")).toHaveCSS(
    "cursor",
    "not-allowed",
  );
  await page.keyboard.press("Control+k");
  await page.locator("#add-palette-input").fill("new station");
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(4);
  await expect(page.locator("#tree-body .card.sel")).toBeVisible();
});
