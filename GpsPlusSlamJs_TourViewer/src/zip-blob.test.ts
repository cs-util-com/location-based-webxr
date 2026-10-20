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
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { readZipBlobEntry, zipBlobEntryNames } from "./zip-blob.js";

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
