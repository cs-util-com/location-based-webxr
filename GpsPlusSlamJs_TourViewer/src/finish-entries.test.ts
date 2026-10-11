/**
 * Why these tests matter (code book refactor plan M1): the Finish's list
 * of files to write was assembled inline for exactly one code. Extracted
 * and taking a LIST of levels, it is what lets M4 write every changed code
 * - and it must keep the rules the inline code had: a level the zip
 * already holds is replaced where it is (a wrapped zip keeps its folder,
 * no stale duplicate at the root), a listed tour's new level goes inside
 * the tour's folder (its signed list can name it), others at the root.
 */
import { describe, expect, it } from "vitest";
import { qrLevelEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";

import { finishEntries } from "./finish-entries";

const A = "a1b2c3d4e5f6";
const B = "0f1e2d3c4b5a";

const base = {
  entryNames: [] as string[],
  levels: [{ id: A, json: "level-a" }],
  wrap: "",
  listed: false,
  manifestPath: "tour.json",
  manifestJson: "manifest",
  photos: [] as { image: string; blob: Blob }[],
};

describe("finishEntries", () => {
  it("writes a new level at the root, then the manifest", () => {
    expect(finishEntries(base)).toEqual([
      { path: qrLevelEntryName(A), data: "level-a" },
      { path: "tour.json", data: "manifest" },
    ]);
  });

  it("replaces a level the zip holds where it is, also in a wrapped zip", () => {
    const wrapped = `mytour/${qrLevelEntryName(A)}`;
    const entries = finishEntries({
      ...base,
      entryNames: [wrapped, "mytour/tour.json"],
      wrap: "mytour/",
      manifestPath: "mytour/tour.json",
    });
    expect(entries[0]).toEqual({ path: wrapped, data: "level-a" });
  });

  it("puts a listed tour's new level inside the tour's folder", () => {
    expect(
      finishEntries({ ...base, wrap: "mytour/", listed: true })[0]?.path,
    ).toBe(`mytour/${qrLevelEntryName(A)}`);
    // Unlisted: the root, as before.
    expect(finishEntries({ ...base, wrap: "mytour/" })[0]?.path).toBe(
      qrLevelEntryName(A),
    );
  });

  it("replaces a level a listed tour already holds where it is (the held path beats the folder rule)", () => {
    const held = qrLevelEntryName(A);
    expect(
      finishEntries({
        ...base,
        entryNames: [held],
        wrap: "mytour/",
        listed: true,
      })[0]?.path,
    ).toBe(held);
  });

  it("writes every level it is given (M4: several codes per Finish)", () => {
    const entries = finishEntries({
      ...base,
      levels: [
        { id: A, json: "level-a" },
        { id: B, json: "level-b" },
      ],
    });
    expect(entries.map((e) => e.path)).toEqual([
      qrLevelEntryName(A),
      qrLevelEntryName(B),
      "tour.json",
    ]);
  });

  it("writes no level for none (a Finish that changed only objects)", () => {
    expect(finishEntries({ ...base, levels: [] })).toEqual([
      { path: "tour.json", data: "manifest" },
    ]);
  });

  it("adds each photo's bytes under the tour's folder", () => {
    const blob = new Blob(["jpg"]);
    const entries = finishEntries({
      ...base,
      wrap: "mytour/",
      photos: [{ image: "content/p1.jpg", blob }],
    });
    expect(entries.at(-1)).toEqual({
      path: "mytour/content/p1.jpg",
      data: blob,
    });
  });
});
