/**
 * Why these tests matter (code book plan, M6 v5; owner decisions before the
 * AFK days: the system decides by itself whether a poster moved, one
 * reliable walk is enough, a code seen again at its OLD spot was a second
 * copy and the move is undone). Four paper designs failed review on exactly
 * these cases: a second print that keeps moving the code, an undo that never
 * fires, a band where neither rule holds. The rule is pure, so each case is
 * pinned here with plain distances; the settle only measures them.
 */
import { describe, expect, it } from "vitest";

import {
  applyCodeSpotDecision,
  decideCodeSpot,
  MAX_CODE_COPIES,
  nearestSpot,
  type CodeSpotMemory,
  type SightingFit,
  type SpotRef,
} from "./code-spots";

const FLOOR = 20;
const current: SpotRef = { kind: "current" };
const previous: SpotRef = { kind: "previous" };
const copy = (index: number): SpotRef => ({ kind: "copy", index });

/** A sighting whose fit reads these distances (m) from the known spots. */
const seen = (...d: [SpotRef, number][]): SightingFit => ({
  distancesM: d.map(([spot, m]) => ({ spot, m })),
});
const unjudged: SightingFit = { distancesM: [] };

const judge = (
  sightings: SightingFit[],
  over: Partial<Parameters<typeof decideCodeSpot>[0]> = {},
) =>
  decideCodeSpot({
    sightings,
    candidateDistancesM: [40],
    reliable: true,
    frameChanged: false,
    floorM: FLOOR,
    ...over,
  });

describe("nearestSpot - the nearest known spot within the floor", () => {
  it("picks the nearest spot whose fit is within the floor", () => {
    expect(nearestSpot(seen([current, 25], [previous, 3]), FLOOR)).toEqual(
      previous,
    );
    expect(
      nearestSpot(seen([current, 12], [copy(0), 9], [previous, 30]), FLOOR),
    ).toEqual(copy(0));
  });

  // The v4 band: 8-20 m from a copy was neither "seen at it" nor safe from
  // a move. With the floor as the only radius there is no band.
  it("belongs to a spot anywhere under the floor, and to none at or beyond it", () => {
    expect(nearestSpot(seen([current, 19.9]), FLOOR)).toEqual(current);
    expect(nearestSpot(seen([current, 20]), FLOOR)).toBe("new");
    expect(nearestSpot(seen([current, 45], [copy(1), 21]), FLOOR)).toBe("new");
  });

  it("judges nothing without a gated fit", () => {
    expect(nearestSpot(unjudged, FLOOR)).toBeNull();
  });

  it("prefers the current spot on an exact tie (no automatic change)", () => {
    expect(nearestSpot(seen([previous, 5], [current, 5]), FLOOR)).toEqual(
      current,
    );
  });
});

describe("decideCodeSpot - the four outcomes", () => {
  it("moves a code seen beyond the floor of every known spot", () => {
    expect(judge([seen([current, 30], [copy(0), 45])])).toEqual({
      kind: "move",
    });
  });

  it("undoes a move when the code is seen nearest its spot before it", () => {
    expect(judge([seen([current, 24], [previous, 2])])).toEqual({
      kind: "undo",
    });
  });

  it("leaves a code seen at a known second print alone", () => {
    expect(judge([seen([current, 30], [copy(2), 4])])).toEqual({
      kind: "copy",
      index: 2,
    });
  });

  it("does nothing for a code seen at its current spot", () => {
    expect(judge([seen([current, 6], [previous, 25])])).toEqual({
      kind: "none",
      reason: "at-current",
    });
  });

  // v3 review #1 counterexample C, v2 review #12: a visit that saw the code
  // at home too was looking at a second print, whatever it saw last.
  it("never changes a code that the visit ALSO saw at its current spot", () => {
    expect(
      judge([seen([current, 3]), seen([current, 40], [previous, 1])]),
    ).toEqual({ kind: "none", reason: "at-current" });
    expect(judge([seen([current, 2]), seen([current, 50])])).toEqual({
      kind: "none",
      reason: "at-current",
    });
  });

  it("judges the LATEST judged sighting otherwise", () => {
    expect(
      judge([seen([current, 40], [copy(0), 2]), seen([current, 30]), unjudged]),
    ).toEqual({ kind: "move" });
  });

  // v4 review #2: the move mints the candidate, so the candidate must be
  // clear of every known spot as well, or two spots could end up closer
  // than the floor.
  it("does not move when the minted pose would land within the floor of a known spot", () => {
    expect(
      judge([seen([current, 22])], { candidateDistancesM: [19, 50] }),
    ).toEqual({ kind: "none", reason: "near-known" });
  });

  it.each([
    ["an unreliable walk", { reliable: false }],
    ["an odometry frame change in the visit", { frameChanged: true }],
  ])("judges nothing after %s", (_name, over) => {
    expect(judge([seen([current, 40], [previous, 1])], over)).toEqual({
      kind: "none",
      reason: "not-judged",
    });
  });

  it("judges nothing without a gated fit", () => {
    expect(judge([unjudged])).toEqual({ kind: "none", reason: "not-judged" });
    expect(judge([])).toEqual({ kind: "none", reason: "not-judged" });
  });

  it("rejects a non-positive or non-finite floor", () => {
    expect(() => judge([seen([current, 3])], { floorM: 0 })).toThrow();
    expect(() => judge([seen([current, 3])], { floorM: Number.NaN })).toThrow();
  });
});

describe("applyCodeSpotDecision - the memory on the level", () => {
  const before: CodeSpotMemory<string> = {
    current: "T",
    previous: null,
    copies: ["Q"],
  };

  it("a move keeps the old spot as previous and the copies as they were", () => {
    expect(applyCodeSpotDecision(before, { kind: "move" }, "N")).toEqual({
      current: "N",
      previous: "T",
      copies: ["Q"],
    });
  });

  it("an undo restores previous exactly and keeps the moved-to spot as a copy", () => {
    const moved = applyCodeSpotDecision(before, { kind: "move" }, "F");
    expect(applyCodeSpotDecision(moved, { kind: "undo" }, "unused")).toEqual({
      current: "T",
      previous: null,
      copies: ["Q", "F"],
    });
  });

  it("keeps at most MAX_CODE_COPIES copies, dropping the oldest", () => {
    let m: CodeSpotMemory<string> = {
      current: "T",
      previous: null,
      copies: [],
    };
    for (let i = 0; i < MAX_CODE_COPIES + 2; i += 1) {
      m = applyCodeSpotDecision(m, { kind: "move" }, `F${String(i)}`);
      m = applyCodeSpotDecision(m, { kind: "undo" }, "unused");
    }
    expect(m.current).toBe("T");
    expect(m.copies).toHaveLength(MAX_CODE_COPIES);
    expect(m.copies.at(-1)).toBe(`F${String(MAX_CODE_COPIES + 1)}`);
  });

  it("leaves the memory unchanged otherwise", () => {
    for (const d of [
      { kind: "copy", index: 0 } as const,
      { kind: "none", reason: "at-current" } as const,
    ])
      expect(applyCodeSpotDecision(before, d, "X")).toBe(before);
  });

  it("an undo without a previous spot is refused", () => {
    expect(() =>
      applyCodeSpotDecision(before, { kind: "undo" }, "unused"),
    ).toThrow();
  });
});
