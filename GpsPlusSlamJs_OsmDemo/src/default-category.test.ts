/**
 * WHY THESE TESTS MATTER (DEC-G3).
 *
 * The value itself is one line and hardly needs a test; the FALLBACK does. The
 * category list is read from the published rule sheet at runtime, so "the table
 * has no `battleArea` column" is not hypothetical — a fixture that ships in
 * `data-and-caching.spec.js` has exactly one column, `walkable`. A bare literal
 * would leave that boot with a picker whose value matches no option, which the
 * DOM silently discards, and the demo would score against `""` for the rest of
 * the session.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORY, pickDefaultCategory } from "./default-category.js";

describe("pickDefaultCategory", () => {
  it("opens on the battle area when the table has one", () => {
    // The whole point of DEC-G3: a geo-event models a boss NPC, which belongs
    // on a battle area rather than on a pavement.
    expect(
      pickDefaultCategory([
        "battleArea",
        "spawnPoint",
        "treasureReward",
        "walkable",
      ]),
    ).toBe("battleArea");
  });

  it("finds it wherever it sits in the column order", () => {
    // The shipped sheet happens to put it first. Depending on that would make
    // this a test of the fixture rather than of the choice.
    expect(pickDefaultCategory(["walkable", "questGiver", "battleArea"])).toBe(
      DEFAULT_CATEGORY,
    );
  });

  it("falls back to the first column for a table without it", () => {
    // The real case: `data-and-caching.spec.js` boots `id,Key,Value,walkable`.
    expect(pickDefaultCategory(["walkable"])).toBe("walkable");
  });

  it("returns the empty string for no categories at all", () => {
    // What an empty `<select>` reports, so the caller assigns a value the DOM
    // already agrees with instead of one it will discard.
    expect(pickDefaultCategory([])).toBe("");
  });
});
