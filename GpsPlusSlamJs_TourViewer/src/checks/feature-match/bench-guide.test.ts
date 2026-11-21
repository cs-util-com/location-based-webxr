import { describe, expect, it } from "vitest";

import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import { NO_PAIR, PAIRS } from "./bench-export";

const DASHES = /[‒-―]/;

// Why this test matters: the guidance card is what the photo tests are taken
// from on the phone; a pair without its purpose, steps or avoid line leaves
// the tester guessing from one dropdown line, which is the gap this closes.
describe("PAIR_GUIDE", () => {
  const keys = [...PAIRS.map((p) => p.key), NO_PAIR.key];

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

  it("names the spot repeats on the light pairs only", () => {
    for (const key of keys) {
      expect(PAIR_GUIDE[key].spotNote, key).toBe(key.startsWith("1"));
    }
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
