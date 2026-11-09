// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: Add is the way in to the palette for a touch
 * screen, and it lives in two places: the top bar, and from 560 px down
 * the Edit menu, where the bar has no room for it. A unit test without a
 * layout cannot see which of the two a phone gets, and the closing menu
 * takes the palette's return target with it. So each side of 560 px opens
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
  await open3dAt(page, 561);
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
  await search.fill("town hall");
  await expect(cards).toHaveCount(1);
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

test("Tab leaves the palette from where it was opened, not off the page's end", async ({
  page,
}) => {
  // Why: the palette is the page's last element, so a Tab from its field,
  // which closes it, wrapped to the page's first control (a browser with
  // its own bar goes there first). Only a real browser's Tab can show it.
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const add = page.locator("#studio-add");
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#add-palette-input")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#add-palette")).toBeHidden();
  await expect(page.locator("#studio-help")).toBeFocused();
});

test("a station copied with Ctrl+D during a search is in the list", async ({
  page,
}) => {
  // Why: the selection can be a station the search hides, and its copy
  // matches the search no better, so the copy must clear it like every
  // other way of making a station.
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const cards = page.locator("#tree-body .card[data-station]");
  await expect(cards).toHaveCount(3);
  await cards.first().locator(".head").click();
  await expect(page.locator("#tree-body .card.sel")).toHaveCount(1);
  const search = page.locator("#tree-search");
  await search.fill("town hall");
  await expect(cards).toHaveCount(1);
  await search.blur();
  await page.keyboard.press("Control+d");
  await expect(
    page.locator(".toast", { hasText: "Duplicated" }),
  ).not.toHaveCount(0);
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(4);
  await expect(page.locator("#tree-body .card.sel")).toBeVisible();
});

/**
 * A new item selected in a folded station, then a search that finds neither
 * of them. Returns the search field, the station's card and its id.
 * @param {import("@playwright/test").Page} page
 */
async function selectItemHiddenBySearch(page) {
  const cards = page.locator("#tree-body .card[data-station]");
  await expect(cards).toHaveCount(3);
  const id = await cards
    .filter({ hasNotText: /town hall/i })
    .first()
    .getAttribute("data-station");
  const card = page.locator(`#tree-body .card[data-station="${id}"]`);
  await card.locator(".pick").click();
  await page.keyboard.press("Control+k");
  await page.locator("#add-palette-input").fill("short");
  await page.keyboard.press("Enter");
  await expect(card.locator(".kid.sel")).toBeVisible();
  await card.locator(".head .tw").click();
  await expect(card.locator(".head .tw")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const search = page.locator("#tree-search");
  await search.fill("town hall");
  await expect(cards).toHaveCount(1);
  await expect(card).toHaveCount(0);
  await search.blur();
  return { search, card, id };
}

test("an item copied with Ctrl+D during a search is in the list, in its unfolded station", async ({
  page,
}) => {
  // Why: the copy matches the search no better than the item the search
  // hides, and ending the search folds what it had unfolded, so the copy
  // needs both, as a copied station does.
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const { search, card } = await selectItemHiddenBySearch(page);
  await page.keyboard.press("Control+d");
  await expect(
    page.locator(".toast", { hasText: "Duplicated" }),
  ).not.toHaveCount(0);
  await expect(search).toHaveValue("");
  await expect(card.locator(".head .tw")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(card.locator(".kid.sel")).toBeVisible();
});

test("an item moved out of every circle during a search stays in its station and makes none", async ({
  page,
}) => {
  // Why: a move once gave an item that left every circle a station of
  // its own; now it keeps its station and says so. Moved while a search
  // hides it, the search stays as the creator typed it, and when it ends
  // the item is still in that station and the list has gained none.
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const { search, card } = await selectItemHiddenBySearch(page);
  await page.locator('#shell-inspector [data-act="position"]').click();
  const north = page.locator('#shell-inspector [data-field="north"]');
  await north.fill("5000");
  await north.press("Enter");
  await expect(
    page.locator(".toast", { hasText: "outside its circle" }),
  ).not.toHaveCount(0);
  await expect(search).toHaveValue("town hall");
  await expect(card).toHaveCount(0);
  await search.fill("");
  await expect(page.locator("#tree-body .card[data-station]")).toHaveCount(3);
  await expect(card.locator(".head .tw")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await card.locator(".head .tw").click();
  await expect(card.locator(".kid.sel")).toBeVisible();
});

test("an item moved to a new station during a search ends the search, the new station selected and unfolded", async ({
  page,
}) => {
  // Why: the station the move makes matches the search no better than the
  // item did, so the search has to end for the creator to see what the
  // move made: the new station in the list, selected, the item in it.
  test.setTimeout(180_000);
  await open3dAt(page, 1280);
  const { search, card, id } = await selectItemHiddenBySearch(page);
  await page.locator('#shell-inspector [data-act="split"]').click();
  await expect(
    page.locator(".toast", { hasText: "New station" }),
  ).not.toHaveCount(0);
  await expect(search).toHaveValue("");
  await expect(page.locator("#tree-body .card[data-station]")).toHaveCount(4);
  const made = page.locator("#tree-body .card.sel");
  await expect(made).toBeVisible();
  expect(await made.getAttribute("data-station")).not.toBe(id);
  await expect(made.locator(".head .tw")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(made.locator(".kid")).toHaveCount(1);
  await expect(card).toBeVisible();
});
