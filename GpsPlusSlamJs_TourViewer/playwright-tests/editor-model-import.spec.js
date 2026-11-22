// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BlobReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { editorTour, openThroughChooser } from "./editor-tours.js";
import { tourShown, withoutWebgl } from "./editor-session.js";

/**
 * Why these tests matter: a model the creator has as a glTF folder (a
 * .gltf beside its .bin and its pictures) or as a zip of that folder is
 * converted in the editor's own converter Worker into the .glb a tour
 * takes. Only a real page runs that Worker, its file handling and the
 * shelf's card through queued, converting and optimized, and only a real
 * page can show that the model reaches the tour's files - and that a
 * model naming something on the internet never makes the page, or its
 * Worker, fetch it. They run with no 3D view (WebGL refused before the
 * page loads): the shelf and the tour's files do not depend on it. With no
 * 3D view the shelf is drawn but not shown, so its cards are read from the
 * page, not clicked; the shelf shown in the 3D editor is
 * editor3d-shelf.spec.js's.
 */

const BUST = readFileSync(
  new URL("./fixtures/asset-optimizer/model-marble-bust.glb", import.meta.url),
);

/**
 * The bust fixture as the folder an exporter writes: `bust.gltf`, its
 * `bust.bin`, and each picture as a file of its own; `edit` may change the
 * glTF's JSON before it is written.
 * @param {(json: any) => void} [edit]
 * @returns {{ name: string, type: string, bytes: Uint8Array }[]}
 */
function bustFolder(edit) {
  const jsonLength = BUST.readUInt32LE(12);
  const json = JSON.parse(BUST.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;
  const bin = BUST.subarray(binStart, binStart + json.buffers[0].byteLength);
  const files = [];
  for (const image of json.images) {
    const view = json.bufferViews[image.bufferView];
    const name = `${image.name}.jpg`;
    files.push({
      name,
      type: "image/jpeg",
      bytes: new Uint8Array(
        bin.subarray(
          view.byteOffset ?? 0,
          (view.byteOffset ?? 0) + view.byteLength,
        ),
      ),
    });
    delete image.bufferView;
    delete image.mimeType;
    image.uri = name;
  }
  json.buffers[0].uri = "bust.bin";
  edit?.(json);
  return [
    {
      name: "bust.gltf",
      type: "model/gltf+json",
      bytes: new TextEncoder().encode(JSON.stringify(json)),
    },
    { name: "bust.bin", type: "application/octet-stream", bytes: bin },
    ...files,
  ];
}

/**
 * Files dropped on the page (outside any row), as the browser hands them.
 * @param {import("@playwright/test").Page} page
 * @param {{ name: string, type: string, bytes: Uint8Array }[]} files
 */
async function dropOnPage(page, files) {
  await page.evaluate(
    (list) => {
      const data = new DataTransfer();
      for (const f of list) {
        data.items.add(
          new File([new Uint8Array(f.bytes)], f.name, { type: f.type }),
        );
      }
      for (const type of ["dragover", "drop"]) {
        document.body.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          }),
        );
      }
    },
    files.map((f) => ({ ...f, bytes: [...f.bytes] })),
  );
}

/** @param {import("@playwright/test").Page} page */
async function openTour(page) {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await tourShown(page);
}

/**
 * The kind of the tour's file `id`, or null when the tour lists none.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function assetKind(page, id) {
  return page.evaluate(
    (asset) =>
      // @ts-expect-error - the editor's dev-only test hook.
      window.__tourEditor.editor()?.assetOf(asset)?.kind ?? null,
    id,
  );
}

/**
 * Follows a dropped model's card from converting to optimized, and
 * checks the converted model is a 3D model file of the tour.
 * @param {import("@playwright/test").Page} page
 * @param {string} from - the name the model came in with
 */
async function expectConvertedAndOptimized(page, from) {
  const shelf = page.locator("#shell-shelf");
  const importId = await shelf
    .locator(".as-card", { hasText: from })
    .getAttribute("data-aid");
  const importing = shelf.locator(`.as-card[data-aid="${importId}"]`);
  // Converting: the import's own card, until it is a file of the tour.
  await expect(importing.locator(".as-cstate")).toContainText(
    /Queued|Converting to a tour model/,
  );
  const made = shelf.locator(".as-card", { hasText: "bust.glb" });
  await expect(made).toHaveCount(1, { timeout: 120_000 });
  await expect(importing).toHaveCount(0);
  await expect(made).toHaveClass(/\bready\b/, { timeout: 180_000 });
  const id = await made.getAttribute("data-aid");
  expect(id).not.toBeNull();
  expect(await assetKind(page, /** @type {string} */ (id))).toBe("model");
  // The converted model's card is brought into sight, opened.
  await expect(made).toHaveClass(/\bopen\b/);
  await expect(made.locator(".as-made")).toContainText(
    `Converted from "${from}".`,
  );
  return made;
}

test.beforeEach(async ({ context }) => {
  await withoutWebgl(context);
});

test("a glTF folder dropped as its files is converted, optimized and in the tour, its pictures inside it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openTour(page);
  const before = await page.locator("#shell-shelf .as-card").count();
  await dropOnPage(page, bustFolder());
  await expectConvertedAndOptimized(page, "bust.gltf");
  // The pictures went into the model: none is a card of its own.
  await expect(page.locator("#shell-shelf .as-card")).toHaveCount(before + 1);
});

test("a zip of a glTF folder, made here, is converted, optimized and in the tour", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const file of bustFolder()) {
    await writer.add(
      `bust/${file.name}`,
      new BlobReader(new Blob([file.bytes])),
    );
  }
  // A Mac's zip carries its metadata: it is skipped, never a part.
  await writer.add(
    "__MACOSX/bust/._bust.gltf",
    new BlobReader(new Blob(["x"])),
  );
  const zip = await writer.close();
  await openTour(page);
  await dropOnPage(page, [
    { name: "bust.zip", type: "application/zip", bytes: zip },
  ]);
  await expectConvertedAndOptimized(page, "bust.zip");
});

test("a glTF dropped without its .bin is not converted, says why, and adds nothing", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openTour(page);
  const before = await page.locator("#shell-shelf .as-card").count();
  const files = bustFolder().filter((f) => f.name !== "bust.bin");
  await dropOnPage(page, files);
  const card = page
    .locator("#shell-shelf .as-card", { hasText: "bust.gltf" })
    .first();
  await expect(card).toHaveClass(/\bfailed\b/, { timeout: 60_000 });
  await expect(card.locator(".as-cstate")).toContainText("Not converted");
  await expect(card.locator(".as-why")).toContainText('needs "bust.bin"');
  // No Retry: the same files would be refused again.
  await expect(card.locator('[data-act="retry"]')).toHaveCount(0);
  await expect(
    page.locator("#shell-shelf .as-card", { hasText: "bust.glb" }),
  ).toHaveCount(0);
  // Its pictures wait for it: none was added while it can still be removed.
  await expect(page.locator("#shell-shelf .as-card")).toHaveCount(before + 1);
});

test("a model naming a picture on the internet is converted without it, and nothing leaves the page's origin", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await openTour(page);
  const origin = new URL(page.url()).origin;
  /** @type {string[]} */
  const outside = [];
  // The context sees every request of its pages and their Workers.
  context.on("request", (request) => {
    const url = request.url();
    if (!/^(data|blob):/.test(url) && !url.startsWith(origin)) {
      outside.push(url);
    }
  });
  page.on("request", (request) => {
    if (request.url().includes("example.invalid")) outside.push(request.url());
  });
  // The folder holds no file for the picture the model names online (a
  // dropped picture the model does not use would be let go to the shelf
  // on its own, and its card brought into sight instead).
  const files = bustFolder((json) => {
    json.images[0].uri = "https://example.invalid/x.png";
  }).filter((f) => f.name !== "marble_bust_01_nor_gl.jpg");
  expect(files).toHaveLength(4);
  await dropOnPage(page, files);
  const made = await expectConvertedAndOptimized(page, "bust.gltf");
  await expect(made.locator(".as-made")).toContainText(
    'Made without its picture "x.png", which is on the internet',
  );
  expect(outside).toEqual([]);
});
