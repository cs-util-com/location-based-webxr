import { describe, expect, it } from "vitest";

import {
  activeWordAt,
  beckonNext,
  BUBBLE_OPEN_M,
  bubbleOpens,
  bubbleSide,
  characterViewLook,
  facingDegOf,
  facingRotation,
  facingYaw,
  isStageCharacterView,
  lineReadingMs,
  lineWordTimes,
  MAX_TURN_DEG,
  POPUP_CLOSE_M,
  POPUP_UNFOLD_M,
  popupUnfolds,
  readingFloor,
  restYawOf,
  talkFrameAt,
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

describe("restYawOf and facingYaw: the creator's facing and the 60 degree turn", () => {
  const yawQ = (rad: number) =>
    [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)] as const;

  // Why this test matters: the creator sets his facing as the block's
  // rotation; read wrongly he would rest facing another way than the
  // creator chose (the prototype's `root.rotation.y = pose yaw`).
  it("reads the facing about Up from a block's rotation, 0 facing east", () => {
    expect(restYawOf([0, 0, 0, 1])).toBeCloseTo(0, 12);
    expect(restYawOf(yawQ(Math.PI / 2))).toBeCloseTo(Math.PI / 2, 12);
    expect(restYawOf(yawQ(-2))).toBeCloseTo(-2, 12);
    // Not normalised: the same facing.
    expect(restYawOf([0, 2 * Math.SQRT1_2, 0, 2 * Math.SQRT1_2])).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    // Malformed, or his front straight up: rest at 0.
    expect(restYawOf([Number.NaN, 0, 0, 1])).toBe(0);
    expect(restYawOf([0, 0, 0])).toBe(0);
    expect(restYawOf([0, 0, 0, 0])).toBe(0);
    expect(restYawOf([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])).toBe(0);
  });

  // Why this test matters: the prototype turns him toward the visitor by
  // at most 60 degrees from the creator's facing, so a visitor behind him
  // sees him from the side, not a figure spinning to follow them.
  it("turns toward the camera by at most 60 degrees, and the pop-up rests", () => {
    const cap = (MAX_TURN_DEG * Math.PI) / 180;
    expect(MAX_TURN_DEG).toBe(60);
    expect(facingYaw(0, 0.5, true)).toBeCloseTo(0.5, 12);
    expect(facingYaw(0, Math.PI / 2, true)).toBeCloseTo(cap, 12);
    expect(facingYaw(0, -Math.PI / 2, true)).toBeCloseTo(-cap, 12);
    // Across the wrap: rest 170 degrees, the camera at -170 is 20 away.
    const r = (170 * Math.PI) / 180;
    expect(facingYaw(r, -r, true)).toBeCloseTo(r + (20 * Math.PI) / 180, 12);
    expect(facingYaw(1, 2, false)).toBe(1);
    expect(facingYaw(Number.NaN, 0.3, true)).toBeCloseTo(0.3, 12);
    expect(facingYaw(0.4, Number.NaN, true)).toBe(0.4);
  });
});

// Why these tests matter: while his voice plays the bubble reads along
// word by word and his mouth moves (the sheet's talk-a and talk-b
// frames), both from the prototype's estimated word timing - the tour
// stores no timing, so the estimate is the one clock both follow.
describe("the read-along's word timing", () => {
  it("times each word of the line as the prototype does, from 260 ms, with pauses after a sentence and a comma", () => {
    const times = lineWordTimes("Hi, my friend. Go");
    expect(times).toHaveLength(4);
    // "Hi," 2 letters: 110 + 104 = 214 ms; then 70 + a comma's 210.
    expect(times[0]).toEqual({ startMs: 260, endMs: 474 });
    expect(times[1]?.startMs).toBe(474 + 70 + 210);
    // "friend." ends a sentence: 430 more before "Go".
    const friend = times[2]!;
    expect(times[3]?.startMs).toBe(friend.endMs + 70 + 430);
    // A long word is capped at 640 ms, a short one floored at 170.
    expect(lineWordTimes("a")[0]).toEqual({ startMs: 260, endMs: 430 });
    const long = lineWordTimes("abcdefghijklmnopqrstuvwxyz")[0]!;
    expect(long.endMs - long.startMs).toBe(640);
    expect(lineWordTimes("")).toEqual([]);
    expect(lineWordTimes(7 as unknown as string)).toEqual([]);
  });

  it("names the word being said: none before the first, the last one begun after", () => {
    const times = lineWordTimes("One two three");
    expect(activeWordAt(times, 0)).toBe(-1);
    expect(activeWordAt(times, 260)).toBe(0);
    expect(activeWordAt(times, times[1]!.startMs - 1)).toBe(0);
    expect(activeWordAt(times, times[1]!.startMs)).toBe(1);
    expect(activeWordAt(times, 1e9)).toBe(2);
    expect(activeWordAt(times, Number.NaN)).toBe(-1);
  });

  it("moves his mouth only inside a word: half open first, then open, every 115 ms", () => {
    const times = lineWordTimes("Wonderful");
    const w = times[0]!;
    expect(talkFrameAt(times, w.startMs - 1)).toBe(0);
    expect(talkFrameAt(times, w.startMs)).toBe(1);
    expect(talkFrameAt(times, w.startMs + 114)).toBe(1);
    expect(talkFrameAt(times, w.startMs + 115)).toBe(2);
    expect(talkFrameAt(times, w.startMs + 230)).toBe(1);
    expect(talkFrameAt(times, w.endMs)).toBe(0);
    expect(talkFrameAt(times, Number.NaN)).toBe(0);
  });
});

// Why these tests matter: the creator types where a character faces as a
// heading (clockwise from north), the format stores a rotation, and the
// viewer turns him by `restYawOf`'s yaw: the three must agree, or a
// character typed to face the fountain stands facing away from it.
describe("facingDegOf and facingRotation: his rest facing as a heading", () => {
  it("reads no turn as facing east, and writes north, east, south and west so restYawOf faces them", () => {
    expect(facingDegOf([0, 0, 0, 1])).toBe(90);
    for (const [deg, yaw] of [
      [0, Math.PI / 2],
      [90, 0],
      [180, -Math.PI / 2],
      [270, Math.PI],
    ] as const) {
      const q = facingRotation(deg);
      if (q === null) throw new Error("no rotation");
      expect(Math.cos(restYawOf(q) - yaw)).toBeCloseTo(1, 9);
      expect(facingDegOf(q)).toBeCloseTo(deg, 9);
    }
  });

  it("turns about Up alone, and writes no rotation for a heading that is no number", () => {
    const q = facingRotation(37);
    if (q === null) throw new Error("no rotation");
    expect([q[0], q[2]]).toEqual([0, 0]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    expect(facingRotation(Number.NaN)).toBeNull();
    expect(facingRotation(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
