// @ts-check
import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

/**
 * A tour of an older format (the archive server's
 * `/ranges-ok/v3-tour.zip`, a format 3 tour), end to end on both creator
 * pages: refused in plain words, and the draft this browser kept for it -
 * which has nothing left to be restored into - deleted, the refusal saying
 * so. Another tour's draft stays: it is its creator's unsaved work.
 */

const V3_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/v3-tour.zip";
const OTHER_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
const REFUSED =
  "This tour is in an older format (version 3) that this version of the app no longer opens; it has to be made again";
const LOST = `${REFUSED}, and its unsaved changes cannot be restored.`;

/**
 * Write a small draft (its meta and one object record) into the draft
 * namespace `namespace` of the page's origin.
 * @param {import("@playwright/test").Page} page
 * @param {string} namespace
 */
async function seedDraft(page, namespace) {
  await page.evaluate(async (ns) => {
    const root = await navigator.storage.getDirectory();
    const drafts = await root.getDirectoryHandle("drafts", { create: true });
    const dir = await drafts.getDirectoryHandle(encodeURIComponent(ns), {
      create: true,
    });
    for (const [key, text] of [
      ["meta", JSON.stringify({ tourUrl: ns, sizeM: 0.16, level: null })],
      ["object:oldpin", JSON.stringify({ id: "oldpin" })],
    ]) {
      const handle = await dir.getFileHandle(
        `${encodeURIComponent(String(key))}.blob`,
        { create: true },
      );
      const writable = await handle.createWritable();
      await writable.write(String(text));
      await writable.close();
    }
  }, namespace);
}

/**
 * The files of draft namespace `namespace`, sorted (none for a namespace
 * that does not exist).
 * @param {import("@playwright/test").Page} page
 * @param {string} namespace
 * @returns {Promise<string[]>}
 */
function draftFiles(page, namespace) {
  return page.evaluate(async (ns) => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await (
        await root.getDirectoryHandle("drafts")
      ).getDirectoryHandle(encodeURIComponent(ns));
      /** @type {string[]} */
      const names = [];
      // @ts-expect-error - the async iterator is not in every DOM typing.
      for await (const name of dir.keys()) names.push(name);
      return names.sort();
    } catch {
      return [];
    }
  }, namespace);
}

/**
 * The key a page gives a tour opened from a file (`tour-file-key.ts`):
 * "local-file:" and the first 32 hex digits of the SHA-256 of its sorted
 * entry lines, `name NUL size NUL CRC-32`.
 * @param {Uint8Array} zip
 */
async function fileKeyOf(zip) {
  const reader = new ZipReader(new Uint8ArrayReader(zip));
  const lines = (await reader.getEntries())
    .filter((e) => !e.directory)
    .map(
      (e) =>
        `${e.filename}\u0000${String(e.uncompressedSize)}\u0000${String(e.signature)}`,
    )
    .sort();
  await reader.close();
  const hex = createHash("sha256").update(lines.join("\n")).digest("hex");
  return `local-file:${hex.slice(0, 32)}`;
}

test("the phone refuses a tour of an older format and deletes its draft, and no other", async ({
  page,
}) => {
  // Why this test matters: the creator who opens that tour's link again is
  // the one moment its draft can be found by its key (nothing scans the
  // device); a refusal that left it would offer nothing and keep it
  // forever, and one that took another tour's would lose real work.
  await page.goto("/?nocache=1");
  await seedDraft(page, V3_ARCHIVE);
  await seedDraft(page, OTHER_ARCHIVE);
  await page.getByTestId("link-input").fill(V3_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("error")).toHaveText(LOST, {
    timeout: 15000,
  });
  expect(await draftFiles(page, V3_ARCHIVE)).toEqual([]);
  expect(await draftFiles(page, OTHER_ARCHIVE)).toEqual([
    "meta.blob",
    "object%3Aoldpin.blob",
  ]);
  await expect(page.getByTestId("draft-offer")).toBeHidden();
});

test("the editor refuses a tour of an older format and deletes its draft, and no other", async ({
  page,
}) => {
  // Why this test matters: the editor's draft of a file is found by the
  // file's key; the refusal is the creator's one chance to learn that the
  // unsaved work it held is gone, and why.
  const zip = new Uint8Array(await (await fetch(V3_ARCHIVE)).arrayBuffer());
  const key = await fileKeyOf(zip);
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose: the
    // file input opens.
    delete window.showOpenFilePicker;
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/edit.html");
  await seedDraft(page, `editor:${key}`);
  await seedDraft(page, "editor:local-file:00000000000000000000000000000002");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (
    await chooser
  ).setFiles({
    name: "older.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await expect(page.locator("#open-error")).toHaveText(LOST, {
    timeout: 15000,
  });
  expect(await draftFiles(page, `editor:${key}`)).toEqual([]);
  expect(
    await draftFiles(
      page,
      "editor:local-file:00000000000000000000000000000002",
    ),
  ).toHaveLength(2);
});
