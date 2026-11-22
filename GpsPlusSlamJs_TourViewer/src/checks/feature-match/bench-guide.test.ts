import { describe, expect, it } from "vitest";

import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import { PAIRS } from "./bench-export";

const DASHES = /[\u2012-\u2015]/;

// Why this test matters: the guidance card is what the photo tests are taken
// from on the phone; a pair without its purpose, steps or avoid line leaves
// the tester guessing from one dropdown line, which is the gap this closes.
describe("PAIR_GUIDE", () => {
  const keys = PAIRS.map((p) => p.key);

  it("has a complete entry for every pair, and for no other key", () => {
    expect(Object.keys(PAIR_GUIDE).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const g = PAIR_GUIDE[key];
      expect(g.purpose.trim(), key).not.toBe("");
      expect(g.steps.length, key).toBeGreaterThan(0);
      for (const s of g.steps) {
        expect(s.trim(), key).not.toBe("");
        // The card numbers the steps itself.
        expect(s, key).not.toMatch(/^\d+\./);
      }
      expect(g.avoid.trim(), key).not.toBe("");
    }
  });

  // Why this test matters: on the first evening the light was dimmed
  // before photo A, so A and B were equally dark; the order must be the
  // first thing the card says, in bold.
  it("opens the dimmed pairs with the order of light and photos, in bold", () => {
    for (const key of ["1b", "1c"] as const) {
      expect(PAIR_GUIDE[key].strongSteps, key).toBe(2);
      expect(PAIR_GUIDE[key].steps.slice(0, 2), key).toEqual([
        "Photo A with the light ON as normal.",
        "Then dim the light, wait 2 seconds, then photo B.",
      ]);
      expect(PAIR_GUIDE[key].purpose, key).toMatch(/^Same place as 1a/);
      // The camera brightens a dim picture by itself: the card says so.
      expect(PAIR_GUIDE[key].steps.join(" "), key).toContain(
        "brightens a dim picture",
      );
    }
    for (const key of keys.filter((k) => k !== "1b" && k !== "1c")) {
      expect(PAIR_GUIDE[key].strongSteps, key).toBe(0);
    }
  });

  it("names the spot repeats on the light pairs only", () => {
    for (const key of keys) {
      expect(PAIR_GUIDE[key].spotNote, key).toBe(key.startsWith("1"));
    }
  });

  // Why this test matters: "do not touch the phone" contradicts the photo
  // tap, and a phone lying flat films the table; the steps must ask for
  // what can be done.
  it("asks for a propped-up phone that is not moved, never untouched", () => {
    const all = Object.values(PAIR_GUIDE)
      .flatMap((g) => [g.purpose, g.avoid, ...g.steps])
      .join(" ");
    expect(all).not.toMatch(/touch|lay the phone|lying/i);
    expect(PAIR_GUIDE["1a"].steps[0]).toMatch(/^Prop the phone up/);
  });

  it("is plain text with plain hyphens", () => {
    const all = [
      ...BEFORE_YOU_START,
      SPOT_NOTE,
      ...Object.values(PAIR_GUIDE).flatMap((g) => [
        g.purpose,
        g.avoid,
        ...g.steps,
      ]),
    ];
    for (const t of all) {
      expect(t, t).not.toMatch(DASHES);
      expect(t, t).not.toMatch(/[<>]/);
    }
  });

  it("keeps the general rules the tester must not miss", () => {
    const text = BEFORE_YOU_START.join(" ");
    for (const phrase of [
      "Lock the screen rotation",
      "Download all",
      "no faces",
      "plain white wall",
    ]) {
      expect(text).toContain(phrase);
    }
  });
});
