// @ts-check
import { readFileSync } from "node:fs";

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

import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  boxIn,
  capture,
  layoutOf,
  openSampleIn3d,
  openZip,
  view3d,
} from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";
import { useWideFont } from "./wide-font.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: the tree is where a creator shapes the tour -
 * adds a station, puts the stations in the order a visitor walks them,
 * copies one, deletes one - and each of these must reach the tour as ONE
 * step (one undo), be saved and come back on the next open. Only the page
 * shows whether the tree's buttons, its drag, the scene's ground menu, the
 * store and the save work together. These open the sample tour in the 3D
 * view and drive the tree as a creator does; copy a station with a photo,
 * save it and open the saved file; and pin the tree's new controls in
 * place at a phone, a phone in landscape, a tablet and a desktop.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/**
 * The tour's station ids, in its order.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
async function order(page) {
  const tour = await tourNow(page);
  return tour.stations.map((/** @type {any} */ s) => s.id);
}

/**
 * Wait until the camera has stopped moving: the screen point of
 * `selection` is the same two frames apart. The orbit keeps a pan's
 * momentum after the drag and spends it a share per frame (OrbitControls'
 * damping counts frames, not time), so on a slow renderer a fixed number
 * of frames after a drag can leave the camera still coasting - and then
 * a point pressed now is no longer under the same pixel a moment later.
 * @param {import("@playwright/test").Page} page
 * @param {string} selection
 */
async function cameraSettled(page, selection) {
  /** @type {readonly number[] | null} */
  let last = null;
  await expect
    .poll(
      async () => {
        await afterFrames(page, 2);
        const now = await page.evaluate(
          (id) => /** @type {any} */ (window).__tourEditor.view3dScreenOf(id),
          selection,
        );
        const still =
          last !== null &&
          now !== null &&
          Math.hypot(now[0] - last[0], now[1] - last[1]) < 0.05;
        last = now;
        return still;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * A station's card in the tree.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function card(page, id) {
  return page.locator(`#tree-body .card[data-station="${id}"]`);
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/**
 * Drag a station's card by its grip to the lower half of another's.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {string} below
 */
async function dragBelow(page, id, below) {
  const grip = await box(card(page, id).locator(".grip"));
  const onto = await box(card(page, below));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height * 0.8, {
    steps: 6,
  });
}

test("the tree adds, reorders and deletes stations, each one step to undo", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  expect(await order(page)).toEqual(["column", "gate", "steps"]);

  // "+": a station at the centre of the view, selected and said.
  const start = await revision(page);
  await page.locator("#tree-add").click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  expect(await selected(page)).toBe(`station:${added}`);
  await expect(
    page.locator(".toast", {
      hasText: 'Added "Station 4" at the centre of the view',
    }),
  ).toBeVisible();
  await expect(card(page, added)).toBeVisible();
  expect(await revision(page)).toBe(start + 1);
  // Made here, so it starts unlocked: placing it is what comes next.
  await expect(
    page.locator("#shell-inspector [data-act='lock']"),
  ).toHaveAttribute("aria-pressed", "false");
  // Where the camera looks: under the orbit's centre.
  const stats = await view3d(page);
  const point = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dPointOf(id),
    `station:${added}`,
  );
  expect(
    Math.hypot(point[0] - stats.target[0], point[2] - stats.target[2]),
  ).toBeLessThan(0.5);
  await page.keyboard.press("Control+z");
  await expect.poll(() => order(page)).toEqual(["column", "gate", "steps"]);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);
  // The undo dropped the selection with the station; select it again.
  await card(page, added).locator(".pick").click();
  expect(await selected(page)).toBe(`station:${added}`);

  // A drag by the grip: shown where it lands, then one reorder.
  const beforeDrag = await revision(page);
  await dragBelow(page, "column", "gate");
  await expect(card(page, "column")).toHaveClass(/dragging/);
  await expect(card(page, "steps")).toHaveClass(/drop-before/);
  await page.mouse.up();
  await expect
    .poll(() => order(page))
    .toEqual(["gate", "column", "steps", added]);
  expect(await revision(page)).toBe(beforeDrag + 1);
  await expect(page.locator("#tree-body .dragging")).toHaveCount(0);
  // A drag selects nothing and drops nothing of the selection.
  expect(await selected(page)).toBe(`station:${added}`);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);

  // Escape drops a drag, writing nothing.
  await dragBelow(page, "column", "steps");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await order(page)).toEqual(["column", "gate", "steps", added]);
  expect(await selected(page)).toBe(`station:${added}`);

  // The inspector's Earlier and Later: the keyboard's way.
  const earlier = page.locator('#inspector-body [data-act="earlier"]');
  const later = page.locator('#inspector-body [data-act="later"]');
  await expect(later).toBeDisabled();
  await earlier.click();
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", added, "steps"]);
  await expect(page.locator("#inspector-body .sub")).toHaveText(
    "Station 3 of 4",
  );
  // Said to a screen reader, which hears no move otherwise.
  await expect(page.locator("#shell-said")).toHaveText("Now Station 3 of 4");
  await expect(later).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => order(page))
    .toEqual(["column", "gate", "steps", added]);

  // The inspector's Delete: asked once, then one step, its Undo in the
  // toast.
  /** @type {string[]} */
  const asked = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await page.locator('#inspector-body [data-act="delete"]').click();
  await expect.poll(() => order(page)).toEqual(["column", "gate", "steps"]);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(
    /^Delete the station ".+"\? It has no content\. You can undo this\.$/,
  );
  expect(await selected(page)).toBeNull();
  // The focus does not fall to the page: it goes to the card now in the
  // deleted station's place (at the end, the one before it).
  await expect(card(page, "steps").locator(".pick")).toBeFocused();
  await page
    .locator(".toast", { hasText: "Deleted" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
});

test("a row's + adds a short or a long text in place, from the mouse and from the keyboard, each one step to undo", async ({
  page,
}) => {
  // Why: the explorer adds where the creator is looking - the station's
  // own row - and says what it added only once it is in the tour. The
  // focus must come back to the row's "+" after the add redraws the tree,
  // or a keyboard user is dropped out of it after every add; the type
  // menu's Escape must stop there and keep the selection.
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  /** @returns {Promise<any[]>} */
  const gateBlocks = async () =>
    stationBlocks(
      (await tourNow(page)).stations.find(
        (/** @type {any} */ s) => s.id === "gate",
      ),
    );
  const before = (await gateBlocks()).length;
  const start = await revision(page);
  const gate = card(page, "gate");
  const plus = gate.locator(".head .add");
  const menu = page.locator("#tree-add-menu");

  // The mouse: the "+" shows under the pointer and opens the type menu.
  await gate.locator(".head").hover();
  await plus.click();
  await expect(menu).toBeVisible();
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  await expect(menu.locator('[data-kind="shortText"]')).toBeFocused();
  // A video plays only in a story: off on a station's menu.
  await expect(menu.locator('[data-kind="video"]')).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await menu.locator('[data-kind="longText"]').click();
  await expect(menu).toBeHidden();
  await expect(
    page.locator(".toast", { hasText: 'Added a long text to "' }),
  ).toBeVisible();
  expect(await revision(page)).toBe(start + 1);
  const blocks = await gateBlocks();
  expect(blocks.length).toBe(before + 1);
  const chosen = await selected(page);
  const text = blocks.find((/** @type {any} */ b) => b.id === chosen);
  expect(text?.kind).toBe("longText");
  await expect(gate.locator(".head .add")).toBeFocused();
  await expect(gate.locator(`.kid[data-select="${text.id}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The keyboard: Enter on the "+", Escape back to it, then a short text.
  await page.keyboard.press("Enter");
  await expect(menu.locator('[data-kind="shortText"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(gate.locator(".head .add")).toBeFocused();
  expect(await selected(page)).toBe(text.id);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".toast", { hasText: 'Added a pin to "' }),
  ).toBeVisible();
  expect(await revision(page)).toBe(start + 2);
  expect((await gateBlocks()).length).toBe(before + 2);
  await expect(gate.locator(".head .add")).toBeFocused();

  // Each add is one step.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await gateBlocks()).length).toBe(before + 1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await gateBlocks()).length).toBe(before);
});

test("a story is a folder of the tree: added, named, filled, its entry's texts shown, deleted and undone", async ({
  page,
}) => {
  // Why: a story stopped being a hidden part of its station. Only the page
  // shows the row's "+", the type menu, the inspector's name, the folder
  // and the delete's question working together, each edit one step of the
  // history.
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  /** @returns {Promise<any[]>} */
  const stories = async () =>
    (await tourNow(page)).stations
      .find((/** @type {any} */ s) => s.id === "gate")
      .children.filter((/** @type {any} */ c) => c.role === "story");
  const before = (await stories()).length;
  const start = await revision(page);
  const gate = card(page, "gate");
  const menu = page.locator("#tree-add-menu");
  const inspector = page.locator("#shell-inspector");

  // Add: the Story item of the station's menu; the name is ready to type.
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  await menu.locator('[data-kind="story"]').click();
  await expect(menu).toBeHidden();
  await expect(
    page.locator(".toast", { hasText: "Added a story to" }),
  ).toBeVisible();
  const name = inspector.locator('[data-field="story-title"]');
  await expect(name).toBeFocused();
  expect((await stories()).length).toBe(before + 1);
  const chosen = await selected(page);
  const id = chosen.slice("story:".length);
  const made = () =>
    stories().then((all) => all.find((/** @type {any} */ s) => s.id === id));
  expect(await made()).toBeDefined();
  expect(await revision(page)).toBe(start + 1);
  await expect(inspector.locator(".kids")).toHaveCount(0);

  // Rename, in the inspector's head; the folder follows.
  await name.fill("The legend");
  await name.press("Enter");
  const folder = gate.locator(`.folder[data-story="${id}"]`);
  await expect(folder.locator(".nm")).toHaveText("The legend");
  await expect(folder.locator(".meta")).toHaveText("0");
  expect(await revision(page)).toBe(start + 2);

  // Fill: the story's "+" adds into it, and the menu says so.
  await folder.locator(".add").click();
  await expect(menu).toHaveAttribute(
    "aria-label",
    'Add to the story "The legend"',
  );
  await expect(menu.locator('[data-kind="story"]')).toBeHidden();
  await menu.locator('[data-kind="longText"]').click();
  await expect(
    page.locator(".toast", { hasText: 'to the story "The legend"' }),
  ).toBeVisible();
  await expect(folder.locator(".meta")).toHaveText("1");
  const entry = (await made()).children[0];
  expect(await selected(page)).toBe(entry.id);
  const row = gate.locator(`.kid[data-select="${entry.id}"]`);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".meta")).toHaveText("1");
  expect(await revision(page)).toBe(start + 3);

  // A story block's texts are in its own inspector.
  await expect(inspector.locator(".sub")).toContainText(
    "/ The legend / Long text, entry 1",
  );
  await expect(
    inspector.locator(`[data-field="block:${entry.id}:title"]`),
  ).toHaveValue("New long text 1");
  await expect(
    inspector.locator(`[data-field="block:${entry.id}:body"]`),
  ).toHaveValue("Write the text here.");
  await expect(
    inspector.locator('[data-act="entry-advance:' + entry.id + ':tap"]'),
  ).toHaveAttribute("aria-pressed", "true");

  // Delete: the question names what goes; Undo brings the story back whole.
  await gate.locator(`.fname[data-select="story:${id}"]`).click();
  await expect.poll(() => selected(page)).toBe(`story:${id}`);
  /** @type {string[]} */
  const asked = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await inspector.locator('[data-act="delete"]').click();
  await expect.poll(async () => (await stories()).length).toBe(before);
  expect(asked).toEqual([
    'Delete the story "The legend"? Its entry goes with it. You can undo this.',
  ]);
  expect(await selected(page)).toBeNull();
  await page.locator(".toast button", { hasText: "Undo" }).click();
  await expect.poll(async () => (await stories()).length).toBe(before + 1);
  expect((await made()).children.map((/** @type {any} */ c) => c.id)).toEqual([
    entry.id,
  ]);
});

test("a story's folder sits a step in from its station and its entries a step further, at a phone and a desktop", async ({
  page,
}) => {
  // Why: the explorer was chosen for its one-line rows and its plain
  // indents. Presence would pass a folder set flush with the station, or
  // entries as tall as cards, so this pins positions, heights and gaps.
  test.slow();
  await answerHosts(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  const gate = card(page, "gate");
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  await page.locator('#tree-add-menu [data-kind="story"]').click();
  const id = (await selected(page)).slice("story:".length);
  const folder = `.folder[data-story="${id}"]`;
  for (const _ of [1, 2]) {
    await page.locator(`${folder} .add`).click();
    await page.locator('#tree-add-menu [data-kind="shortText"]').click();
  }
  await expect(page.locator(`${folder} ~ .kid.deep`)).toHaveCount(2);
  const sels = [
    folder,
    `${folder} .tw`,
    `${folder} .ic`,
    `${folder} ~ .kid.deep`,
    `${folder} ~ .kid.deep .ic`,
    '.card[data-station="gate"] .head',
    '.card[data-station="gate"] .head .tw',
  ];
  /** @param {number} rowH */
  const pinned = async (rowH) => {
    const l = await layoutOf(page, sels);
    const row = boxIn(l, sels[0]);
    const arrow = boxIn(l, sels[1]);
    const icon = boxIn(l, sels[2]);
    const first = boxIn(l, sels[3], 0);
    const second = boxIn(l, sels[3], 1);
    const entryIcon = boxIn(l, sels[4], 0);
    expect(row.height).toBe(rowH);
    expect(first.height).toBe(rowH);
    expect(second.height).toBe(rowH);
    // Rows touch: one line after the other, no gap between entries.
    expect(second.y).toBeCloseTo(first.y + first.height, 0);
    // The first entry starts where its folder's row ends.
    expect(first.y).toBeCloseTo(row.y + row.height, 0);
    // The folder's arrow a step in from its station's arrow.
    expect(arrow.x - boxIn(l, sels[6]).x).toBeCloseTo(16, 0);
    // An indent of 16 px per level, as the prototype's rows.
    expect(entryIcon.x - icon.x).toBeCloseTo(16, 0);
    expect(icon.x - (arrow.x + arrow.width)).toBeCloseTo(4, 0);
    expect(boxIn(l, sels[5]).x).toBe(row.x);
  };
  await pinned(26);
  // The folders work in the phone's list sheet, its rows finger-sized.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#shell-inspector [data-act="close"]').click();
  await page.locator("#studio-list").click();
  await expect(page.locator(folder)).toBeVisible();
  await pinned(32);
});

test("Ctrl+K adds a kind to a place named in one query, and leaves the long-text writer's Ctrl+K alone", async ({
  page,
}) => {
  // Why: the palette is the keyboard's way to add anything anywhere; a
  // query naming a kind and a station must add exactly that, said once
  // it is in the tour. Chrome's own Ctrl+K must not run instead, and in a
  // field the key stays the field's.
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  const blocksOf = async (/** @type {string} */ id) =>
    stationBlocks(
      (await tourNow(page)).stations.find(
        (/** @type {any} */ s) => s.id === id,
      ),
    );
  const before = (await blocksOf("steps")).length;
  const start = await revision(page);
  const palette = page.locator("#add-palette");
  await page.locator("#tree-add").focus();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await expect(page.locator("#add-palette-input")).toBeFocused();
  await page.keyboard.type("long steps");
  await expect(palette.locator('[role="option"]').first()).toContainText(
    "Long text",
  );
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(
    page.locator(".toast", { hasText: 'Added a long text to "' }),
  ).toBeVisible();
  expect(await revision(page)).toBe(start + 1);
  expect((await blocksOf("steps")).length).toBe(before + 1);
  // Escape closes it and keeps the selection.
  const chosen = await selected(page);
  await page.locator("#tree-add").focus();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  expect(await selected(page)).toBe(chosen);
  // In the tree's search too (a line field has no Ctrl+K of its own):
  // the palette, and the browser's own Ctrl+K never runs.
  await page.locator("#tree-search").focus();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  // The top bar's Add, for a screen with no keyboard.
  await page.locator("#studio-add").click();
  await expect(palette).toBeVisible();
  await expect(page.locator("#add-palette-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("New station here: a right click on the ground starts a station where it was pressed", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 20);
  const canvas = await box(page.locator("#view3d canvas"));
  const at = { x: canvas.x + canvas.width / 2 + 60, y: canvas.y + 300 };
  const menu = page.locator("#scene-menu");
  const item = page.locator("#scene-new-station");

  // Escape closes it, writing nothing.
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(menu).toBeVisible();
  await expect(item).toBeFocused();
  // It opens where the pointer was: the canvas starts right of the tree.
  const opened = await box(menu);
  expect(Math.abs(opened.x - at.x)).toBeLessThan(2);
  expect(Math.abs(opened.y - at.y)).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect((await order(page)).length).toBe(3);

  // A right drag pans the camera: no menu after it.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(at.x + 80, at.y + 10, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(menu).toBeHidden();

  // A right click without a move: the station where it was pressed. Once
  // the pan has stopped coasting: the station is placed under the pixel
  // pressed, and compared with it after the camera moved no further.
  await cameraSettled(page, `station:${(await order(page))[0] ?? ""}`);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await item.click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  expect(await selected(page)).toBe(`station:${added}`);
  await expect(
    page.locator(".toast", { hasText: 'Added "Station 4" here' }),
  ).toBeVisible();
  await afterFrames(page, 3);
  const screen = await page.evaluate(
    (id) => /** @type {any} */ (window).__tourEditor.view3dScreenOf(id),
    `station:${added}`,
  );
  // The new station's details opened beside the view, and the canvas
  // covers only the view between the docks: narrower, at the same height.
  // A point keeps its offset from the canvas's middle (the field of view
  // is vertical), so the pressed pixel is found from the middle.
  const now = await box(page.locator("#view3d canvas"));
  const pressed = [
    now.width / 2 + (at.x - (canvas.x + canvas.width / 2)),
    now.height / 2 + (at.y - (canvas.y + canvas.height / 2)),
  ];
  expect(Math.abs(screen[0] - pressed[0])).toBeLessThan(4);
  expect(Math.abs(screen[1] - pressed[1])).toBeLessThan(4);
  // On the ground: its height is the drawn ground's.
  const tour = await tourNow(page);
  expect(tour.stations[3].geo.alt).toBeCloseTo(SQUARE_GROUND_M + N_M, 0);
});

/**
 * A tour of one station with a photo (a real JPEG the browser made), as a
 * zip.
 * @param {import("@playwright/test").Page} page
 */
async function photoTour(page) {
  const jpeg = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(8, 6);
    const g = canvas.getContext("2d");
    if (g === null) throw new Error("no 2d context");
    g.fillStyle = "#c85";
    g.fillRect(0, 0, 8, 6);
    const blob = await canvas.convertToBlob({ type: "image/jpeg" });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const geo = {
    lat: 48.13725,
    lon: 11.57549,
    alt: SQUARE_GROUND_M + N_M,
    headingDeg: 0,
  };
  const manifest = {
    ...createEmptyTourManifest(),
    title: "One photo",
    assets: [{ id: "shot", path: "content/shot.jpg", width: 8, height: 6 }],
    stations: [
      {
        id: "fountain",
        title: "The fountain",
        geo,
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        children: [
          {
            id: "shot",
            kind: "picture",
            view: "plane",
            image: "shot",
            widthM: 1,
            createdAtIso: "2026-10-25T09:00:00.000Z",
            pose: { position: [3, 1.5, 0], rotation: [0, 0, 0, 1] },
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
    "content/shot.jpg",
    new Uint8ArrayReader(new Uint8Array(jpeg)),
  );
  return { zip: Buffer.from(await writer.close()), jpeg };
}

/**
 * Each entry of a zip, as bytes.
 * @param {Buffer} zip
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function entries(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zip)));
  const out = new Map();
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
  return out;
}

test("a station copied with its photo is saved with a picture of its own, and opens again with it", async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  // On the context: the page opened again later has no pickers either.
  await context.addInitScript(() => {
    // The file input opens it, and the save goes to a download.
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const { zip, jpeg } = await photoTour(page);
  await openZip(page, zip, "one-photo.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(card(page, "fountain")).toBeVisible();
  await card(page, "fountain").locator(".pick").click();
  expect(await selected(page)).toBe("station:fountain");

  // The bottom bar's Duplicate: the copy beside it, selected, said.
  await page.locator('#shell-acts [data-bar="duplicate"]').click();
  await expect.poll(async () => (await order(page)).length).toBe(2);
  const copy = (await order(page))[1] ?? "";
  expect(await selected(page)).toBe(`station:${copy}`);
  await expect(
    page.locator(".toast", { hasText: "Duplicated The fountain" }),
  ).toBeVisible();
  await expect(
    page.locator("#shell-inspector [data-act='lock']"),
  ).toHaveAttribute("aria-pressed", "false");

  const download = page.waitForEvent("download");
  await save(page);
  const saved = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const files = await entries(readFileSync(saved));
  const written = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  expect(written.stations).toHaveLength(2);
  const pictures = written.stations.map(
    (/** @type {any} */ s) =>
      written.assets.find(
        (/** @type {any} */ a) => a.id === stationBlocks(s)[0]?.image,
      )?.path,
  );
  // Two photos, two pictures: the copy's is its own file, the same bytes.
  expect(new Set(pictures).size).toBe(2);
  for (const path of pictures) {
    expect([...(files.get(path) ?? [])]).toEqual(jpeg);
  }

  // Opened again: both cards, each with its picture. The saving page goes
  // first: two pages of the editor would share one machine's budget.
  await page.close();
  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, readFileSync(saved), "one-photo.zip");
  await expect(next.locator("#tree-body .card")).toHaveCount(2, {
    timeout: 60_000,
  });
  // An unfolded station shows its picture under its row.
  for (const each of await next.locator("#tree-body .card").all()) {
    const fold = each.locator(".head .tw");
    if ((await fold.getAttribute("aria-expanded")) !== "true") {
      await fold.click();
    }
    const pic = each.locator(".pic");
    await expect(pic).toBeVisible();
    await expect
      .poll(() => pic.evaluate((el) => getComputedStyle(el).backgroundImage), {
        timeout: 30_000,
      })
      .toMatch(/^url\(/);
  }
  // Nothing of the photos was lost on the way: a reader of the file
  // finds every picture it names.
  const reread = await entries(readFileSync(saved));
  for (const path of pictures) expect(reread.has(path)).toBe(true);
  const names = await new ZipReader(
    new Uint8ArrayReader(new Uint8Array(readFileSync(saved))),
  ).getEntries();
  const tourJson = names.find((e) => e.filename === "tour.json");
  expect(await tourJson?.getData(new TextWriter())).toContain(copy);
});

test("a long text added in place is saved and opens again as it was made", async ({
  page,
  context,
}) => {
  // Why: the new long text must be one the file keeps - its kind, its
  // title, its body and its station - and that the next open lists, or
  // the add makes something a save loses.
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const { zip } = await photoTour(page);
  await openZip(page, zip, "one-photo.zip");
  await expect(card(page, "fountain")).toBeVisible({ timeout: 60_000 });
  await card(page, "fountain").locator(".head .add").click();
  await page.locator('#tree-add-menu [data-kind="longText"]').click();
  await expect(
    page.locator(".toast", { hasText: 'Added a long text to "' }),
  ).toBeVisible();
  const made = await selected(page);

  const download = page.waitForEvent("download");
  await save(page);
  const saved = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const files = await entries(readFileSync(saved));
  const written = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  const block = stationBlocks(written.stations[0]).find(
    (/** @type {any} */ b) => b.id === made,
  );
  expect(block).toMatchObject({
    kind: "longText",
    title: "New long text 1",
    body: "Write the text here.",
  });

  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, readFileSync(saved), "one-photo.zip");
  const again = card(next, "fountain");
  await expect(again).toBeVisible({ timeout: 60_000 });
  const fold = again.locator(".head .tw");
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await expect(
    again.locator(`[data-select="${made}"]`, { hasText: "New long text 1" }),
  ).toBeVisible();
});

/**
 * The tree's head and a card's grip, and the bottom bar's actions, at one
 * window size: placed by the prototype's measures.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectTreeControls(page, size) {
  const at = `at ${String(size.width)}x${String(size.height)}`;
  // Read in one go (`layoutOf`): each read through Playwright waits on
  // the software-drawn 3D view.
  const l = await layoutOf(page, [
    "#shell-tree .dhead",
    "#tree-add",
    "#tree-fold",
    "#tree-body .card > .head",
    "#tree-body .grip",
    "#tree-body .head .tw",
    "#tree-body .head .n",
  ]);
  const head = boxIn(l, "#shell-tree .dhead");
  const add = boxIn(l, "#tree-add");
  const fold = boxIn(l, "#tree-fold");
  // "+" is a 26 px icon button beside the fold arrow, 6 px from it, in
  // line with it, inside the head (whose box takes a 1 px line at its foot
  // when unfolded, so its own middle is half a pixel low).
  expect(add.width, at).toBe(26);
  expect(add.height, at).toBe(26);
  expect(fold.x - (add.x + add.width), at).toBe(6);
  expect(add.y, at).toBe(fold.y);
  expect(add.height, at).toBe(fold.height);
  expect(add.y, at).toBeGreaterThanOrEqual(head.y);
  expect(add.y + add.height, at).toBeLessThanOrEqual(head.y + head.height);
  // A card's grip: first in its row (4 px in), then its fold arrow 4 px
  // after it, then the number badge, as the explorer's rows.
  const row = boxIn(l, "#tree-body .card > .head", 0);
  const grip = boxIn(l, "#tree-body .grip", 0);
  const tw = boxIn(l, "#tree-body .head .tw", 0);
  const n = boxIn(l, "#tree-body .head .n", 0);
  expect(grip.x - row.x, at).toBe(4);
  expect(tw.x - (grip.x + grip.width), at).toBe(4);
  expect(n.x, at).toBeGreaterThanOrEqual(tw.x + tw.width + 4);
  expect(grip.y, at).toBe(tw.y);
  expect(grip.height, at).toBe(tw.height);
  expect(grip.y + grip.height, at).toBeLessThanOrEqual(row.y + row.height);
  // The tree: 248 px wide on a desktop, 210 px at 1100 px or less, as the
  // explorer's, 226 px at 900 px or less and the width on a phone; its
  // search 8 px in, to the dock's line (a phone's sheet has none).
  const tree = await box(page.locator("#shell-tree"));
  const phone = size.width <= 700;
  const treePx =
    size.width > 1100
      ? 248
      : size.width > 900
        ? 210
        : size.width > 700
          ? 226
          : size.width;
  expect(tree.width, at).toBe(treePx);
  const search = await box(page.locator("#tree-search"));
  expect(search.x - tree.x, at).toBe(8);
  expect(tree.x + tree.width - (search.x + search.width), at).toBe(
    phone ? 8 : 9,
  );
  // A row's "+": 22 px, 4 px from the row's right end, in its middle.
  const plus = await box(page.locator("#tree-body .card > .head .add").first());
  expect([plus.width, plus.height], at).toEqual([22, 22]);
  expect(row.x + row.width - (plus.x + plus.width), at).toBe(4);
  expect(
    Math.abs(plus.y + plus.height / 2 - (row.y + row.height / 2)),
    at,
  ).toBeLessThanOrEqual(0.5);
  // The keys' foot: at the tree's bottom, its keys outlined, not filled;
  // none on a phone or a low window, where the space is the rows'.
  const foot = page.locator("#tree-foot");
  if (size.width <= 700 || size.height <= 560) {
    await expect(foot, at).toBeHidden();
    return;
  }
  const f = await box(foot);
  expect(f.y + f.height, at).toBeCloseTo(tree.y + tree.height, 0);
  expect(f.x, at).toBe(tree.x);
  expect(
    await foot
      .locator("kbd")
      .first()
      .evaluate((k) => getComputedStyle(k).backgroundColor),
    at,
  ).toBe("rgba(0, 0, 0, 0)");
}

/**
 * A tour of three stations a, b and c along the square, each with a pin
 * (pa, pb, pc), as a zip.
 */
async function threePinTour() {
  const station = (/** @type {string} */ id, /** @type {number} */ dLat) => ({
    id,
    title: `Station ${id.toUpperCase()}`,
    geo: {
      lat: 48.13725 + dLat,
      lon: 11.57549,
      alt: SQUARE_GROUND_M + N_M,
      headingDeg: 0,
    },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    children: [
      {
        id: `p${id}`,
        kind: "shortText",
        view: "pin",
        caption: `Pin ${id}`,
        createdAtIso: "2026-10-25T09:00:00.000Z",
        pose: { position: [2, 1.5, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  });
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Three pins",
    // Its own id: a file without one is given a new id at every open.
    tourId: "0123456789abcdef0123456789abcdef",
    stations: [station("a", 0), station("b", 0.0002), station("c", 0.0004)],
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(/** @type {any} */ (manifest))),
  );
  return Buffer.from(await writer.close());
}

// Why: the tree's commands each write the draft, and a reload must give
// the same tour back - a station added here (untitled, holding nothing),
// the order changed, an item split off into a station right after its
// own, a station deleted with its route. Each piece has unit tests
// against the reducer; only the page shows the session, the autosave and
// the restore agreeing on all of them at once.
test("add, reorder, split and delete come back whole from the draft after a reload", async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const zip = await threePinTour();
  await openZip(page, zip, "three-pins.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect.poll(() => order(page)).toEqual(["a", "b", "c"]);

  // Add: a station at the view's centre, selected; then one place earlier.
  await page.locator("#tree-add").click();
  await expect.poll(async () => (await order(page)).length).toBe(4);
  const added = (await order(page))[3] ?? "";
  await page.locator('#inspector-body [data-act="earlier"]').click();
  await expect.poll(() => order(page)).toEqual(["a", "b", added, "c"]);

  // Split: b's pin into a station of its own, right after b.
  await card(page, "b").locator(".head .tw").click();
  await card(page, "b").locator('[data-select="pb"]').click();
  await page.locator('#inspector-body [data-act="split"]').click();
  await expect.poll(async () => (await order(page)).length).toBe(5);
  const split = (await order(page))[2] ?? "";
  expect(["a", "b", added, "c"]).not.toContain(split);
  expect(await order(page)).toEqual(["a", "b", split, added, "c"]);

  // Delete: station a with its pin.
  await card(page, "a").locator(".pick").click();
  /** @type {string[]} */
  const asked = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await page.locator('#inspector-body [data-act="delete"]').click();
  await expect
    .poll(() => asked)
    .toEqual([
      expect.stringMatching(
        /^Delete the station ".+"\? Its item goes with it: 1 free item\. You can undo this\.$/,
      ),
    ]);
  await expect.poll(() => order(page)).toEqual(["b", split, added, "c"]);

  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  const before = await tourNow(page);
  await page.close();

  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, zip, "three-pins.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect.poll(() => order(next)).toEqual(["b", split, added, "c"]);
  expect(await tourNow(next)).toEqual(before);
});

/**
 * Whether the bar's first action shows its words.
 * @param {Record<string, import("./editor3d-fixture.js").LaidOut[]>} l
 */
function shownWords(l) {
  return l["#shell-acts .sact .lbl"]?.[0]?.shown === true;
}

/** @param {{ width: number, height: number }} size */
function atSize(size) {
  return `at ${String(size.width)}x${String(size.height)}`;
}

test("a station's picture is a strip under its row, and a tap on it selects the station, on a desktop and a phone", async ({
  page,
}) => {
  // Why: the strip starts with the station's first picture, and at a
  // phone's width it is the largest thing to tap in the row.
  test.slow();
  await page.addInitScript(() => {
    // The file input opens the tour.
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const { zip } = await photoTour(page);
  await openZip(page, zip, "one-photo.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    const at = atSize(size);
    const fountain = card(page, "fountain");
    await expect(fountain).toBeVisible();
    const strip = fountain.locator(".pic");
    if ((await strip.count()) === 0)
      await fountain.locator(".head .tw").click();
    await expect(strip, at).toBeVisible();
    await expect
      .poll(() => strip.evaluate((e) => getComputedStyle(e).backgroundImage))
      .toContain("url(");
    const row = await box(fountain.locator("> .head"));
    const shown = await box(strip);
    expect(shown.y, at).toBeGreaterThanOrEqual(row.y + row.height);
    expect(shown.height, at).toBe(54);
    expect(shown.x, at).toBe(row.x + 54);
    expect(row.x + row.width - (shown.x + shown.width), at).toBe(8);
    await page.screenshot({
      path: test.info().outputPath(`strip-${String(size.width)}.png`),
    });
    await strip.click();
    expect(await selected(page), at).toBe("station:fountain");
    await page.keyboard.press("Escape");
    await expect(page.locator("#shell-inspector"), at).toBeHidden();
  }
});

test("the tree's add, its grips and the bar's actions sit in place at a phone, a phone in landscape, a tablet and a desktop", async ({
  page,
}) => {
  test.slow();
  await useWideFont(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  // The inspector's Delete names its key as the prototype does: dim
  // letters in the row, not a keycap.
  await card(page, "gate").locator(".pick").click();
  const del = page.locator('#inspector-body [data-act="delete"] kbd');
  await expect(del).toHaveText("Del");
  // Polled: the inspector is drawn again whenever its model changes after
  // the click, and a key read from a replaced draw has no style ("").
  await expect
    .poll(() =>
      del.evaluate((k) => {
        const s = getComputedStyle(k);
        return { background: s.backgroundColor, border: s.borderTopWidth };
      }),
    )
    .toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
  await page.keyboard.press("Escape");
  for (const size of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    if (
      await page
        .locator("#shell-tree")
        .evaluate((t) => t.classList.contains("collapsed"))
    ) {
      await page.locator("#tree-fold").click();
    }
    await expectTreeControls(page, size);
    // The bar's actions follow the credits, inside the bar and left of
    // the panel's toggles, each a button with its words (shown, or its
    // name where they fold away).
    await card(page, "gate").locator(".pick").click();
    const acts = page.locator("#shell-acts .sact");
    await expect(acts).toHaveCount(2);
    const l = await layoutOf(page, [
      "#shell-bar",
      "#view3d-credits",
      "#shell-toggles",
      "#shell-tree",
      "#shell-inspector",
      "#shell-shelf",
      "#shell-acts .sact",
      "#shell-acts .sact .lbl",
    ]);
    // A station selected on a desktop: the tree keeps its width beside
    // the inspector, which stands against the Assets panel, open at the
    // window's right edge.
    if (size.width > 1100) {
      const tree = boxIn(l, "#shell-tree");
      const inspector = boxIn(l, "#shell-inspector");
      const shelf = boxIn(l, "#shell-shelf");
      expect(tree.width).toBe(248);
      expect(shelf.x + shelf.width).toBe(size.width);
      expect(inspector.x + inspector.width).toBe(shelf.x);
      expect(inspector.x).toBeGreaterThanOrEqual(tree.x + tree.width);
    }
    const bar = boxIn(l, "#shell-bar");
    const credits = boxIn(l, "#view3d-credits");
    const toggles = boxIn(l, "#shell-toggles");
    const first = boxIn(l, "#shell-acts .sact", 0);
    expect(first.x).toBeGreaterThanOrEqual(credits.x + credits.width);
    for (const [i] of (l["#shell-acts .sact"] ?? []).entries()) {
      const b = boxIn(l, "#shell-acts .sact", i);
      expect(b.x + b.width).toBeLessThanOrEqual(toggles.x);
      expect(b.y).toBeGreaterThanOrEqual(bar.y);
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height);
    }
    // Each a button with its words: its name, else its text.
    expect(
      await acts.evaluateAll((all) =>
        all.map((a) => a.getAttribute("aria-label") ?? a.textContent),
      ),
    ).not.toContain("");
    expect(shownWords(l), atSize(size)).toBe(size.width > 820);
    // Deselected: the bar has no actions to show.
    await page.keyboard.press("Escape");
    await expect(acts).toHaveCount(0);
  }
});

/** A station name far longer than any dock is wide, with spaces to wrap at. */
const LONG_NAME = `The long station name ${"that goes on past the edge of the list ".repeat(4).trim()}`;

/**
 * A tour of three stations for the rows: "A" with a photo, one with
 * `LONG_NAME` and "The town hall steps", both without, as a zip.
 * @param {import("@playwright/test").Page} page
 */
async function rowsTour(page) {
  const { zip } = await photoTour(page);
  const files = await entries(zip);
  const manifest = JSON.parse(
    new TextDecoder().decode(files.get("tour.json") ?? new Uint8Array()),
  );
  const [photo] = manifest.stations;
  const plain = (/** @type {string} */ id, /** @type {string} */ title) => ({
    ...photo,
    id,
    title,
    geo: { ...photo.geo, lat: photo.geo.lat + 0.0003 },
    children: [],
  });
  manifest.stations = [
    { ...photo, id: "short", title: "A" },
    plain("long", LONG_NAME),
    plain("plain", "The town hall steps"),
  ];
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(manifest)),
  );
  await writer.add(
    "content/shot.jpg",
    new Uint8ArrayReader(files.get("content/shot.jpg") ?? new Uint8Array()),
  );
  return Buffer.from(await writer.close());
}

// Why: a station in the list was a 62 px picture card with its number
// above its name, the name wrapping under the number - a strange minimum
// height for a list a creator scans. A folded station is now ONE line:
// its number chip, its name beside it (cut with an ellipsis, the full
// name in the row's title), its grip and fold arrow; only an unfolded
// station shows its picture - when it has one, no empty frame when not -
// and its items. Checked for a one-letter, a medium and a very long name,
// at a phone, a phone in landscape and a desktop.
test("a folded station is one line, its number and name side by side; unfolded it shows its picture only when it has one", async ({
  page,
}) => {
  // Three viewports, each folding and unfolding three rows on a
  // software-drawn 3D view: past the 90 s of a slow test (measured 2026-11-03).
  test.setTimeout(240_000);
  await useWideFont(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The file input opens the tour (no picker in this browser).
  await page.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, await rowsTour(page), "rows.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(card(page, "short")).toBeVisible();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    const at = `at ${String(size.width)}x${String(size.height)}`;
    const name = `${String(size.width)}x${String(size.height)}`;
    await page.setViewportSize(size);
    if (
      await page
        .locator("#shell-tree")
        .evaluate((t) => t.classList.contains("collapsed"))
    ) {
      await page.locator("#tree-fold").click();
    }
    // A phone's rows take a finger: 34 px, 28 px elsewhere.
    const rowPx = size.width <= 700 ? 34 : 28;
    // The three rows read in one go (`layoutOf`): each read through
    // Playwright waits on the software-drawn 3D view.
    const ids = ["short", "long", "plain"];
    const cardOf = (/** @type {string} */ id) =>
      `#tree-body .card[data-station="${id}"]`;
    // A folded card's picture, story and items: none of them.
    const extras = (/** @type {string} */ id) =>
      [".pic", ".ds", ".kids"].map((p) => `${cardOf(id)} ${p}`).join(", ");
    const PARTS = [".head", ".head .n", ".head .nm", ".head .grip"];
    PARTS.push(".head .tw", ".head .pick", ".head .add");
    const rows = await layoutOf(
      page,
      ids.flatMap((id) => [
        extras(id),
        ...PARTS.map((p) => `${cardOf(id)} ${p}`),
      ]),
    );
    for (const id of ids) {
      const c = cardOf(id);
      expect(rows[extras(id)]?.length, `${id} ${at}`).toBe(0);
      const row = boxIn(rows, `${c} .head`);
      const n = boxIn(rows, `${c} .head .n`);
      const nm = boxIn(rows, `${c} .head .nm`);
      const grip = boxIn(rows, `${c} .head .grip`);
      const arrow = boxIn(rows, `${c} .head .tw`);
      const pick = boxIn(rows, `${c} .head .pick`);
      expect(row.height, `${id} ${at}`).toBeCloseTo(rowPx, 0);
      // The row's frame, the explorer's: the grip 4 px in from the row's
      // left, the fold arrow 4 px after it, centred on the row's middle;
      // the button fills the row's height from 4 px after the arrow, and
      // the row ends 4 px after its last piece (its "+"). Without these
      // the pieces could all move together and still pass the relative
      // checks below.
      expect(grip.x - row.x, `${id} ${at}`).toBeCloseTo(4, 0);
      expect(arrow.x - (grip.x + grip.width), `${id} ${at}`).toBeCloseTo(4, 0);
      expect(pick.height, `${id} ${at}`).toBeCloseTo(rowPx, 0);
      expect(pick.x - (arrow.x + arrow.width), `${id} ${at}`).toBeCloseTo(4, 0);
      const last = boxIn(rows, `${c} .head .add`);
      expect(
        Math.abs(row.x + row.width - (last.x + last.width) - 4),
        `${id} ${at}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(arrow.y + arrow.height / 2 - (row.y + row.height / 2)),
        `${id} ${at}`,
      ).toBeLessThanOrEqual(1);
      // Number and name on one line: their middles level, the name right
      // of the chip and left of the grip, one line of text high.
      expect(
        Math.abs(n.y + n.height / 2 - (nm.y + nm.height / 2)),
        `${id} ${at}`,
      ).toBeLessThanOrEqual(2);
      expect(nm.x, `${id} ${at}`).toBeGreaterThanOrEqual(n.x + n.width);
      expect(nm.x + nm.width, `${id} ${at}`).toBeLessThanOrEqual(
        pick.x + pick.width + 0.5,
      );
      expect(nm.height, `${id} ${at}`).toBeLessThan(20);
    }
    // The long name is cut with an ellipsis, not wrapped; the row's
    // button keeps the whole name.
    const long = card(page, "long");
    expect(
      await long.locator(".nm").evaluate((el) => ({
        cut: el.scrollWidth > el.clientWidth,
        overflow: getComputedStyle(el).textOverflow,
      })),
      at,
    ).toEqual({ cut: true, overflow: "ellipsis" });
    await expect(long.locator(".pick")).toHaveAttribute("title", LONG_NAME);
    await expect(long.locator(".pick")).toHaveAccessibleName(
      new RegExp(`${LONG_NAME}$`),
    );
    await capture(page, test.info().outputPath(`rows-folded-${name}.png`));

    // Unfolded: the picture under the row of the station that has one,
    // no picture for the one that has none; both list their items.
    await card(page, "short").locator(".head .tw").click();
    await card(page, "plain").locator(".head .tw").click();
    const pic = card(page, "short").locator(".pic");
    await expect(pic).toBeVisible();
    await expect
      .poll(() => pic.evaluate((el) => getComputedStyle(el).backgroundImage))
      .toMatch(/^url\(/);
    const short = await box(card(page, "short").locator(".head"));
    expect((await box(pic)).y, at).toBeGreaterThanOrEqual(
      short.y + short.height,
    );
    await expect(card(page, "short").locator(".kids")).toBeVisible();
    await expect(card(page, "plain").locator(".kids")).toBeVisible();
    await expect(card(page, "plain").locator(".pic")).toHaveCount(0);
    expect(
      (await box(card(page, "plain").locator(".head"))).height,
      at,
    ).toBeGreaterThanOrEqual(27.5);
    // Unfolded, a station is no longer one compact line: its long name
    // wraps (on a phone a folded name gets about 115 px), the arrow still
    // on the row's middle; folded again it is one line.
    await card(page, "long").locator(".head .tw").click();
    const longHead = card(page, "long").locator(".head");
    const longName = await box(longHead.locator(".nm"));
    expect(longName.height, at).toBeGreaterThan(25);
    const longRow = await box(longHead);
    expect(longRow.height, at).toBeGreaterThan(rowPx);
    const longArrow = await box(longHead.locator(".tw"));
    expect(
      Math.abs(
        longArrow.y + longArrow.height / 2 - (longRow.y + longRow.height / 2),
      ),
      at,
    ).toBeLessThanOrEqual(1);
    await card(page, "long").locator(".head .tw").click();
    await expect(card(page, "long").locator(".kids")).toHaveCount(0);
    expect((await box(longHead)).height, at).toBeCloseTo(rowPx, 0);
    await capture(page, test.info().outputPath(`rows-unfolded-${name}.png`));
    await card(page, "short").locator(".head .tw").click();
    await card(page, "plain").locator(".head .tw").click();
    await expect(page.locator("#tree-body .kids")).toHaveCount(0);
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  // Why: the grip is drawn 16 x 20 px, too small for a finger; on a touch
  // screen its hit area grows to 24 x 24 (WCAG's least target size) while
  // the drawn grip, and the layout pinned above, stay as they are.
  test("a card's grip takes a press anywhere in 24 x 24 px around it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await answerHosts(page);
    await openSampleIn3d(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    if (
      await page
        .locator("#shell-tree")
        .evaluate((t) => t.classList.contains("collapsed"))
    ) {
      await page.locator("#tree-fold").click();
    }
    const grip = page.locator('#tree-body [data-drag="gate"]');
    const b = await box(grip);
    expect([b.width, b.height]).toEqual([16, 20]);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    for (const [dx, dy] of [
      [-11.5, -11.5],
      [11.5, -11.5],
      [-11.5, 11.5],
      [11.5, 11.5],
    ]) {
      const hit = await page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x ?? 0, y ?? 0)
            ?.closest("[data-drag]")
            ?.getAttribute("data-drag") ?? null,
        [cx + (dx ?? 0), cy + (dy ?? 0)],
      );
      expect(hit, `${String(dx)}, ${String(dy)}`).toBe("gate");
    }
  });
});

// Why: a creator copies a story to make a variant of it. Only the page
// shows the tree's selection, the bar's Duplicate, the session, the toast
// and the draft agreeing: the copy right after its original, under new
// ids, one step, and back whole from the draft after a reload.
test("a story duplicated from the tree stands right after its original and comes back from the draft after a reload", async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const zip = readFileSync(
    new URL("../public/samples/marienplatz-tour.zip", import.meta.url),
  );
  await openZip(page, zip, "marienplatz-tour.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  /**
   * The gate's stories, as the tour holds them.
   * @param {import("@playwright/test").Page} p
   * @returns {Promise<any[]>}
   */
  const storiesOf = async (p) =>
    (await tourNow(p)).stations
      .find((/** @type {any} */ s) => s.id === "gate")
      .children.filter((/** @type {any} */ c) => c.role === "story");
  const before = await storiesOf(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  const original = before[0];
  const start = await revision(page);

  // Select the first story by its folder's name, unfolding the station
  // when it is folded.
  const gate = card(page, "gate");
  const name = gate.locator(`.fname[data-select="story:${original.id}"]`);
  if (!(await name.isVisible())) await gate.locator(".head .tw").click();
  await name.click();
  await expect.poll(() => selected(page)).toBe(`story:${original.id}`);

  await page.locator('#shell-acts [data-bar="duplicate"]').click();
  await expect(
    page.locator(".toast", {
      hasText: `Duplicated "${original.title} copy"`,
    }),
  ).toBeVisible();
  const after = await storiesOf(page);
  expect(after.map((/** @type {any} */ s) => s.id)).toEqual([
    original.id,
    expect.any(String),
    ...before.slice(1).map((/** @type {any} */ s) => s.id),
  ]);
  const copy = after[1];
  expect(copy.id).not.toBe(original.id);
  expect(copy.title).toBe(`${original.title} copy`);
  expect(copy.children.length).toBe(original.children.length);
  const originalIds = new Set(
    original.children.map((/** @type {any} */ c) => c.id),
  );
  expect(
    copy.children.filter((/** @type {any} */ c) => originalIds.has(c.id)),
  ).toEqual([]);
  expect(await selected(page)).toBe(`story:${copy.id}`);
  await expect(gate.locator(`.folder[data-story="${copy.id}"] .nm`)).toHaveText(
    copy.title,
  );
  expect(await revision(page)).toBe(start + 1);

  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  const saved = await tourNow(page);
  await page.close();

  const next = await context.newPage();
  await next.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(next);
  await next.goto("/edit.html?globe=0");
  await expect(next.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(next, zip, "marienplatz-tour.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect
    .poll(async () => (await storiesOf(next)).map((s) => s.id))
    .toEqual(after.map((/** @type {any} */ s) => s.id));
  // The sample carries no tour id, so each open mints its own: the rest
  // of the tour must come back as it was.
  const { tourId: _was, ...kept } = saved;
  const { tourId: _now, ...back } = await tourNow(next);
  expect(back).toEqual(kept);
});
