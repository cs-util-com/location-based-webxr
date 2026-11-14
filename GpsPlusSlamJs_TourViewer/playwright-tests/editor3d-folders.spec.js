// @ts-check
import { expect, test } from "@playwright/test";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  SQUARE_GROUND_M,
  answerHosts,
  boxIn,
  capture,
  dockSettled,
  layoutOf,
  openZip,
  styleIn,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: a station's items are grouped into plain folders
 * in the tree - picked with Ctrl+click, grouped with Ctrl+G and named in
 * place, dragged out of a folder, ungrouped with Ctrl+Shift+G - and every
 * one of those must reach the tour file, survive a reload through the
 * draft, and show the folder's items in the 3D view. A folder dropped
 * where it cannot go (onto a story) must say "Not possible here" and write
 * nothing. The folder commands, the drop rule and the shell's keys each
 * have unit tests; only the page shows the tree, the drag, the session,
 * the draft and the 3D view agreeing.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** The geoid's N at the square (m): the file's heights are ellipsoidal. */
const N_M = 45.68;

/**
 * A tour of one station "Station A": a story "First" with one entry, a
 * plain folder "Yard" holding pin "y", and free pins p, q and r.
 * @returns {Promise<Buffer>}
 */
async function foldersTour() {
  /** @param {string} id @param {number} x */
  const pin = (id, x) => ({
    id,
    kind: "shortText",
    view: "pin",
    caption: `Pin ${id}`,
    createdAtIso: "2026-11-10T09:00:00.000Z",
    pose: { position: [x, 1.5, 0], rotation: [0, 0, 0, 1] },
  });
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Folders",
    // Its own id: the draft is offered back for the same tour only.
    tourId: "fedcba9876543210fedcba9876543210",
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
            kind: "folder",
            role: "story",
            title: "First",
            children: [
              {
                id: "e1",
                kind: "shortText",
                view: "card",
                caption: "Entry e1",
                pose: { position: [2, 1.5, 0], rotation: [0, 0, 0, 1] },
                advance: { mode: "tap" },
              },
              {
                id: "e2",
                kind: "shortText",
                view: "pin",
                caption: "Entry e2",
                createdAtIso: "2026-11-10T09:00:00.000Z",
                // 4 m west of the station, clear of the free pins.
                pose: { position: [0, 1.5, -4], rotation: [0, 0, 0, 1] },
                advance: { mode: "tap" },
              },
            ],
          },
          {
            id: "yard",
            kind: "folder",
            title: "Yard",
            pose: { position: [0, 0, 4], rotation: [0, 0, 0, 1] },
            children: [pin("y", 1)],
          },
          pin("p", -3),
          pin("q", 0),
          pin("r", 3),
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
 * Station A as the tour holds it: each plain folder's item ids by its
 * title, and the free items' ids (stories left out).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, string[]>>}
 */
function groups(page) {
  return page.evaluate(() => {
    const tour = /** @type {any} */ (window).__tourEditor.manifest();
    /** @type {Record<string, string[]>} */
    const out = { free: [] };
    for (const child of tour.stations[0].children) {
      if (child.kind === "folder" && child.role === undefined) {
        out[child.title] = child.children.map((/** @type {any} */ c) => c.id);
      } else if (child.kind !== "folder") out["free"]?.push(child.id);
    }
    out["free"]?.sort();
    return out;
  });
}

/**
 * A plain folder's id by its title, as the tour holds it.
 * @param {import("@playwright/test").Page} page
 * @param {string} title
 * @returns {Promise<string>}
 */
async function folderId(page, title) {
  const id = await page.evaluate(
    (t) =>
      /** @type {any} */ (window).__tourEditor
        .manifest()
        .stations[0].children.find(
          (/** @type {any} */ c) => c.kind === "folder" && c.title === t,
        )?.id,
    title,
  );
  if (typeof id !== "string") throw new Error(`no folder "${title}"`);
  return id;
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
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
 * Open the folders tour in the editor's 3D view (no globe).
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} zip
 */
async function openFolders(page, zip) {
  await page.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "folders.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
}

/**
 * Unfold the station card, where folded.
 * @param {import("@playwright/test").Page} page
 */
async function unfold(page) {
  // Docked, the tree is moved into the layout a moment after the 3D view
  // opens; a phone shows it on its List button's press.
  await dockSettled(page, page.viewportSize()?.width ?? 0);
  if (!(await page.locator("#tree-body").isVisible())) {
    await page.locator("#studio-list").click();
  }
  const card = page.locator('#tree-body .card[data-station="a"]');
  const p = card.locator('.kid[data-select="p"]');
  if (!(await p.isVisible())) await card.locator(".head .tw").click();
  await expect(p).toBeVisible();
  return card;
}

/**
 * Drag row `id` by its grip to the point `to`, with the mouse; released
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
  // Three steps: the drag starts at the first and the last decides where
  // it lands (a loaded runner answers each step slowly).
  await page.mouse.move(to.x, to.y, { steps: 3 });
  if (!hold) await page.mouse.up();
}

test("Ctrl+click and Ctrl+G group items into a named folder, a drag takes one out, Ctrl+Shift+G ungroups, and a reload keeps it all", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const zip = await foldersTour();
  await openFolders(page, zip);
  const card = await unfold(page);
  const start = await revision(page);
  expect(await groups(page)).toEqual({ Yard: ["y"], free: ["p", "q", "r"] });

  // Two rows picked with Ctrl+click, grouped with Ctrl+G: the new folder's
  // name field takes the focus with the proposed name, Enter writes it.
  await card.locator('.kid[data-select="p"]').click();
  await card.locator('.kid[data-select="q"]').click({ modifiers: ["Control"] });
  await expect(page.locator("#tree-selbar")).toContainText("2 selected");
  await page.keyboard.press("Control+g");
  const name = card.locator("input.renin");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Folder 1");
  await expect(
    page.locator(".toast", { hasText: "Grouped 2 items into a folder" }),
  ).toBeVisible();
  await name.fill("Benches");
  await name.press("Enter");
  await expect
    .poll(() => groups(page))
    .toEqual({ Yard: ["y"], Benches: ["p", "q"], free: ["r"] });
  // Two steps: the group and the name.
  expect(await revision(page)).toBe(start + 2);
  const benches = await folderId(page, "Benches");
  const benchesRow = card.locator(`.gfolder[data-plainfolder="${benches}"]`);
  await expect(benchesRow.locator("button.fname")).toBeFocused();
  await expect(benchesRow.locator(".meta")).toHaveText("2 items");
  await expect(card.locator(".kid.infolder")).toHaveCount(3);

  // The selected folder's items are outlined in the 3D view, one box each.
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe(`folder:${benches}`);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            /** @type {any} */ (window).__tourEditor.view3dFolderOutlines()
              ?.boxes,
        ),
      { timeout: 30_000 },
    )
    .toBe(2);

  // q dragged out onto the station's row: it stands free again, one step.
  await drag(page, "q", middle(await box(card.locator(":scope > .head"))));
  await expect
    .poll(() => groups(page))
    .toEqual({ Yard: ["y"], Benches: ["p"], free: ["q", "r"] });
  expect(await revision(page)).toBe(start + 3);
  await expect(
    page.locator(".toast", { hasText: "left the folder" }),
  ).toBeVisible();

  // The station's folder "Yard" ungrouped with Ctrl+Shift+G: y stays.
  const yard = card.locator('.gfolder[data-plainfolder="yard"] button.fname');
  await yard.click();
  await page.keyboard.press("Control+Shift+g");
  await expect
    .poll(() => groups(page))
    .toEqual({ Benches: ["p"], free: ["q", "r", "y"] });
  expect(await revision(page)).toBe(start + 4);
  await expect(
    page.locator(".toast", { hasText: "Ungrouped - 1 item stays" }),
  ).toBeVisible();

  // A reload: the draft offers the edits, and Restore brings them back.
  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "folders.zip");
  const offer = page.locator(".toast.draft-offer");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect
    .poll(() => groups(page))
    .toEqual({ Benches: ["p"], free: ["q", "r", "y"] });
  const again = await unfold(page);
  await expect(again.locator(".gfolder .nm")).toHaveText(["Benches"]);
});

test("a folder dropped onto a story, or a folder's item, says Not possible here and writes nothing", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolders(page, await foldersTour());
  const card = await unfold(page);
  // A folder shows its items until it is folded.
  await expect(card.locator('.kid.infolder[data-select="y"]')).toBeVisible();
  const start = await revision(page);
  const story = middle(await box(card.locator('.folder[data-story="s1"]')));
  const refusedGhost = page.locator(".nest-ghost[data-refused]");
  const marks = card.locator(".drop-before, .drop-after, .drop-into");

  for (const id of ["yard", "y"]) {
    await drag(page, id, story, true);
    await expect(refusedGhost).toBeVisible();
    await expect(refusedGhost).toContainText("Not possible here");
    await expect(page.locator("html")).toHaveAttribute(
      "data-nest-drag",
      "refused",
    );
    await expect(marks).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator(".nest-ghost")).toHaveCount(0);
    expect(await revision(page)).toBe(start);
    expect(await groups(page)).toEqual({ Yard: ["y"], free: ["p", "q", "r"] });
  }
});

/**
 * What the 3D view picks at the point where entry e2 stands (null: off
 * the screen).
 * @param {import("@playwright/test").Page} page
 */
function pickAtE2(page) {
  return page.evaluate(() => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const at = hook.view3dScreenOf("e2");
    return at === null ? null : (hook.view3dUnder(at[0], at[1])?.pick ?? null);
  });
}

// Why: a story's scene is seen where it stands while the story is open
// (chosen in the tree, or one of its entries), and only then; picking an
// entry in the 3D view chooses it in the tree. Its entries take no
// handle: a move the story editor cannot save yet is not offered.
test("an open story's posed entry shows in the 3D view, is chosen there, and takes no handle", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolders(page, await foldersTour());
  const card = await unfold(page);
  const start = await revision(page);
  const selected = () =>
    page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected());
  const settled = () =>
    expect
      .poll(async () => (await view3dStats(page))?.flying, { timeout: 30_000 })
      .toBe(false);

  // Closed: nothing of the story stands there.
  await card.locator('.kid[data-select="p"]').click();
  await expect.poll(selected).toBe("p");
  await settled();
  expect(await pickAtE2(page)).not.toBe("e2");

  await card.locator('.folder[data-story="s1"] button.fname').click();
  await expect.poll(selected).toBe("story:s1");
  await settled();
  await expect.poll(() => pickAtE2(page)).toBe("e2");

  // Chosen in the 3D view, it is chosen in the tree, with no handle.
  const at = await shownAt(page, () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dScreenOf("e2"),
    ),
  );
  await page.mouse.click(at.x, at.y);
  await expect.poll(selected).toBe("e2");
  await settled();
  expect(
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dHandle("middle"),
    ),
  ).toBeNull();
  // Still drawn while its entry is chosen.
  await expect.poll(() => pickAtE2(page)).toBe("e2");
  await capture(page, "editor3d-story-entry-open");

  // Another item chosen: the story closes, and nothing was written.
  await card.locator('.kid[data-select="p"]').click();
  await expect.poll(selected).toBe("p");
  await settled();
  await expect.poll(() => pickAtE2(page)).not.toBe("e2");
  expect(await revision(page)).toBe(start);
});

/**
 * Station A's plain folders by title, in the tour's order.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
function folderOrder(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor
      .manifest()
      .stations[0].children.filter(
        (/** @type {any} */ c) => c.kind === "folder" && c.role === undefined,
      )
      .map((/** @type {any} */ c) => c.title),
  );
}

// Why: a folder row carries a grip, so its drag must do what it shows:
// above another folder's row it goes before that folder, onto the
// station's row it goes last among the folders - each one step, written
// to the tour, nothing moving in the scene.
test("a folder dragged by its grip moves among its station's folders", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolders(page, await foldersTour());
  const card = await unfold(page);
  await card.locator('.kid[data-select="p"]').click();
  await card.locator('.kid[data-select="q"]').click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  const name = card.locator("input.renin");
  await name.fill("Benches");
  await name.press("Enter");
  await expect.poll(() => folderOrder(page)).toEqual(["Yard", "Benches"]);
  const benches = await folderId(page, "Benches");
  const start = await revision(page);

  // Onto the top edge of Yard's row: before it.
  const yardRow = await box(card.locator('.gfolder[data-plainfolder="yard"]'));
  await drag(page, benches, {
    x: yardRow.x + yardRow.width / 2,
    y: yardRow.y + 2,
  });
  await expect.poll(() => folderOrder(page)).toEqual(["Benches", "Yard"]);
  expect(await revision(page)).toBe(start + 1);

  // Onto the station's row: last among the folders.
  await drag(page, benches, middle(await box(card.locator(":scope > .head"))));
  await expect.poll(() => folderOrder(page)).toEqual(["Yard", "Benches"]);
  expect(await revision(page)).toBe(start + 2);
  expect(await groups(page)).toEqual({
    Yard: ["y"],
    Benches: ["p", "q"],
    free: ["r"],
  });
});

/**
 * The tree's folder rows as chosen, at a phone, a phone held sideways and
 * a desktop: a folder's row at the free items' depth, its items one step
 * (16 px) deeper and right under it, the rows 26 px high (32 px on a
 * narrow screen), the selected folder's items on its teal band, and the
 * picked rows' bar with a tinted Group, an off button without a fill and
 * 16 px checkboxes inside their rows.
 */
const VIEWS = [
  { name: "phone", width: 390, height: 844, row: 32, button: 32 },
  { name: "sideways", width: 844, height: 390, row: 26, button: 28 },
  { name: "desktop", width: 1440, height: 900, row: 26, button: 28 },
];

for (const view of VIEWS) {
  test(`the folder rows keep their chosen arrangement (${view.name})`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: view.width, height: view.height });
    await openFolders(page, await foldersTour());
    const card = await unfold(page);
    const yard = '#tree-body .gfolder[data-plainfolder="yard"]';
    const inYard = '#tree-body .kid.infolder[data-select="y"]';
    const free = '#tree-body .kid[data-list="free"][data-select="p"]';
    const rows = [yard, inYard, free];
    const icons = [`${yard} .ic`, `${inYard} .ic`, `${free} .ic`];
    const band = ["background-color", "padding-left"];

    // The folder selected: its item wears its band.
    await card
      .locator(`.gfolder[data-plainfolder="yard"] button.fname`)
      .click();
    await expect(
      card.locator('.kid.infolder.ctx[data-select="y"]'),
    ).toHaveCount(1);
    // A phone shows the scene on a row's tap: the tree again.
    await unfold(page);
    const at = await layoutOf(page, [...rows, ...icons], band);
    const [folderRow, kidRow, freeRow] = rows.map((s) => boxIn(at, s));
    const [folderIcon, kidIcon, freeIcon] = icons.map((s) => boxIn(at, s));
    for (const r of [folderRow, kidRow, freeRow]) {
      expect(Math.round(r?.height ?? 0)).toBe(view.row);
    }
    // Stacked with no gap: the item right under its folder, the free
    // items right under the folder's last item.
    expect(
      Math.abs((kidRow?.y ?? 0) - (folderRow?.y ?? 0) - view.row),
    ).toBeLessThan(1);
    expect(
      Math.abs((freeRow?.y ?? 0) - (kidRow?.y ?? 0) - view.row),
    ).toBeLessThan(1);
    // The folder's icon at the free items' depth, its item's 16 px deeper.
    expect(Math.abs((folderIcon?.x ?? 0) - (freeIcon?.x ?? 0))).toBeLessThan(1);
    expect(Math.round((kidIcon?.x ?? 0) - (freeIcon?.x ?? 0))).toBe(16);
    expect(styleIn(at, inYard, "padding-left")).toBe("76px");
    expect(styleIn(at, inYard, "background-color")).toBe(
      "rgba(87, 196, 184, 0.1)",
    );
    expect(styleIn(at, free, "background-color")).toBe("rgba(0, 0, 0, 0)");

    // The Select mode begins with the selected folder ticked; two items
    // ticked beside it: Group is off (no folder in a folder), with no
    // fill, and Ungroup on.
    const group = '#tree-selbar [data-selbar="group"]';
    const ungroup = '#tree-selbar [data-selbar="ungroup"]';
    const ticks = '#tree-body .kid[data-list="free"] .cb';
    await page.locator("#tree-select").click();
    await card.locator('.kid[data-select="p"]').click();
    await card.locator('.kid[data-select="q"]').click();
    await expect(page.locator("#tree-selbar")).toContainText("3 selected");
    const off = await layoutOf(page, [group, ungroup], ["background-color"]);
    expect(styleIn(off, group, "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(styleIn(off, ungroup, "background-color")).not.toBe(
      "rgba(0, 0, 0, 0)",
    );

    // The folder unticked, two items left: Group is on, tinted, not filled.
    await card
      .locator(`.gfolder[data-plainfolder="yard"] button.fname`)
      .click();
    await expect(page.locator("#tree-selbar")).toContainText("2 selected");
    const picked = await layoutOf(
      page,
      [group, ungroup, ticks, free],
      ["background-color", "color"],
    );
    expect(Math.round(boxIn(picked, group).height)).toBe(view.button);
    expect(Math.round(boxIn(picked, ungroup).height)).toBe(view.button);
    expect(styleIn(picked, group, "background-color")).toBe(
      "rgba(233, 162, 59, 0.14)",
    );
    // Ungroup cannot act on two free items: off, with no fill.
    expect(styleIn(picked, ungroup, "background-color")).toBe(
      "rgba(0, 0, 0, 0)",
    );
    const tick = boxIn(picked, ticks, 0);
    const pRow = boxIn(picked, free);
    expect([Math.round(tick.width), Math.round(tick.height)]).toEqual([16, 16]);
    expect(tick.x + tick.width).toBeLessThanOrEqual(pRow.x + pRow.width);
    expect(
      Math.abs(tick.y + tick.height / 2 - (pRow.y + pRow.height / 2)),
    ).toBeLessThan(1);
  });
}

/**
 * Station A's folder "Yard" as the tour holds it (its pose and scale).
 * @param {import("@playwright/test").Page} page
 */
function yardOf(page) {
  return page.evaluate(() => {
    const yard = /** @type {any} */ (window).__tourEditor
      .manifest()
      .stations[0].children.find((/** @type {any} */ c) => c.id === "yard");
    return {
      pose: yard.pose,
      scale: yard.scale ?? 1,
      item: yard.children[0].pose.position,
    };
  });
}

/** @param {import("@playwright/test").Page} page */
function wholeTour(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function view3dStats(page) {
  return page.evaluate(() => /** @type {any} */ (window).__tourEditor.view3d());
}

/**
 * A point of the 3D view's hook (CSS px on the canvas) on the page, once
 * it shows.
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<readonly [number, number] | null>} read
 */
async function shownAt(page, read) {
  await expect.poll(read).not.toBeNull();
  const at = await read();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (at === null || canvas === null) throw new Error("not on the screen");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "knob" | "dot"} part
 */
function handleAt(page, part) {
  return shownAt(page, () =>
    page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    ),
  );
}

/**
 * The front-left corner of the selected folder's dashed outline on the
 * ground (world metres), once drawn.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ x: number, z: number }>}
 */
async function folderHullAt(page) {
  /** @type {{ x: number, z: number } | null} */
  let at = null;
  await expect
    .poll(async () => {
      at = await page.evaluate(
        () =>
          /** @type {any} */ (window).__tourEditor.view3dFolderOutlines()?.hull
            ?.tag ?? null,
      );
      return at !== null;
    })
    .toBe(true);
  if (at === null) throw new Error("no outline");
  return at;
}

/**
 * Item y on the page (it stands in the folder "Yard").
 * @param {import("@playwright/test").Page} page
 */
function itemY(page) {
  return shownAt(page, () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dScreenOf("y"),
    ),
  );
}

/**
 * A pointer that presses at the first point, passes the others and lifts:
 * the mouse, or one finger through the browser's touch input. `between`
 * runs before the lift, the press still held.
 * @typedef {(page: import("@playwright/test").Page,
 *   path: { x: number, y: number }[],
 *   between?: () => Promise<void>) => Promise<void>} Pointer
 */

/** @type {Pointer} */
async function byMouse(page, path, between) {
  const [first, ...rest] = path;
  if (first === undefined) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y);
  await between?.();
  await page.mouse.up();
}

/** @type {Pointer} */
async function byTouch(page, path, between) {
  const cdp = await page.context().newCDPSession(page);
  /** @param {string} type @param {{ x: number, y: number }[]} points */
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: 1 })),
    });
  const [first, ...rest] = path;
  if (first === undefined) return;
  await send("touchStart", [first]);
  for (const p of rest) await send("touchMove", [p]);
  await between?.();
  await send("touchEnd", []);
  await cdp.detach();
}

/**
 * `n` points from `a` to `b`, `a` left out.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {number} [n]
 */
function line(a, b, n = 8) {
  return Array.from({ length: n }, (_, i) => ({
    x: a.x + ((b.x - a.x) * (i + 1)) / n,
    y: a.y + ((b.y - a.y) * (i + 1)) / n,
  }));
}

/**
 * The gesture undone gives back `before`, and redone `after`, each one
 * step (Ctrl+Z and Ctrl+Y, as for the item gizmo).
 * @param {import("@playwright/test").Page} page
 * @param {any} before
 * @param {any} after
 */
async function undoesAndRedoes(page, before, after) {
  await page.keyboard.press("Control+z");
  await expect.poll(() => wholeTour(page)).toEqual(before);
  await page.keyboard.press("Control+y");
  await expect.poll(() => wholeTour(page)).toEqual(after);
  // Their lines cleared before the next press: on a phone held sideways
  // the undo and redo lines stack over the gizmo and would take it.
  await expect(
    page.locator(".toast", { hasText: /^(Undone|Redone)/ }),
  ).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Select the folder "Yard" from its tree row and wait for its gizmo: one
 * ring round its items at its pivot, at least 34 px on the screen.
 * @param {import("@playwright/test").Page} page
 */
async function selectYard(page) {
  const card = await unfold(page);
  await card.locator('.gfolder[data-plainfolder="yard"] button.fname').click();
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe("folder:yard");
  await expect
    .poll(async () => (await view3dStats(page))?.flying, { timeout: 30_000 })
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          /** @type {any} */ (window).__tourEditor.view3dGizmoSizes()?.ringPx,
      ),
    )
    .toBeGreaterThanOrEqual(34 - 0.5);
}

/**
 * Move, turn and scale the folder "Yard" with its gizmo, by `pointer`:
 * each one step, its item following in the 3D view while the drag runs
 * and in the file after it, each undone and redone exactly.
 * @param {import("@playwright/test").Page} page
 * @param {Pointer} pointer
 */
async function moveTurnAndScaleYard(page, pointer) {
  await selectYard(page);
  let steps = await revision(page);

  // Move: the disc at the pivot dragged over the ground. The item follows
  // on the screen before the release, with nothing written yet.
  let before = await wholeTour(page);
  const was = await yardOf(page);
  const middle = await handleAt(page, "middle");
  // The dashed outline is drawn round the item's drawing as it stands this
  // frame, so it shows the item following before anything is written
  // (the item's own screen point is read from the tour, not the drawing).
  const hullStart = await folderHullAt(page);
  await pointer(
    page,
    [middle, ...line(middle, { x: middle.x + 70, y: middle.y + 25 })],
    async () => {
      await expect
        .poll(async () => {
          const now = await folderHullAt(page);
          return Math.hypot(now.x - hullStart.x, now.z - hullStart.z);
        })
        .toBeGreaterThan(0.5);
      expect(await revision(page)).toBe(steps);
    },
  );
  await expect.poll(() => revision(page)).toBe(steps + 1);
  const moved = await yardOf(page);
  expect(
    Math.hypot(
      moved.pose.position[0] - was.pose.position[0],
      moved.pose.position[2] - was.pose.position[2],
    ),
  ).toBeGreaterThan(0.5);
  expect(moved.scale).toBe(1);
  // The item keeps its place in the folder: it moved with it.
  expect(moved.item).toEqual(was.item);
  await undoesAndRedoes(page, before, await wholeTour(page));
  // The undo and the redo count as changes too: count on from here.
  steps = await revision(page);

  // Turn: the knob carried 60 degrees round the pivot.
  before = await wholeTour(page);
  const centre = await handleAt(page, "middle");
  const knob = await handleAt(page, "knob");
  const r = Math.hypot(knob.x - centre.x, knob.y - centre.y);
  const a0 = Math.atan2(knob.y - centre.y, knob.x - centre.x);
  const arc = Array.from({ length: 10 }, (_, i) => {
    const a = a0 + ((i + 1) * Math.PI) / 30;
    return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
  });
  await pointer(page, [knob, ...arc]);
  await expect.poll(() => revision(page)).toBe(steps + 1);
  const turned = await yardOf(page);
  expect(turned.pose.rotation).not.toEqual(moved.pose.rotation);
  expect(turned.pose.position).toEqual(moved.pose.position);
  expect(turned.item).toEqual(was.item);
  await undoesAndRedoes(page, before, await wholeTour(page));
  steps = await revision(page);

  // Scale: a dot on the ring pulled outwards. Everything grows about the
  // pivot: the item stands further from it on the screen.
  before = await wholeTour(page);
  const pivot = await handleAt(page, "middle");
  const dot = await handleAt(page, "dot");
  const yBefore = await itemY(page);
  const out = Math.hypot(dot.x - pivot.x, dot.y - pivot.y);
  const to = {
    x: pivot.x + ((dot.x - pivot.x) * (out + 60)) / out,
    y: pivot.y + ((dot.y - pivot.y) * (out + 60)) / out,
  };
  await pointer(page, [dot, ...line(dot, to)]);
  await expect.poll(() => revision(page)).toBe(steps + 1);
  const scaled = await yardOf(page);
  expect(scaled.scale).toBeGreaterThan(1.05);
  expect(scaled.pose).toEqual(turned.pose);
  expect(scaled.item).toEqual(was.item);
  const yAfter = await itemY(page);
  expect(Math.hypot(yAfter.x - pivot.x, yAfter.y - pivot.y)).toBeGreaterThan(
    Math.hypot(yBefore.x - pivot.x, yBefore.y - pivot.y),
  );
  await undoesAndRedoes(page, before, await wholeTour(page));
}

// Why: a folder is moved, turned and scaled with ONE gizmo at its pivot,
// as the item gizmo moves one item: each gesture one undo step, the
// folder's items following live in the 3D view and in the file, by mouse
// and by touch, at a desktop and a phone held sideways. The gizmo's
// maths, the input's rules and the write-back each have unit tests; only
// the page shows them agreeing on a real drag.
const GIZMO_VIEWS = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
];

for (const view of GIZMO_VIEWS) {
  const at = `${String(view.width)}x${String(view.height)}`;
  test(`a folder's gizmo moves, turns and scales it by mouse at ${at}: one step each, its items follow, undo restores`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(view);
    await openFolders(page, await foldersTour());
    await moveTurnAndScaleYard(page, byMouse);
  });
}

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
  for (const view of GIZMO_VIEWS) {
    const at = `${String(view.width)}x${String(view.height)}`;
    test(`a folder's gizmo moves, turns and scales it by touch at ${at}: one step each, its items follow, undo restores`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize(view);
      await openFolders(page, await foldersTour());
      await moveTurnAndScaleYard(page, byTouch);
    });
  }
});

// Why: the folder gizmo as chosen - one ring round the folder's items at
// its pivot, at least 34 px, its scale dots on the ring and its turn knob
// on a 30 px stalk beyond it - at a phone, a phone held sideways and a
// desktop. A test that only finds a gizmo would pass a ring drawn at the
// item gizmo's size, or a knob on the ring.
for (const view of VIEWS) {
  test(`a folder's gizmo keeps its chosen arrangement (${view.name})`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: view.width, height: view.height });
    await openFolders(page, await foldersTour());
    await selectYard(page);
    // Straight down, the screen shows the ground plane undistorted.
    await page.keyboard.press("t");
    await expect
      .poll(async () => (await view3dStats(page))?.flying, { timeout: 30_000 })
      .toBe(false);
    const sizes = await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dGizmoSizes(),
    );
    const middle = await handleAt(page, "middle");
    const knob = await handleAt(page, "knob");
    const dot = await handleAt(page, "dot");
    // Counted at the ground's depth; the knob and dots are drawn a little
    // over the ground, nearer the camera, so they read a few per cent out.
    const reach = Math.hypot(knob.x - middle.x, knob.y - middle.y);
    expect(reach).toBeGreaterThanOrEqual(sizes.ringPx + 30 - 1);
    expect(reach).toBeLessThanOrEqual((sizes.ringPx + 30) * 1.06);
    const onRing = Math.hypot(dot.x - middle.x, dot.y - middle.y);
    expect(onRing).toBeGreaterThanOrEqual(sizes.ringPx - 1);
    expect(onRing).toBeLessThanOrEqual(sizes.ringPx * 1.06 + 1);
    // The dashed outline round its item, named on its tag.
    const shown = await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dFolderOutlines(),
    );
    expect(shown?.boxes).toBe(1);
    expect(shown?.tag).toBe("Yard");
    expect(shown?.hull?.corners).toHaveLength(4);
    // The line naming the folder stands over the 3D view, clear of the
    // docks at their side and of the map controls, so it is read before
    // the gizmo is touched.
    const hint = page.locator("#shell-scene-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(
      "Yard - 1 item moves, turns and scales with it. Click it to move it alone.",
    );
    const hintBox = await hint.boundingBox();
    // Nor does it lie over the gizmo's turn knob.
    if (hintBox !== null) {
      const overKnob =
        knob.x >= hintBox.x &&
        knob.x <= hintBox.x + hintBox.width &&
        knob.y >= hintBox.y &&
        knob.y <= hintBox.y + hintBox.height;
      expect(overKnob, "the hint clear of the turn knob").toBe(false);
    }
    const viewBox = await page.locator("#view3d").boundingBox();
    if (hintBox === null || viewBox === null) throw new Error("no hint box");
    expect(hintBox.x).toBeGreaterThanOrEqual(viewBox.x);
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(
      viewBox.x + viewBox.width,
    );
    for (const dock of ["#shell-tree", "#shell-inspector", "#map-controls"]) {
      const at = page.locator(dock);
      if (!(await at.isVisible())) continue;
      const box = await at.boundingBox();
      if (box === null) continue;
      const apart =
        hintBox.x + hintBox.width <= box.x + 1 ||
        box.x + box.width <= hintBox.x + 1 ||
        hintBox.y + hintBox.height <= box.y + 1 ||
        box.y + box.height <= hintBox.y + 1;
      expect(apart, `the hint clear of ${dock}`).toBe(true);
    }
    await capture(
      page,
      test.info().outputPath(`folder-gizmo-${view.name}.png`),
    );
  });
}

/**
 * The toasts' boxes on the page, each with its words.
 * @param {import("@playwright/test").Page} page
 */
function toastBoxes(page) {
  return page.locator("#toasts .toast").evaluateAll((all) =>
    all.map((t) => ({
      ...t.getBoundingClientRect().toJSON(),
      text: t.textContent,
    })),
  );
}

// Why: an undo or a redo says so in a toast for six seconds, and the
// next gesture follows at once. On a short screen (a phone held sideways)
// the toasts stood over the middle of the 3D view, where the gizmo of the
// selection stands, and took the press meant for it. The toasts must keep
// clear of the gizmo - its ring and its turn knob - and a press on the
// gizmo while they show must still make its step, by mouse and by touch.
const TOAST_VIEWS = [
  { name: "sideways", width: 844, height: 390, touch: true },
  { name: "sideways-mouse", width: 844, height: 390, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "desktop", width: 1280, height: 800, touch: false },
];

for (const view of TOAST_VIEWS) {
  test.describe(`toasts at ${view.name}`, () => {
    test.use({ hasTouch: view.touch });
    test(`the undo and redo toasts keep clear of the gizmo, which still takes a press while they show (${view.name})`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize({ width: view.width, height: view.height });
      await openFolders(page, await foldersTour());
      await selectYard(page);
      const pointer = view.touch ? byTouch : byMouse;
      // One move, undone and redone: two toasts stand on the page.
      let steps = await revision(page);
      let middle = await handleAt(page, "middle");
      await pointer(page, [
        middle,
        ...line(middle, { x: middle.x + 40, y: middle.y + 15 }),
      ]);
      await expect.poll(() => revision(page)).toBe(steps + 1);
      const moved = await wholeTour(page);
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+y");
      await expect.poll(() => wholeTour(page)).toEqual(moved);
      await expect(
        page.locator(".toast", { hasText: /^(Undone|Redone)/ }),
      ).toHaveCount(2);
      // Where the gizmo stands now: its ring round the pivot and its knob.
      middle = await handleAt(page, "middle");
      const knob = await handleAt(page, "knob");
      const reach = Math.hypot(knob.x - middle.x, knob.y - middle.y) + 12;
      for (const t of await toastBoxes(page)) {
        const nx = Math.max(t.left, Math.min(middle.x, t.right));
        const ny = Math.max(t.top, Math.min(middle.y, t.bottom));
        expect(
          Math.hypot(nx - middle.x, ny - middle.y),
          `the toast "${t.text}" clear of the gizmo`,
        ).toBeGreaterThan(reach);
      }
      // A press on the gizmo while they show is its step.
      steps = await revision(page);
      await pointer(page, [
        middle,
        ...line(middle, { x: middle.x - 40, y: middle.y - 15 }),
      ]);
      await expect.poll(() => revision(page)).toBe(steps + 1);
      await expect(
        page.locator(".toast", { hasText: /^(Undone|Redone)/ }),
      ).not.toHaveCount(0);
      await capture(
        page,
        test.info().outputPath(`folder-toasts-${view.name}.png`),
      );
    });
  });
}
