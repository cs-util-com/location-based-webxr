/**
 * Ranking the elements that produced a cell's score.
 *
 * Why these tests matter:
 * The old list sorted contributors DESCENDING by factor and cut at 8. A hard
 * veto has factor `0`, so it sorted last and was the first thing dropped — the
 * "why is this cell zero?" question was the one the UI was worst at answering,
 * which is precisely the question the owner asked of a cemetery tile.
 *
 * The obvious repair, "rank by distance from 1", fails the same case more
 * quietly: a veto scores `|0 - 1| = 1`, so a single 5x contributor outranks it
 * and the veto is dropped again. Ranking by `|log(factor)|` puts `0` at infinity
 * and makes `0.5` and `2.0` equally interesting — the same equal-ratio logic the
 * colour ramp already applies to the same numbers.
 *
 * @see contributor-order.ts.md
 */

import { describe, it, expect } from "vitest";

import { rankContributors } from "./contributor-order.js";

const keys = (contributors: Record<string, number>) =>
  rankContributors(contributors).map((c) => c.key);

describe("rankContributors", () => {
  it("puts a veto first, ahead of ten mildly positive contributors", () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`way/${i}`, 1.1]),
    );
    expect(keys({ ...many, "way/veto": 0 })[0]).toBe("way/veto");
  });

  it("puts a veto first even against a strongly positive contributor", () => {
    // THE case `|factor - 1|` gets wrong: |0-1| = 1 loses to |5-1| = 4.
    expect(keys({ "way/strong": 5, "way/veto": 0 })).toEqual([
      "way/veto",
      "way/strong",
    ]);
  });

  it("ranks equal ratios equally — 0.5 and 2 are the same size of claim", () => {
    // A multiplicative model has no privileged direction: halving and doubling
    // are the same magnitude of statement, and the log ramp already says so.
    const ranked = rankContributors({ "way/half": 0.5, "way/double": 2 });
    expect(ranked[0]?.rank).toBeCloseTo(ranked[1]?.rank ?? 0, 12);
  });

  it("puts 'touched it and said nothing' last, without dropping it", () => {
    // Factor 1 is real information — "this feature is here and the table has no
    // opinion about it" — but it is never the answer to "why is this cell 0?".
    const ranked = rankContributors({
      "way/silent": 1,
      "way/weak": 1.2,
      "way/veto": 0,
    });
    expect(ranked.map((c) => c.key)).toEqual([
      "way/veto",
      "way/weak",
      "way/silent",
    ]);
    expect(ranked).toHaveLength(3);
  });

  it("returns every contributor — truncation is the caller's choice, not this function's", () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`way/${i}`, 1 + i / 10]),
    );
    expect(rankContributors(many)).toHaveLength(40);
  });

  it("is deterministic for equal ranks, so the list does not shuffle on redraw", () => {
    const input = { "way/3": 2, "way/1": 2, "way/2": 2 };
    expect(keys(input)).toEqual(keys(input));
    expect(keys(input)).toEqual(["way/1", "way/2", "way/3"]);
  });

  it("survives a nonsense factor from a bad sheet edit, ranking it last", () => {
    // Multipliers come from a publicly editable Google Sheet. `Math.log` of a
    // negative is NaN, and a NaN comparator makes `sort` produce arbitrary
    // order — which would silently scramble the whole list, not just that row.
    const ranked = rankContributors({
      "way/bad": -3,
      "way/veto": 0,
      "way/good": 4,
    });
    expect(ranked.map((c) => c.key)).toEqual([
      "way/veto",
      "way/good",
      "way/bad",
    ]);
  });

  it("handles an empty contributor map", () => {
    expect(rankContributors({})).toEqual([]);
  });
});
