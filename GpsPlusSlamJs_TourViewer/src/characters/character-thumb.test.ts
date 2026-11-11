/**
 * When a character was made, in words, against a fixed clock.
 *
 * Why this test matters: the maker's library and the tour editor's list
 * both say when a character was made; the day boundary (the same calendar
 * day, not only 24 hours) is the part that is easy to get wrong.
 */
import { describe, expect, it } from "vitest";

import { whenMade } from "./character-thumb.js";

describe("whenMade", () => {
  const now = new Date(2026, 10, 10, 15, 0);
  it("says the time for one made today", () => {
    expect(whenMade(new Date(2026, 10, 10, 9, 5).toISOString(), now)).toBe(
      "made today, 09:05",
    );
  });
  it("says yesterday for one made late the evening before", () => {
    expect(whenMade(new Date(2026, 10, 9, 23, 0).toISOString(), now)).toBe(
      "made yesterday",
    );
  });
  it("counts the days after that", () => {
    expect(whenMade(new Date(2026, 10, 5, 12, 0).toISOString(), now)).toBe(
      "made 5 days ago",
    );
  });
});
