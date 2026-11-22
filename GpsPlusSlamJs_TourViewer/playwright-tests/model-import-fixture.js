// @ts-check
/**
 * The model import e2e specs' shared parts: the bust fixture as a glTF
 * folder, a drop of files as the browser hands them, and the wait for a
 * dropped model's card from converting to optimized.
 */
import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
export function bustFolder(edit) {
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
 * Files dropped on the page (outside any row, or on the element
 * `selector` names), as the browser hands them.
 * @param {import("@playwright/test").Page} page
 * @param {{ name: string, type: string, bytes: Uint8Array }[]} files
 * @param {string} [selector]
 */
export async function dropOnPage(page, files, selector = "body") {
  await page.evaluate(
    ({ list, selector }) => {
      const target = document.querySelector(selector);
      if (target === null) throw new Error(`nothing at ${selector}`);
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
    },
    { list: files.map((f) => ({ ...f, bytes: [...f.bytes] })), selector },
  );
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
export async function expectConvertedAndOptimized(page, from) {
  const shelf = page.locator("#shell-shelf");
  /** The shelf's card named `name` (by its name, not its other words). */
  const named = (/** @type {string} */ name) =>
    shelf.locator(".as-card", {
      has: page.locator(".as-cname", { hasText: name }),
    });
  const importId = await named(from).getAttribute("data-aid");
  const importing = shelf.locator(`.as-card[data-aid="${importId}"]`);
  // Converting: the import's own card, until it is a file of the tour.
  await expect(importing.locator(".as-cstate")).toContainText(
    /Queued|Converting to a tour model/,
  );
  const made = named("bust.glb");
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
