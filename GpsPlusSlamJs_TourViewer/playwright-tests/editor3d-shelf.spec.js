// @ts-check
/**
 * The asset shelf in the 3D editor: files added from the tree's "+" menu
 * and dropped onto the tree become items in the tour and cards on the
 * Assets panel, and a draft reload keeps the items.
 */
import { expect, test } from "@playwright/test";

import { encodeRgbPng } from "../../scripts/e2e/terrarium-png.mjs";
import {
  afterFrames,
  answerHosts,
  boxIn,
  capture,
  DOCK_PHONE_TABS_PX,
  DOCK_TABS_PX,
  dockPhoneGroupPx,
  dockSettled,
  layoutOf,
  openSampleIn3d,
  shownIn,
  view3d,
} from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * Where the 3D view draws `id`, or null while it draws nothing for it.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function pointOf(page, id) {
  return page.evaluate(
    (selection) =>
      /** @type {any} */ (window).__tourEditor.view3dPointOf(selection),
    id,
  );
}

/**
 * The blocks of the station `id`, read from the tour now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<any[]>}
 */
async function blocksOf(page, id) {
  const tour = await tourNow(page);
  return stationBlocks(
    tour.stations.find((/** @type {any} */ s) => s.id === id),
  );
}

/**
 * A binary glTF of one triangle, 1 m on a side: the smallest model the
 * editor takes (it must be inert and have a shape).
 */
function triangleGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(positions.buffer);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
    }),
  );
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  out.fill(0x20, 20, 20 + jsonLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(json, 20);
  const binAt = 20 + jsonLength;
  view.setUint32(binAt, binLength, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // "BIN"
  out.set(bin, binAt + 8);
  return Buffer.from(out);
}

/** A tenth of a second of silence as a 8 kHz mono 16-bit WAV. */
function silenceWav() {
  const samples = 800;
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(samples * 2, 40);
  return out;
}

/**
 * Add a file to the station `stationId` from its "+" menu's `kind`.
 * @param {import("@playwright/test").Page} page
 * @param {string} stationId
 * @param {string} kind
 * @param {{ name: string, mimeType: string, buffer: Buffer }} file
 */
async function addFromMenu(page, stationId, kind, file) {
  const card = page.locator(`#tree-body .card[data-station="${stationId}"]`);
  await card.locator(".head").hover();
  await card.locator(".head .add").click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(`#tree-add-menu [data-kind="${kind}"]`).click();
  await (await chooser).setFiles(file);
}

test.beforeEach(async ({ page }) => {
  await answerHosts(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

/**
 * Shows the asset shelf: docked, it is the Files tab beside the details.
 * @param {import("@playwright/test").Page} page
 */
async function showFiles(page) {
  const files = page
    .locator(".dock-host")
    .getByRole("tab", { name: "Files", exact: true });
  if ((await files.count()) > 0) await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
}

test("a 3D model and a sound added from the tree's menu stand in the tree, in 3D and on the Assets panel, and a draft reload keeps them", async ({
  page,
}) => {
  // Why: the add menu's file kinds open the file chooser, add the file
  // to the tour and the shelf, and place an item at the station - three
  // parts that each pass their unit tests alone. Only the page proves
  // the item is drawn, its file listed and both kept by the draft.
  test.setTimeout(240_000);
  await openSampleIn3d(page);
  const before = (await blocksOf(page, "gate")).length;

  await addFromMenu(page, "gate", "model", {
    name: "little-arch.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  });
  await expect(
    page.locator(".toast", { hasText: 'Added the 3D model "little arch"' }),
  ).toBeVisible();
  const model = await selected(page);
  await addFromMenu(page, "gate", "audio", {
    name: "bell.wav",
    mimeType: "audio/wav",
    buffer: silenceWav(),
  });
  await expect(page.locator(".toast", { hasText: '"bell"' })).toBeVisible();
  const sound = await selected(page);
  expect(sound).not.toBe(model);

  const kinds = async () =>
    (await blocksOf(page, "gate"))
      .filter((b) => b.id === model || b.id === sound)
      .map((b) => b.kind)
      .sort();
  expect(await kinds()).toEqual(["audio", "model"]);
  expect((await blocksOf(page, "gate")).length).toBe(before + 2);
  // Docked, an add that makes an item keeps its Details in sight (its
  // next step is there); the shelf is the Files tab beside them.
  await expect(
    page.locator(".dock-host").getByRole("tab", { name: "Details" }),
  ).toHaveAttribute("aria-selected", "true");
  await showFiles(page);

  // In the tree, in 3D, and on the panel.
  for (const id of [model, sound]) {
    await expect(page.locator(`#tree-body [data-select="${id}"]`)).toHaveCount(
      1,
    );
    await expect.poll(() => pointOf(page, id)).not.toBeNull();
  }
  const shelf = page.locator("#shell-shelf");
  await expect(
    shelf.locator(".as-cname", { hasText: "little-arch.glb" }),
  ).toBeVisible();
  await expect(
    shelf.locator(".as-cname", { hasText: "bell.wav" }),
  ).toBeVisible();

  const cards = await shelf.locator(".as-card").count();

  // A reload: the draft offers the work, and Restore brings both back.
  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  const offer = page.locator(".toast.draft-offer");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await afterFrames(page, 3);
  // A fresh page shows its stations folded: unfold the gate to see its rows.
  await page.locator('#tree-body [data-unfold="gate"]').click();
  expect(await kinds()).toEqual(["audio", "model"]);
  for (const id of [model, sound]) {
    await expect(page.locator(`#tree-body [data-select="${id}"]`)).toHaveCount(
      1,
    );
    await expect.poll(() => pointOf(page, id)).not.toBeNull();
  }
  // The files are on the panel again (named by their path in the tour: the
  // draft keeps the bytes, not the name they came in with).
  await showFiles(page);
  await expect(shelf.locator(".as-card")).toHaveCount(cards);
  expect((await view3d(page))?.stations).toBe(3);
});

test("a picture dropped onto a story's row becomes the story's last entry and a card on the Assets panel", async ({
  page,
}) => {
  // Why: a drop on the tree is read from the element under the pointer
  // (file-drop.ts); a story's row must add the picture into that story,
  // not stand it free at the station, and the file must reach the shelf.
  test.setTimeout(240_000);
  await openSampleIn3d(page);
  const gate = page.locator('#tree-body .card[data-station="gate"]');
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  await page.locator('#tree-add-menu [data-kind="story"]').click();
  const story = String(await selected(page)).slice("story:".length);
  const row = gate.locator(`.folder[data-story="${story}"] [data-select]`);
  await expect(row).toBeVisible();

  const png = encodeRgbPng(4, 3, new Array(4 * 3 * 3).fill(200));
  await row.evaluate((target, bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "market-view.png", {
        type: "image/png",
      }),
    );
    for (const type of ["dragover", "drop"]) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    }
  }, Array.from(png));

  await expect(
    page.locator(".toast", { hasText: 'Added the picture "market view"' }),
  ).toBeVisible();
  // Docked, a drop that makes an item keeps its Details in sight.
  await expect(
    page
      .locator(".dock-host")
      .getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const tour = await tourNow(page);
  const told = tour.stations
    .find((/** @type {any} */ s) => s.id === "gate")
    .children.find((/** @type {any} */ c) => c.id === story);
  expect(told.children.map((/** @type {any} */ c) => c.kind)).toEqual([
    "picture",
  ]);
  await showFiles(page);
  await expect(
    page.locator("#shell-shelf .as-cname", { hasText: "market-view.png" }),
  ).toBeVisible();
});

test("a file in use is deleted from the shelf with its item and comes back whole with the Undo, and its Replace switches the item in one step", async ({
  page,
}) => {
  // Why: the shelf's delete of a file in use and its "Replace everywhere"
  // are steps of the page's edit stack, said with the page's Undo toast;
  // the shelf puts the card back when the item naming its file returns.
  // Each part passes its unit tests alone; only the page proves the
  // toast, the stack and the shelf work together.
  test.setTimeout(240_000);
  await openSampleIn3d(page);
  await addFromMenu(page, "gate", "audio", {
    name: "toll.wav",
    mimeType: "audio/wav",
    buffer: silenceWav(),
  });
  await expect(page.locator(".toast", { hasText: '"toll"' })).toBeVisible();
  const sound = String(await selected(page));
  const audioOf = async () =>
    (await blocksOf(page, "gate")).find((b) => b.id === sound)?.audio;
  const old = await audioOf();
  expect(typeof old).toBe("string");
  await showFiles(page);
  const shelf = page.locator("#shell-shelf");
  const card = shelf.locator(".as-card", {
    has: page.locator(".as-cname", { hasText: "toll.wav" }),
  });

  await card.locator('[data-act="del"]').click();
  const confirm = card.locator('[role="alertdialog"]');
  await expect(confirm).toContainText("Deletes 1 item.");
  await confirm.locator('[data-act="delyes"]').click();
  const said = page.locator(".toast", { hasText: "Deleted toll.wav." });
  await expect(said).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await audioOf()).toBeUndefined();
  await said.locator("button", { hasText: "Undo" }).click();
  await expect(page.locator(".toast", { hasText: "Undone" })).toBeVisible();
  expect(await audioOf()).toBe(old);
  await expect(card).toHaveCount(1);

  // Replace everywhere: a sound of other bytes, picked for the same kind.
  await card.locator('[data-act="toggle"]').click();
  const replace = card.locator('[data-act="replace"]');
  await expect(replace).toHaveText("Replace in 1 place...");
  const chooser = page.waitForEvent("filechooser");
  await replace.click();
  const other = silenceWav();
  other.writeInt16LE(1200, 44);
  await (
    await chooser
  ).setFiles({ name: "chime.wav", mimeType: "audio/wav", buffer: other });
  const replaced = page.locator(".toast", {
    hasText: '"chime.wav" is used in 1 place now.',
  });
  await expect(replaced).toBeVisible();
  const now = await audioOf();
  expect(now).not.toBe(old);
  await expect(
    shelf.locator(".as-cname", { hasText: "chime.wav" }),
  ).toBeVisible();
  await replaced.locator("button", { hasText: "Undo" }).click();
  await expect(page.locator(".toast", { hasText: "Undone" })).toBeVisible();
  expect(await audioOf()).toBe(old);
});

/**
 * Drop `files` on the 3D view, as a creator drops them anywhere on the page.
 * @param {import("@playwright/test").Page} page
 * @param {{ name: string, type: string, bytes: number[] }[]} files
 */
async function dropOnPage(page, files) {
  await page.locator("#view3d").evaluate((target, list) => {
    const data = new DataTransfer();
    for (const f of list) {
      data.items.add(
        new File([new Uint8Array(f.bytes)], f.name, { type: f.type }),
      );
    }
    for (const type of ["dragover", "drop"]) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    }
  }, files);
}

/**
 * The gaps between the cards of a `layoutOf` read, top to bottom.
 * @param {Record<string, import("./editor3d-fixture.js").LaidOut[]>} layout
 */
function cardGaps(layout) {
  const boxes = (layout["#shell-shelf .as-card"] ?? []).map((c) => c.box);
  const gaps = [];
  for (let i = 1; i < boxes.length; i++) {
    const above = boxes[i - 1];
    const below = boxes[i];
    if (above && below) gaps.push(below.y - (above.y + above.height));
  }
  return gaps;
}

const SHELF_PARTS = [
  "#shell-shelf",
  "#shell-shelf .as-head",
  "#shell-shelf .as-card",
  "#shell-shelf .as-foot",
  "#shell-tree",
  "#shell-bar",
];

/** A phone's one tabbed group (the one holding the list's tab). */
const PHONE_GROUP =
  '.dock-host .dv-groupview:has(.dock-tab[data-panel="list"])';

// The panel eases its width (a 0.16 s transition), so a size read a frame
// or two after a resize can land mid-way: wait until it has no animation
// left.
async function shelfSettled(page) {
  await afterFrames(page, 2);
  await page.waitForFunction(
    () => document.getElementById("shell-shelf")?.getAnimations().length === 0,
  );
}

// The positions and gaps are the chosen prototype's
// (public/prototypes/asset-shelf-2), read from it at the same three sizes:
// a 300 px dock at the right edge on a desktop, cards 8 px in from the
// panel and 6 px apart (4 px in landscape), the foot only where the window
// is tall. On a phone the shelf is the Files tab of the phone's one group:
// that group's width at the window's right in landscape, and upright the
// window's width under the 3D view, down to the bottom bar. (Until the
// panels docked on a phone, landscape docked it in a 268 px right column,
// and upright it was a sheet of its own whose top stood about a third
// down, as the prototype's: upright the group's top is where the creator
// sized it, so that third has no docked counterpart.)
test("the Assets panel sits where the chosen prototype puts it, on a desktop, a phone in landscape and a phone", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openSampleIn3d(page);
  // Docked, the shelf is the Files tab beside Details, which shows first;
  // the dropped files reveal it.
  const filesTab = page.locator(".dock-host").getByRole("tab", {
    name: "Files",
  });
  await expect(filesTab).toHaveAttribute("aria-selected", "false");
  // The cards counted with Files shown (behind Details the shelf is out of
  // the page), then Details shown again.
  await filesTab.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  const before = await page.locator("#shell-shelf .as-card").count();
  await page
    .locator(".dock-host")
    .getByRole("tab", { name: "Details", exact: true })
    .click();
  await expect(filesTab).toHaveAttribute("aria-selected", "false");
  await dropOnPage(page, [
    {
      name: "market-view.png",
      type: "image/png",
      bytes: [...encodeRgbPng(4, 3, new Array(36).fill(200))],
    },
    { name: "bell.wav", type: "audio/wav", bytes: [...silenceWav()] },
  ]);
  await expect(page.locator("#shell-shelf .as-card")).toHaveCount(before + 2);
  await expect(filesTab).toHaveAttribute("aria-selected", "true");

  // A desktop: the right column, under its tab strip, down to the list's
  // foot.
  let layout = await layoutOf(page, SHELF_PARTS);
  let shelf = boxIn(layout, "#shell-shelf");
  const tree = boxIn(layout, "#shell-tree");
  expect(shelf.width).toBe(300);
  expect(shelf.x + shelf.width).toBe(1440);
  expect(shelf.y).toBe(tree.y + DOCK_TABS_PX);
  expect(shelf.y + shelf.height).toBe(tree.y + tree.height);
  expect(boxIn(layout, "#shell-shelf .as-head").height).toBe(36);
  let card = boxIn(layout, "#shell-shelf .as-card", 0);
  // 8 px in (docked, the line beside it is the docking's splitter).
  expect(card.x - shelf.x).toBe(8);
  expect(shelf.x + shelf.width - (card.x + card.width)).toBe(8);
  for (const gap of cardGaps(layout)) expect(gap).toBeCloseTo(6, 0);
  expect(shownIn(layout, "#shell-shelf .as-foot")).toBe(true);
  const foot = boxIn(layout, "#shell-shelf .as-foot");
  expect(foot.y + foot.height).toBeCloseTo(shelf.y + shelf.height, 0);
  await capture(page, "test-results/shelf-layout-desktop.png");

  // A phone in landscape: the group's width at the window's right,
  // denser, no foot; its Files tab shown by the bar's toggle.
  await page.setViewportSize({ width: 844, height: 390 });
  await dockSettled(page, 844);
  if (!(await page.locator("#shell-shelf").isVisible())) {
    await page.locator("#shelf-toggle").click();
  }
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await shelfSettled(page);
  layout = await layoutOf(page, [...SHELF_PARTS, PHONE_GROUP]);
  shelf = boxIn(layout, "#shell-shelf");
  let group = boxIn(layout, PHONE_GROUP);
  expect(shelf.width).toBe(dockPhoneGroupPx(844, 390));
  expect(shelf.x + shelf.width).toBe(844);
  expect(shelf.y).toBe(group.y + DOCK_PHONE_TABS_PX);
  card = boxIn(layout, "#shell-shelf .as-card", 0);
  expect(card.x - shelf.x).toBe(6); // 6 px in
  for (const gap of cardGaps(layout)) expect(gap).toBeCloseTo(4, 0);
  expect(shownIn(layout, "#shell-shelf .as-foot")).toBe(false);
  await capture(page, "test-results/shelf-layout-landscape.png");

  // A phone: not shown until asked for, then its tab in the group under
  // the 3D view, the map above it in view.
  await page.setViewportSize({ width: 390, height: 844 });
  await dockSettled(page, 390);
  await shelfSettled(page);
  await expect(page.locator("#shell-shelf")).toBeHidden();
  await page.locator("#shelf-toggle").click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await shelfSettled(page);
  layout = await layoutOf(page, [...SHELF_PARTS, PHONE_GROUP]);
  shelf = boxIn(layout, "#shell-shelf");
  group = boxIn(layout, PHONE_GROUP);
  const bar = boxIn(layout, "#shell-bar");
  expect(shelf.x).toBe(0);
  expect(shelf.width).toBe(390);
  expect(shelf.y + shelf.height).toBeCloseTo(bar.y, 0);
  expect(shelf.y).toBe(group.y + DOCK_PHONE_TABS_PX);
  card = boxIn(layout, "#shell-shelf .as-card", 0);
  expect(card.x).toBe(8);
  expect(card.width).toBe(374);
  for (const gap of cardGaps(layout)) expect(gap).toBeCloseTo(6, 0);
  expect(shownIn(layout, "#shell-shelf .as-foot")).toBe(false);
  await capture(page, "test-results/shelf-layout-phone.png");
});

// Why: docked, the shelf leaves the page while Details shows beside it
// (the Files tab hidden). A file added then must still be listed and
// optimized: the shelf's work is not tied to its element being shown.
test("a file added while the docked Files tab is hidden is listed and done when Files shows", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  const host = page.locator(".dock-host");
  await expect(
    host.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#shell-shelf")).toHaveCount(0);
  await addFromMenu(page, "gate", "model", {
    name: "little-arch.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  });
  await expect(
    page.locator(".toast", { hasText: 'Added the 3D model "little arch"' }),
  ).toBeVisible();
  await expect(page.locator("#shell-shelf")).toHaveCount(0);
  await showFiles(page);
  const card = page
    .locator("#shell-shelf .as-card")
    .filter({ has: page.locator(".as-cname", { hasText: "little-arch.glb" }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".as-cstate")).toHaveClass(/\b(ready|kept|idle)\b/);
});

// Why: a file dropped on an item's file field gives the item that file;
// docked, its Details stay the shown tab (the next step is there), not the
// Files tab a loose drop shows.
test("a file dropped on an item's file field keeps the docked Details shown", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await addFromMenu(page, "gate", "model", {
    name: "little-arch.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  });
  const field = page.locator("#shell-inspector [data-filefield]").first();
  await expect(field).toBeVisible();
  await field.evaluate((target, bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "big-arch.glb", {
        type: "model/gltf-binary",
      }),
    );
    for (const type of ["dragover", "drop"]) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
    }
  }, Array.from(triangleGlb()));
  await expect(
    page.locator(".toast", { hasText: 'The item now shows "big-arch.glb"' }),
  ).toBeVisible();
  const host = page.locator(".dock-host");
  await expect(
    host.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    host.getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "false");
});

// Why: docked, the list behind another tab is out of the page. A file
// dropped then must still be read against the list and reach the shelf,
// not throw on a lookup that finds no list and lose the file unsaid.
test("a file dropped while the list is behind the Files tab reaches the shelf", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  const host = page.locator(".dock-host");
  const files = host.getByRole("tab", { name: "Files", exact: true });
  await files.dragTo(page.locator(".dock-pane-list"));
  await expect(
    host.getByRole("tab", { name: "List", exact: true }),
  ).toBeVisible();
  await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await expect(page.locator("#shell-tree")).toHaveCount(0);
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await page.locator("#shell-shelf .as-card").count();
  await dropOnPage(page, [
    {
      name: "market-view.png",
      type: "image/png",
      bytes: [...encodeRgbPng(4, 3, new Array(36).fill(200))],
    },
  ]);
  await expect(page.locator("#shell-shelf .as-card")).toHaveCount(before + 1);
  expect(errors).toEqual([]);
});
