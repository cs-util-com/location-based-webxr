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
 * that the keys stay the browser's while the creator has text selected,
 * types in a field, has a menu open or works in a dialog (or text would
 * stop copying and pasting as text).
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

/**
 * The id of the selected row.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>}
 */
function selectedId(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * Where the child `id` of station `stationId` stands in its frame.
 * @param {import("@playwright/test").Page} page
 * @param {string} stationId
 * @param {string} id
 * @returns {Promise<number[]>}
 */
async function positionOf(page, stationId, id) {
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  const child = stations
    .find((s) => s.id === stationId)
    ?.children.find((/** @type {any} */ c) => c.id === id);
  if (child === undefined) throw new Error(`no ${id} in ${stationId}`);
  return child.pose.position;
}

/**
 * How far apart two positions are (m).
 * @param {number[]} a
 * @param {number[]} b
 */
function distance(a, b) {
  return Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
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
  // A text note: its paste reads no picture, so it lands in the task of
  // its key (the checks that a key did nothing rest on that).
  const note = /** @type {any} */ (from.children).find(
    (/** @type {any} */ c) => c.kind === "shortText" || c.kind === "longText",
  );
  if (from === undefined || to === undefined || note === undefined) {
    throw new Error("the sample has no text note in its first station");
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
  const first = await selectedId(page);
  // The copy is selected, so the next paste goes into its station too.
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 2);
  // The first copy stands in the other station exactly where the note
  // stands in its own; the second, pasted into the same station again,
  // half a metre beside it, so the two never stack.
  const second = await selectedId(page);
  const [noteAt, firstAt, secondAt] = await Promise.all([
    positionOf(page, from.id, note.id),
    positionOf(page, to.id, first),
    positionOf(page, to.id, second),
  ]);
  expect(distance(firstAt, noteAt)).toBeLessThan(1e-3);
  expect(Math.abs(distance(secondAt, firstAt) - 0.5)).toBeLessThan(1e-2);

  // One undo takes one paste back.
  await page.keyboard.press("Control+z");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 1);

  // The Edit menu's Paste does what Ctrl+V does. The undo took the
  // selected copy away and left its station selected, so the target is
  // still there.
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(`station:${to.id}`);
  await edit.click();
  await expect(page.locator("#edit-paste")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.locator("#edit-paste").click();
  await expect.poll(() => childCount(page, to.id)).toBe(was + 2);

  // With text selected on the page the keys are the browser's: nothing is
  // pasted into the tour, and nothing copied (no "Copied" toast, which is
  // why the earlier ones must be gone first).
  await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0, {
    timeout: 20_000,
  });
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
  await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0);
});

test("Ctrl+V stays the browser's in a field, with a menu open and in a dialog, and Cmd+V pastes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  const [from, to] = stations;
  // A text note: its paste reads no picture, so it lands in the task of
  // its key (the checks that a key did nothing rest on that).
  const note = /** @type {any} */ (from.children).find(
    (/** @type {any} */ c) => c.kind === "shortText" || c.kind === "longText",
  );
  if (from === undefined || to === undefined || note === undefined) {
    throw new Error("the sample has no text note in its first station");
  }
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await page.locator(`#tree-body [data-select="${note.id}"]`).click();

  // A held Ctrl+C repeats its key: it copies once, said by one toast, not
  // a toast per repeat.
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.keyboard.down("c");
  await page.keyboard.up("c");
  await page.keyboard.up("Control");
  await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(1);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => done(null))),
  );
  await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(1);

  await page.locator("#edit-menu-btn").click();
  await page.locator("#edit-copy").click();
  // The menu's Copy says so in a toast of its own, beside the key's.
  await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(2);
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  const was = await childCount(page, to.id);
  const oneFrame = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => done(null))),
    );

  // In the tree's search field.
  await page.locator("#tree-search").focus();
  await page.keyboard.press("Control+v");
  await oneFrame();
  expect(await childCount(page, to.id)).toBe(was);
  await page.locator("#tree-search").blur();

  // With the Edit menu open.
  await page.locator("#edit-menu-btn").click();
  await expect(page.locator("#edit-menu")).toBeVisible();
  await page.keyboard.press("Control+v");
  await oneFrame();
  expect(await childCount(page, to.id)).toBe(was);
  await page.keyboard.press("Escape");
  await expect(page.locator("#edit-menu")).toBeHidden();

  // In a dialog (Tour details).
  await page.locator("#tour-name").click();
  await expect(page.locator("#details-modal")).toBeVisible();
  await page.keyboard.press("Control+v");
  await oneFrame();
  expect(await childCount(page, to.id)).toBe(was);
  await page.locator("#details-cancel").click();
  await expect(page.locator("#details-modal")).toBeHidden();

  // Cmd+V is the page's paste too, into the station still selected (a
  // click on it again would take the selection away).
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(`station:${to.id}`);
  await page.keyboard.press("Meta+v");
  await expect.poll(() => childCount(page, to.id)).toBe(was + 1);
});

/**
 * Whether station `stationId` holds the child `id` at its top.
 * @param {import("@playwright/test").Page} page
 * @param {string} stationId
 * @param {string} id
 */
async function holds(page, stationId, id) {
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  return (
    stations
      .find((s) => s.id === stationId)
      ?.children.some((/** @type {any} */ c) => c.id === id) ?? false
  );
}

test("Ctrl+X and Ctrl+V move a note to another station as one step that keeps its id, and Escape cancels a cut", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  const [from, to] = stations;
  const note = /** @type {any} */ (from.children).find(
    (/** @type {any} */ c) => c.kind === "shortText" || c.kind === "longText",
  );
  if (from === undefined || to === undefined || note === undefined) {
    throw new Error("the sample has no text note in its first station");
  }
  const row = page.locator(`#tree-body [data-select="${note.id}"]`);
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await row.click();

  // Cut shows on what it cut, which stays in place until the paste;
  // Escape cancels it and keeps the selection.
  await page.keyboard.press("Control+x");
  await expect(row).toHaveAttribute("data-cut", "true");
  expect(await holds(page, from.id, note.id)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(row).not.toHaveAttribute("data-cut", "true");
  await expect(
    page.locator(".toast", { hasText: "Cut cancelled" }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(note.id);

  // Cut again, pasted onto the other station: the same note moves, said
  // with where it now stands, and it stays selected.
  await page.keyboard.press("Control+x");
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => holds(page, to.id, note.id)).toBe(true);
  expect(await holds(page, from.id, note.id)).toBe(false);
  await expect(
    page.locator(".toast", { hasText: "station's centre" }),
  ).not.toHaveCount(0);
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.selected(),
    ),
  ).toBe(note.id);
  await expect(row).not.toHaveAttribute("data-cut", "true");

  // One undo puts it back where it was.
  await page.keyboard.press("Control+z");
  await expect.poll(() => holds(page, from.id, note.id)).toBe(true);
  expect(await holds(page, to.id, note.id)).toBe(false);
});

test("a copied station is pasted after the selected one, and two pasted notes are both selected", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const stations = /** @type {any[]} */ ((await tour(page)).stations);
  const [from, to] = stations;
  const note = /** @type {any} */ (from?.children ?? []).find(
    (/** @type {any} */ c) => c.kind === "shortText" || c.kind === "longText",
  );
  if (from === undefined || to === undefined || note === undefined) {
    throw new Error("the sample has no text note in its first station");
  }
  const ids = async () =>
    /** @type {any[]} */ ((await tour(page)).stations).map((s) => s.id);
  const selected = () =>
    page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected());

  // The first station copied, pasted with the second selected: the copy
  // follows the second.
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await page.keyboard.press("Control+c");
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await ids()).length).toBe(stations.length + 1);
  const order = await ids();
  const copy = order[order.indexOf(to.id) + 1];
  expect(stations.some((s) => s.id === copy)).toBe(false);
  expect(await selected()).toBe(`station:${copy}`);

  // Two notes in the second station (the note pasted there twice), picked
  // and pasted into the first: both copies are selected, as their
  // sources were.
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await page.locator(`#tree-body [data-select="${note.id}"]`).click();
  await page.keyboard.press("Control+c");
  const had = await childCount(page, to.id);
  await page.locator(`#tree-body [data-select="station:${to.id}"]`).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, to.id)).toBe(had + 1);
  const first = await selected();
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, to.id)).toBe(had + 2);
  const second = await selected();
  await page.locator(`#tree-body [data-select="${first}"]`).click();
  await page
    .locator(`#tree-body [data-select="${second}"]`)
    .click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+c");
  const was = await childCount(page, from.id);
  await page.locator(`#tree-body [data-select="station:${from.id}"]`).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => childCount(page, from.id)).toBe(was + 2);
  const picked = /** @type {string[]} */ (
    await page.evaluate(() => /** @type {any} */ (window).__tourEditor.picked())
  );
  expect(picked).toHaveLength(2);
  expect(picked).not.toContain(first);
  expect(picked).not.toContain(second);
});
