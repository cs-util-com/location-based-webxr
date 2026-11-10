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
  openSampleIn3d,
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
  const tour = await tourNow(page);
  const told = tour.stations
    .find((/** @type {any} */ s) => s.id === "gate")
    .children.find((/** @type {any} */ c) => c.id === story);
  expect(told.children.map((/** @type {any} */ c) => c.kind)).toEqual([
    "picture",
  ]);
  await expect(
    page.locator("#shell-shelf .as-cname", { hasText: "market-view.png" }),
  ).toBeVisible();
});
