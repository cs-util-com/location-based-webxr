import { describe, expect, it } from "vitest";

import {
  CHARACTER_FORMAT,
  importedRecordOf,
  nameProblem,
  newLibraryId,
  nextGuideName,
  recordOf,
} from "./character-record.js";

const GOOD = {
  format: 1,
  libraryId: "c1abc",
  name: "Ranger Rita",
  autoName: false,
  createdAtIso: "2026-11-10T08:00:00.000Z",
  steady: false,
  describedAs: "a fox",
  tool: "character maker",
};

describe("character-record", () => {
  // Why: the library lists only what reads as a record; a damaged
  // character.json must count as an interrupted save, never crash the list.
  it("reads a good record and refuses a broken one", () => {
    expect(recordOf(GOOD)).toEqual(GOOD);
    expect(recordOf({ ...GOOD, name: "" })).toBeNull();
    expect(recordOf({ ...GOOD, libraryId: 3 })).toBeNull();
    expect(recordOf({ ...GOOD, createdAtIso: "yesterday" })).toBeNull();
    expect(recordOf({ ...GOOD, format: 2 })).toBeNull();
    expect(recordOf(null)).toBeNull();
    expect(recordOf("x")).toBeNull();
  });

  // Why: unknown keys from a file must not ride along into the library.
  it("drops unknown keys", () => {
    expect(recordOf({ ...GOOD, extra: 1 })).toEqual(GOOD);
  });

  // Why: the format refuses an empty name and the field caps it at 40, so
  // rename says why with words instead of saving what a tour cannot hold.
  it("says what is wrong with a name", () => {
    expect(nameProblem("  ")).toBe("A name needs at least one letter.");
    expect(nameProblem("x".repeat(41))).toBe(
      "A name can have up to 40 letters.",
    );
    expect(nameProblem(" Pip ")).toBeNull();
  });

  // Why: a character saved without a name gets the first free "Guide N".
  it("finds the first free guide name", () => {
    expect(nextGuideName([])).toBe("Guide 1");
    expect(nextGuideName(["Guide 1", "Guide 3"])).toBe("Guide 2");
  });

  // Why: library ids name folders; they must be safe file names and differ
  // for two saves in one millisecond.
  it("makes folder-safe ids", () => {
    const a = newLibraryId(1_700_000_000_000, () => 0.25);
    const b = newLibraryId(1_700_000_000_000, () => 0.5);
    expect(a).toMatch(/^c[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });

  describe("a record read from a file", () => {
    // Why: an exchange file is untrusted; only the known fields of the right
    // type are taken, and a newer format is told apart so the import can
    // refuse it with words.
    it("takes the known fields and flags a newer format", () => {
      expect(
        importedRecordOf({
          format: 1,
          name: " Pip ",
          steady: true,
          describedAs: "d",
          x: 1,
        }),
      ).toEqual({ kind: "ok", name: "Pip", steady: true, describedAs: "d" });
      expect(
        importedRecordOf({ format: CHARACTER_FORMAT + 1, name: "Pip" }),
      ).toEqual({
        kind: "newer",
      });
      expect(importedRecordOf({ name: "Pip" })).toEqual({ kind: "unreadable" });
      expect(importedRecordOf({ format: 1, name: 7, steady: "yes" })).toEqual({
        kind: "ok",
        name: "",
        steady: false,
        describedAs: "",
      });
    });

    // Why: a name longer than the field's cap is shortened, not refused.
    it("caps the name at 40", () => {
      const r = importedRecordOf({ format: 1, name: "y".repeat(60) });
      expect(r.kind === "ok" && r.name.length).toBe(40);
    });
  });
});
