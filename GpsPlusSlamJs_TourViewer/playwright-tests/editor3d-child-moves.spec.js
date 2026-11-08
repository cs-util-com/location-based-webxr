// @ts-check
import { expect, test } from "@playwright/test";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { SQUARE_GROUND_M, answerHosts, openZip } from "./editor3d-fixture.js";

/**
 * Why these tests matter: a station's items are moved in the tree - a free
 * item into a story, an entry from one story to another, an entry out to
 * stand free - by the grip's drag, by the inspector's Earlier, Later and
 * Move buttons, and by a finger on a phone. Each move must be ONE step of
 * the history, keep the item selected, and a drag broken off with Escape
 * must write nothing. The move rule, the list maths and the drag each have
 * unit tests; only the page shows the tree's markup, the drag, the session
 * and the toasts agreeing.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/**
 * A tour of one station: two stories ("First" with two entries, "Second"
 * with one) and a free pin.
 * @returns {Promise<Buffer>}
 */
async function storiesTour() {
  const pose = { position: [2, 1.5, 0], rotation: [0, 0, 0, 1] };
  /** @param {string} id */
  const entry = (id) => ({
    id,
    kind: "shortText",
    view: "card",
    caption: `Entry ${id}`,
    pose,
    advance: { mode: "tap" },
  });
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Stories",
    // Its own id: a file without one is given a new id at every open.
    tourId: "0123456789abcdef0123456789abcdef",
    stations: [
      {
        id: "a",
        title: "Station A",
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
          {
            id: "s1",
            kind: "story",
            title: "First",
            children: [entry("e1"), entry("e2")],
          },
          { id: "s2", kind: "story", title: "Second", children: [entry("e3")] },
          {
            id: "pin",
            kind: "shortText",
            view: "pin",
            caption: "The pin",
            createdAtIso: "2026-10-25T09:00:00.000Z",
            pose,
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
  return Buffer.from(await writer.close());
}

/**
 * The station's lists as the tour holds them: each story's entry ids by
 * its id, and the free items' ids.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, string[]>>}
 */
function lists(page) {
  return page.evaluate(() => {
    const tour = /** @type {any} */ (window).__tourEditor.manifest();
    /** @type {Record<string, string[]>} */
    const out = { free: [] };
    for (const child of tour.stations[0].children) {
      if (child.kind === "story") {
        out[child.id] = child.children.map((/** @type {any} */ c) => c.id);
      } else out["free"]?.push(child.id);
    }
    return out;
  });
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

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/** @param {{ x: number, y: number, width: number, height: number }} b */
function middle(b) {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Open the stories tour in the editor's 3D view (no globe), its station
 * card and both stories unfolded.
 * @param {import("@playwright/test").Page} page
 */
async function openStories(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, await storiesTour(), "stories.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e1", "e2"],
      s2: ["e3"],
      free: ["pin"],
    });
}

/**
 * Unfold the station card and both stories, where folded.
 * @param {import("@playwright/test").Page} page
 */
async function unfold(page) {
  const card = page.locator('#tree-body .card[data-station="a"]');
  const s1 = card.locator('.folder[data-story="s1"]');
  if (!(await s1.isVisible())) await card.locator(".head .tw").click();
  await expect(s1).toBeVisible();
  for (const id of ["s1", "s2"]) {
    const folder = card.locator(`.folder[data-story="${id}"]`);
    const entries = id === "s1" ? "e1" : "e3";
    const row = card.locator(`.kid[data-select="${entries}"]`);
    if (!(await row.isVisible())) await folder.locator(".tw").click();
    await expect(row).toBeVisible();
  }
  return card;
}

/**
 * Drag item `id` by its grip to the point `to`, with the mouse; released
 * unless `hold`.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {{ x: number, y: number }} to
 * @param {boolean} [hold]
 */
async function drag(page, id, to, hold = false) {
  const row = page.locator(`#tree-body [data-item="${id}"]`);
  await row.hover();
  const from = middle(await box(row.locator(`[data-move="${id}"]`)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (!hold) await page.mouse.up();
}

test("the grip's drag moves a station's items between its stories and its free items, one step each, and Escape writes nothing", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStories(page);
  const card = await unfold(page);
  const start = await revision(page);

  // A free pin onto a story's row: it goes into that story, at its end.
  await drag(
    page,
    "pin",
    middle(await box(card.locator('.folder[data-story="s2"]'))),
  );
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e1", "e2"],
      s2: ["e3", "pin"],
      free: [],
    });
  expect(await revision(page)).toBe(start + 1);

  // An entry onto the lower part of another story's entry: after it.
  const e3 = await box(card.locator('.kid[data-select="e3"]'));
  await drag(page, "e1", {
    x: e3.x + e3.width / 2,
    y: e3.y + e3.height * 0.85,
  });
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e2"],
      s2: ["e3", "e1", "pin"],
      free: [],
    });
  expect(await revision(page)).toBe(start + 2);

  // An entry onto the station's row: out of its story, standing free as a
  // pin (a card is a story's view), and the toast says so.
  await drag(page, "e2", middle(await box(card.locator(":scope > .head"))));
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: [],
      s2: ["e3", "e1", "pin"],
      free: ["e2"],
    });
  expect(await revision(page)).toBe(start + 3);
  await expect(
    page.locator(".toast", { hasText: "now stands in the world" }),
  ).toBeVisible();

  // Escape mid-drag: the marks go, and nothing is written.
  await drag(
    page,
    "pin",
    middle(await box(card.locator('.folder[data-story="s1"]'))),
    true,
  );
  await expect(card.locator(".drop-into")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(card.locator(".drop-into, .dragging")).toHaveCount(0);
  expect(await revision(page)).toBe(start + 3);

  // Each move is one step: three undos give the tour as it was opened.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e1", "e2"],
      s2: ["e3"],
      free: ["pin"],
    });
});

test("the inspector's Earlier, Later and Move buttons move the selected entry, keep it selected, and take the keyboard", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStories(page);
  const card = await unfold(page);
  const start = await revision(page);
  const inspector = page.locator("#inspector-body");

  await card.locator('.kid[data-select="e1"]').click();
  await expect.poll(() => selected(page)).toBe("e1");
  await expect(inspector.locator('[data-act="earlier"]')).toBeDisabled();
  await inspector.locator('[data-act="later"]').press("Enter");
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e2", "e1"],
      s2: ["e3"],
      free: ["pin"],
    });
  expect(await selected(page)).toBe("e1");
  expect(await revision(page)).toBe(start + 1);

  // Into the other story, by its Move button: still selected, one step.
  await inspector.locator('[data-act="move-to:story:s2"]').click();
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e2"],
      s2: ["e3", "e1"],
      free: ["pin"],
    });
  expect(await selected(page)).toBe("e1");
  expect(await revision(page)).toBe(start + 2);

  // Out of the story: it stands free, and as a free item it has no
  // Earlier or Later (the free items have no order).
  await inspector.locator('[data-act="move-to:free"]').click();
  await expect
    .poll(() => lists(page))
    .toEqual({
      s1: ["e2"],
      s2: ["e3"],
      free: ["pin", "e1"],
    });
  expect(await selected(page)).toBe("e1");
  expect(await revision(page)).toBe(start + 3);
  await expect(inspector.locator('[data-act="later"]')).toHaveCount(0);
  await expect(
    inspector.locator('[data-act="move-to:story:s1"]'),
  ).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  test("a finger drags an item by its grip in the list sheet, and the Move button works from a tap", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 390, height: 844 });
    await openStories(page);
    await page.locator("#studio-list").click();
    const card = await unfold(page);
    const start = await revision(page);

    const row = card.locator('[data-item="pin"]');
    const from = middle(await box(row.locator('[data-move="pin"]')));
    const to = middle(await box(card.locator('.folder[data-story="s1"]')));
    const cdp = await page.context().newCDPSession(page);
    /** @param {string} type @param {{x: number, y: number, id: number}[]} points */
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ x: from.x, y: from.y, id: 1 }]);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [
        {
          x: from.x + ((to.x - from.x) * i) / 8,
          y: from.y + ((to.y - from.y) * i) / 8,
          id: 1,
        },
      ]);
    }
    await touch("touchEnd", []);
    await expect
      .poll(() => lists(page))
      .toEqual({
        s1: ["e1", "e2", "pin"],
        s2: ["e3"],
        free: [],
      });
    expect(await revision(page)).toBe(start + 1);

    // The menu path: a tap selects the entry, its Move button moves it.
    await card.locator('.kid[data-select="e3"]').tap();
    await expect.poll(() => selected(page)).toBe("e3");
    await page.locator('#inspector-body [data-act="move-to:free"]').tap();
    await expect
      .poll(() => lists(page))
      .toEqual({
        s1: ["e1", "e2", "pin"],
        s2: [],
        free: ["e3"],
      });
    expect(await revision(page)).toBe(start + 2);
  });
});
