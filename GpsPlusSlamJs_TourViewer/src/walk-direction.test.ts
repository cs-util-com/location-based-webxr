import { describe, expect, it } from "vitest";

import {
  createWalkDirections,
  WALK_AHEAD_DEG,
  WALK_BEHIND_DEG,
  WALK_DIRECTION_HYSTERESIS_DEG,
  walkDirection,
  walkDirectionPhrase,
  walkDirectionTail,
} from "./walk-direction";

/**
 * Why these tests matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, §1.5, §1.6, §5): the peek's tail, the rows and (M5) the edge pill
 * say which way a station is with ONE rule. W4 had two ("behind" past 140°
 * in its words, past 137.5° in its pill); the build has one, and these pin
 * its thresholds, its sides and the hysteresis that keeps a word from
 * flickering while the visitor turns slowly across a threshold.
 */

describe("walkDirection - the thresholds (W4's dirWord)", () => {
  it("ships W4's 28° and 140° with a 5° hysteresis", () => {
    expect(WALK_AHEAD_DEG).toBe(28);
    expect(WALK_BEHIND_DEG).toBe(140);
    expect(WALK_DIRECTION_HYSTERESIS_DEG).toBe(5);
  });

  it("is ahead below 28°, a side from 28° to 140°, behind past 140°", () => {
    expect(walkDirection(0)).toBe("ahead");
    expect(walkDirection(27.9)).toBe("ahead");
    expect(walkDirection(-27.9)).toBe("ahead");
    expect(walkDirection(28)).toBe("right");
    expect(walkDirection(-28)).toBe("left");
    expect(walkDirection(140)).toBe("right");
    expect(walkDirection(-140)).toBe("left");
    expect(walkDirection(140.1)).toBe("behind");
    expect(walkDirection(-140.1)).toBe("behind");
    expect(walkDirection(180)).toBe("behind");
  });

  it("reads a positive angle as right (bearingDeltaDeg's sign)", () => {
    expect(walkDirection(90)).toBe("right");
    expect(walkDirection(-90)).toBe("left");
  });

  it("has no word for an angle that is no number", () => {
    expect(walkDirection(Number.NaN)).toBeNull();
    expect(walkDirection(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("wraps an angle outside (-180, 180] first", () => {
    expect(walkDirection(360 + 10)).toBe("ahead");
    expect(walkDirection(-270)).toBe("right");
  });
});

describe("walkDirection - the hysteresis band", () => {
  it("keeps 'ahead' until the angle passes 28° by the hysteresis", () => {
    expect(walkDirection(30, "ahead")).toBe("ahead");
    expect(walkDirection(32.9, "ahead")).toBe("ahead");
    expect(walkDirection(33, "ahead")).toBe("right");
    expect(walkDirection(-33, "ahead")).toBe("left");
  });

  it("keeps a side until the angle passes its threshold by the hysteresis", () => {
    expect(walkDirection(25, "right")).toBe("right");
    expect(walkDirection(23.1, "right")).toBe("right");
    expect(walkDirection(23, "right")).toBe("ahead");
    expect(walkDirection(144.9, "right")).toBe("right");
    expect(walkDirection(145, "right")).toBe("right");
    expect(walkDirection(145.1, "right")).toBe("behind");
    expect(walkDirection(-144.9, "left")).toBe("left");
  });

  it("keeps 'behind' until the angle passes 140° by the hysteresis", () => {
    expect(walkDirection(136, "behind")).toBe("behind");
    expect(walkDirection(-135.1, "behind")).toBe("behind");
    expect(walkDirection(135, "behind")).toBe("right");
  });

  it("never carries a side over to the other side", () => {
    // A jump from the left to the right of the view (a fast turn) is no
    // band: the previous word's zone does not hold the new angle.
    expect(walkDirection(60, "left")).toBe("right");
    expect(walkDirection(-60, "right")).toBe("left");
    // Inside the ahead zone the previous side cannot hold either.
    expect(walkDirection(10, "left")).toBe("ahead");
  });

  it("takes the hysteresis as an option (0 is no band)", () => {
    expect(walkDirection(30, "ahead", { hysteresisDeg: 0 })).toBe("right");
    expect(walkDirection(37, "ahead", { hysteresisDeg: 10 })).toBe("ahead");
    expect(walkDirection(19.9, "ahead", { aheadDeg: 15 })).toBe("ahead");
    expect(walkDirection(20, "ahead", { aheadDeg: 15 })).toBe("right");
    expect(walkDirection(21, null, { aheadDeg: 15 })).toBe("right");
  });

  it("refuses thresholds that do not make three zones", () => {
    expect(() => walkDirection(0, null, { aheadDeg: 150 })).toThrow(RangeError);
    expect(() => walkDirection(0, null, { hysteresisDeg: -1 })).toThrow(
      RangeError,
    );
    expect(() => walkDirection(0, null, { behindDeg: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe("walkDirectionPhrase / walkDirectionTail - the words (W4)", () => {
  it("says the row's words and the peek's sentence", () => {
    expect(walkDirectionPhrase("ahead")).toBe("ahead");
    expect(walkDirectionPhrase("left")).toBe("to your left");
    expect(walkDirectionPhrase("right")).toBe("to your right");
    expect(walkDirectionPhrase("behind")).toBe("behind you");
    expect(walkDirectionTail("ahead")).toBe("Ahead.");
    expect(walkDirectionTail("left")).toBe("To your left.");
    expect(walkDirectionTail("right")).toBe("To your right.");
    expect(walkDirectionTail("behind")).toBe("Behind you.");
  });
});

describe("createWalkDirections - one memory per station", () => {
  it("remembers each station's word for its own hysteresis", () => {
    const dirs = createWalkDirections();
    expect(dirs.of("a", 20)).toBe("ahead");
    expect(dirs.of("b", 40)).toBe("right");
    // a's 30° holds "ahead", b's 26° holds "right": each its own band.
    expect(dirs.of("a", 30)).toBe("ahead");
    expect(dirs.of("b", 26)).toBe("right");
  });

  it("forgets a station without an angle (no heading)", () => {
    const dirs = createWalkDirections();
    expect(dirs.of("a", 20)).toBe("ahead");
    expect(dirs.of("a", null)).toBeNull();
    expect(dirs.of("a", 30)).toBe("right");
  });

  it("forgets every station on reset", () => {
    const dirs = createWalkDirections();
    dirs.of("a", 20);
    dirs.reset();
    expect(dirs.of("a", 30)).toBe("right");
  });
});
