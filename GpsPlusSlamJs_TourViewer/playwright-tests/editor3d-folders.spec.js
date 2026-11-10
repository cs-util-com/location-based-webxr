// @ts-check
import { expect, test } from "@playwright/test";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { SQUARE_GROUND_M, answerHosts, openZip } from "./editor3d-fixture.js";

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
        page.evaluate(() =>
          /** @type {any} */ (window).__tourEditor.view3dFolderOutlines(),
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
