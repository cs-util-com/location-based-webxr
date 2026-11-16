import { describe, expect, it } from "vitest";

import { fallbackBuildingsNote } from "./fallback-note.js";

/**
 * Why these tests matter: the note is the only place a viewer learns that some
 * buildings were drawn simpler than planned, now that one such building no
 * longer fails the whole city. It must say nothing when there are none, and
 * never print "undefined" or "NaN" on the status line.
 */
describe("fallbackBuildingsNote", () => {
  it("says nothing when every building was drawn as built", () => {
    expect(fallbackBuildingsNote(0)).toBe("");
  });

  it("names one building in the singular", () => {
    expect(fallbackBuildingsNote(1)).toBe("1 building simplified or left out");
  });

  it("names many buildings in the plural", () => {
    expect(fallbackBuildingsNote(3)).toBe("3 buildings simplified or left out");
  });

  it("reads a count that is not a positive number as none", () => {
    expect(fallbackBuildingsNote(-1)).toBe("");
    expect(fallbackBuildingsNote(Number.NaN)).toBe("");
    expect(fallbackBuildingsNote(undefined as unknown as number)).toBe("");
  });
});
