/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, M4b): the
 * desktop editor holds its last save as bytes in memory. Two features read
 * them directly - a deleted photo's picture when the opened file no longer
 * reads (M4a review #5), and "move the walk out", which must know every
 * entry the newest bytes carry. Both depend on reading exactly the names
 * and bytes the zip holds, and on a name it lacks being an error, never an
 * empty picture.
 */
import { describe, expect, it } from "vitest";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  ArchiveLimitError,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";

import {
  readZipBlobEntry,
  withZipBlobDirectory,
  zipBlobEntryNames,
} from "./zip-blob.js";

describe("zipBlobEntryNames / readZipBlobEntry", () => {
  it("lists every file entry in archive order, and reads one by name", async () => {
    const zip = await packFilesAsZip([
      { path: "tour.json", data: "{}" },
      { path: "content/a.jpg", data: "picture a" },
      { path: "actions/0001.json", data: "[]" },
    ]);
    expect(await zipBlobEntryNames(zip)).toEqual([
      "tour.json",
      "content/a.jpg",
      "actions/0001.json",
    ]);
    const blob = await readZipBlobEntry(zip, "content/a.jpg");
    expect(await blob.text()).toBe("picture a");
  });

  it("refuses a name the zip does not carry, and bytes that are no zip", async () => {
    const zip = await packFilesAsZip([{ path: "tour.json", data: "{}" }]);
    await expect(readZipBlobEntry(zip, "content/gone.jpg")).rejects.toThrow(
      /content\/gone\.jpg/,
    );
    await expect(zipBlobEntryNames(new Blob(["not a zip"]))).rejects.toThrow();
  });
});

// Why: the editor's file classifier reads a dropped file's directory once
// and an entry or none - its names, declared sizes and one read must be the
// zip's own, and a name it lacks an error.
describe("withZipBlobDirectory", () => {
  it("hands over the names, declared sizes and one read in a single directory pass", async () => {
    const zip = await packFilesAsZip([
      { path: "a.txt", data: "12345" },
      { path: "b/c.txt", data: "xy" },
    ]);
    const seen = await withZipBlobDirectory(zip, async (dir) => ({
      names: [...dir.names],
      sizes: dir.names.map((n) => dir.sizeOf(n)),
      missing: dir.sizeOf("nope"),
      text: await (await dir.read("b/c.txt")).text(),
      refused: await dir.read("nope").then(
        () => "read",
        (err: unknown) => String(err),
      ),
    }));
    expect(seen).toEqual({
      names: ["a.txt", "b/c.txt"],
      sizes: [5, 2],
      missing: undefined,
      text: "xy",
      refused: expect.stringMatching(/nope/),
    });
  });

  // Why: a file given to the editor is untrusted. An entry deflated from
  // 8 MiB of zeros is a few kB in the zip; without its own cap it inflates
  // whole (the archive's budget is tens of MiB), and a caller that caps
  // it must be stopped near the cap, not after the whole of it.
  it("stops inflating an entry at its own cap, near the cap", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      level: 9,
    });
    await writer.add(
      "bomb.json",
      new Uint8ArrayReader(new Uint8Array(8 << 20)),
    );
    const zip = await writer.close();
    expect(zip.size).toBeLessThan(64 * 1024);
    const [whole, capped] = await withZipBlobDirectory(zip, async (dir) => [
      (await dir.read("bomb.json")).size,
      await dir.read("bomb.json", 16 * 1024).then(
        () => null,
        (err: unknown) => err,
      ),
    ]);
    expect(whole).toBe(8 << 20);
    expect(capped).toBeInstanceOf(ArchiveLimitError);
    const limit = capped as ArchiveLimitError;
    expect(limit.kind).toBe("entry-bytes");
    // The bytes inflated before it stopped: one chunk past the cap at most.
    expect(limit.observed).toBeGreaterThan(16 * 1024);
    expect(limit.observed).toBeLessThan(1 << 20);
  });

  // Why: a zip may carry one name twice; listing it once would hide the
  // second, and a reader asking "is there exactly one?" would be told yes.
  it("lists a name the zip carries twice twice", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      level: 0,
    });
    await writer.add("a.json", new TextReader("1"));
    await writer.add("a.jsox", new TextReader("2"));
    const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    // Both headers of the second entry renamed in place, to the first's.
    const from = new TextEncoder().encode("a.jsox");
    for (let i = 0; i + from.length <= bytes.length; i++) {
      if (from.every((b, k) => bytes[i + k] === b)) bytes[i + 5] = 0x6e; // "n"
    }
    const names = await withZipBlobDirectory(new Blob([bytes]), (dir) =>
      Promise.resolve([...dir.names]),
    );
    expect(names).toEqual(["a.json", "a.json"]);
  });
});
