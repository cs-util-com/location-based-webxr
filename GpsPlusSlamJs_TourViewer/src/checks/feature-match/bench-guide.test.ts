import { describe, expect, it } from "vitest";

import { BEFORE_YOU_START, SPOT_NOTE } from "./bench-guide";

const DASHES = /[‒-―]/;

// Why this test matters: "Before you start" is the one place the general
// rules are shown; a rule the tester misses (rotation unlocked, a face in
// the picture, a plain wall) spoils every shot after it.
describe("BEFORE_YOU_START", () => {
  it("keeps the general rules the tester must not miss", () => {
    const text = BEFORE_YOU_START.join(" ");
    for (const phrase of [
      "Lock the screen rotation",
      "Download all",
      "no faces",
      "plain white wall",
      "scene",
    ]) {
      expect(text).toContain(phrase);
    }
  });

  // Why: the texts are set as plain text; markup would show its tags, and
  // the page's writing rule allows plain hyphens only.
  it("is plain text with plain hyphens", () => {
    for (const t of [...BEFORE_YOU_START, SPOT_NOTE]) {
      expect(t.trim(), t).not.toBe("");
      expect(t, t).not.toMatch(DASHES);
      expect(t, t).not.toMatch(/[<>]/);
    }
  });

  // Why: "do not touch the phone" contradicts the tap, and a phone lying
  // flat films the table; the rules ask for a stand.
  it("asks for a stand, never an untouched phone", () => {
    const text = BEFORE_YOU_START.join(" ");
    expect(text).toMatch(/stand/);
    expect(text).not.toMatch(/touch|lay the phone|lying/i);
  });
});

describe("SPOT_NOTE", () => {
  // Why: the light scene repeats at up to 3 places; the note is the only
  // hint that the phone moves to another part of the room after L4.
  it("says to move on after L4 and that L1 comes up by itself", () => {
    expect(SPOT_NOTE).toContain("L4");
    expect(SPOT_NOTE).toContain("L1");
    expect(SPOT_NOTE).toMatch(/3 places/);
  });
});
