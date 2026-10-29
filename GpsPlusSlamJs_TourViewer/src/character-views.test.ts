import { describe, expect, it } from "vitest";

import {
  BUBBLE_OPEN_M,
  POPUP_CLOSE_M,
  POPUP_UNFOLD_M,
  beckonNext,
  bubbleOpens,
  bubbleSide,
  characterViewLook,
  isStageCharacterView,
  lineReadingMs,
  popupUnfolds,
  readingFloor,
} from "./character-views";

const walk = (
  order: "fixed" | "any",
  states: Readonly<Record<string, "waiting" | "found" | "done">>,
) => ({
  order,
  stations: Object.entries(states).map(([id, state]) => ({ id, state })),
});

describe("beckonNext", () => {
  // Why this test matters: the plan's rule is "the character points along
  // the tour order when exactly one next station exists, otherwise there
  // is no beckon" - under a fixed order that is the next station the walk
  // will offer, never a done one.
  it("points at the next undone station in a fixed order", () => {
    const p = walk("fixed", {
      a: "done",
      b: "found",
      c: "waiting",
      d: "waiting",
    });
    expect(beckonNext(p, "b")).toBe("c");
  });

  it("skips a station already done further down a fixed order", () => {
    const p = walk("fixed", { a: "found", b: "done", c: "waiting" });
    expect(beckonNext(p, "a")).toBe("c");
  });

  it("has no beckon at the last station of a fixed order", () => {
    const p = walk("fixed", { a: "done", b: "found" });
    expect(beckonNext(p, "b")).toBeNull();
  });

  // Why this test matters: under "any" order the visitor chooses; a
  // character pointing at one of several stations would be telling them
  // which to take, so he beckons only when one remains.
  it("beckons in an any order only when exactly one other remains", () => {
    expect(
      beckonNext(walk("any", { a: "found", b: "waiting", c: "waiting" }), "a"),
    ).toBeNull();
    expect(
      beckonNext(walk("any", { a: "found", b: "done", c: "waiting" }), "a"),
    ).toBe("c");
    expect(beckonNext(walk("any", { a: "found", b: "done" }), "a")).toBeNull();
  });

  it("reads a station the walk does not hold as having no next", () => {
    expect(beckonNext(walk("fixed", { a: "waiting" }), "zz")).toBe("a");
    expect(beckonNext(walk("any", {}), "zz")).toBeNull();
  });
});

describe("the open distances", () => {
  // Why this test matters: the prototype's distances, pinned so a change
  // to them is a decision, not a drift.
  it("opens the bubble within 9 m and shows the name tag farther", () => {
    expect(BUBBLE_OPEN_M).toBe(9);
    expect(bubbleOpens(8.99)).toBe(true);
    expect(bubbleOpens(9)).toBe(false);
    expect(bubbleOpens(Number.NaN)).toBe(false);
  });

  it("unfolds the pop-up within 12 m and keeps it until 16 m", () => {
    expect([POPUP_UNFOLD_M, POPUP_CLOSE_M]).toEqual([12, 16]);
    expect(popupUnfolds(11.9, false)).toBe(true);
    expect(popupUnfolds(14, false)).toBe(false);
    expect(popupUnfolds(14, true)).toBe(true);
    expect(popupUnfolds(16, true)).toBe(false);
  });

  it("keeps the reading floor at 1 within 2.4 m and grows it farther", () => {
    expect(readingFloor(1)).toBe(1);
    expect(readingFloor(2.4)).toBe(1);
    expect(readingFloor(4.8)).toBeCloseTo(2);
    expect(readingFloor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("bubbleSide", () => {
  it("hangs toward the middle of the screen", () => {
    expect(bubbleSide({ x: -0.4, width: 0.3, last: null }).side).toBe("right");
    expect(bubbleSide({ x: 0.4, width: 0.3, last: null }).side).toBe("left");
  });

  it("flips to the side with room and reports what still overflows", () => {
    // At the switch point a wide bubble to his right would leave the
    // screen by 0.13, to his left by 0.03: it goes left and slides 0.03.
    const wide = bubbleSide({ x: 0.05, width: 1.05, last: null });
    expect(wide.side).toBe("left");
    expect(wide.overflow).toBeCloseTo(-0.03);
    expect(bubbleSide({ x: 0, width: 0.2, last: null }).overflow).toBe(0);
  });

  // Why this test matters: without hysteresis a figure near the centre
  // flips the bubble every frame as the phone shakes.
  it("keeps its side until the other is clearly better", () => {
    expect(bubbleSide({ x: 0.3, width: 0.5, last: "right" }).side).toBe(
      "right",
    );
    expect(bubbleSide({ x: -0.3, width: 0.5, last: "left" }).side).toBe("left");
    // Kept right, it would now overflow by 0.23: it moves.
    expect(bubbleSide({ x: 0.7, width: 0.5, last: "right" }).side).toBe("left");
  });
});

describe("lineReadingMs", () => {
  // Why this test matters: the lineEnd advance with no voice waits this
  // long; an empty or absurd caption must still give a bounded time.
  it("grows with the words and pauses at a sentence's end", () => {
    const one = lineReadingMs("Hello.");
    const two = lineReadingMs("Hello there, traveller. Come.");
    expect(two).toBeGreaterThan(one);
    expect(lineReadingMs("")).toBeGreaterThanOrEqual(1500);
    expect(lineReadingMs("word ".repeat(5000))).toBeLessThanOrEqual(60_000);
  });

  it("reads the prototype's first line in a time a person reads it", () => {
    const ms = lineReadingMs(
      "Good day, traveller! My keep stood behind that broken wall. Come, the market road runs east.",
    );
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThan(12_000);
  });
});

describe("characterViewLook", () => {
  it("knows the five world views and leaves the card and stage alone", () => {
    expect(isStageCharacterView("bubble")).toBe(true);
    expect(isStageCharacterView("popup")).toBe(true);
    expect(isStageCharacterView("card")).toBe(false);
    expect(isStageCharacterView("stage")).toBe(false);
    expect(isStageCharacterView("arrows")).toBe(false);
  });

  // Why this test matters: which parts each view draws is the view; one
  // table keeps the look and its tests reading the same rule.
  it("draws the bubble in three views, the ring and card in the portrait, the stage in the pop-up", () => {
    expect(characterViewLook("bubble")).toMatchObject({
      bubble: true,
      figure: true,
      ring: false,
      popup: false,
      beckons: false,
    });
    expect(characterViewLook("two-stations")).toMatchObject({
      bubble: true,
      beckons: true,
    });
    expect(characterViewLook("portrait")).toMatchObject({
      bubble: false,
      pip: true,
      ring: true,
      portrait: true,
    });
    expect(characterViewLook("popup")).toMatchObject({
      figure: false,
      popup: true,
      pip: false,
      turns: false,
    });
  });
});
