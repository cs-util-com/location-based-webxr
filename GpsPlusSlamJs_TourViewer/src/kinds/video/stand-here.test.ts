import { describe, expect, it } from "vitest";

import {
  STAND_HERE_CAPTIONS_AT,
  STAND_HERE_FACE_DEG,
  STAND_HERE_PLAYS_AT,
  STAND_HERE_RAMP_M,
  STAND_HERE_RATE,
  standHereCaptions,
  standHereDevelop,
  standHereGuide,
  standHereShade,
  standHereTarget,
} from "./stand-here.js";

/** The seconds a visitor standing on the spot, facing it, waits until it
 *  plays, at a rate of `rate` per second. */
function secondsToPlay(rate: number): number {
  return -Math.log(1 - STAND_HERE_PLAYS_AT) / rate;
}

describe("a stand-here video's develop target", () => {
  // Why: the target is the whole visitor rule of the view: far away or
  // looking elsewhere the projection stays a faint sepia ghost, on the
  // footprints and facing it, it develops. The edges are the chosen
  // prototype's, pinned so a change to them is a decision, not a drift.
  it("is 1 on the spot facing it, 0 far off or turned away", () => {
    const [far, near] = STAND_HERE_RAMP_M;
    const [wide, narrow] = STAND_HERE_FACE_DEG;
    expect([far, near, wide, narrow]).toEqual([4.5, 1, 32, 12]);
    expect(standHereTarget(near, narrow)).toBe(1);
    expect(standHereTarget(0, 0)).toBe(1);
    expect(standHereTarget(far, 0)).toBe(0);
    expect(standHereTarget(0, wide)).toBe(0);
    expect(standHereTarget(0, 180)).toBe(0);
  });

  it("rises without a step between the edges", () => {
    let last = 0;
    for (let d = STAND_HERE_RAMP_M[0]; d >= STAND_HERE_RAMP_M[1]; d -= 0.05) {
      const t = standHereTarget(d, 0);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    expect(standHereTarget(2.75, 22)).toBeCloseTo(0.25, 5);
  });

  it("develops at once without a viewpoint, and never on a number it cannot read", () => {
    // Why: a stand-here video without its spot (a newer file's dropped
    // viewpoint) must still be seen; a lost camera frame must not flash it.
    expect(standHereTarget(null, null)).toBe(1);
    expect(standHereTarget(Number.NaN, 0)).toBe(0);
    expect(standHereTarget(0, Number.NaN)).toBe(0);
  });
});

describe("a stand-here video's develop", () => {
  it("eases toward its target, frame rate aside", () => {
    // Why: one 1 s step and ten 0.1 s steps reach the same develop, so a
    // slow phone sees the same picture as a fast one.
    let ten = 0;
    for (let i = 0; i < 10; i += 1) ten = standHereDevelop(ten, 1, 0.1);
    expect(standHereDevelop(0, 1, 1)).toBeCloseTo(ten, 10);
    expect(standHereDevelop(0, 1, 1)).toBeCloseTo(
      1 - Math.exp(-STAND_HERE_RATE),
      10,
    );
    expect(standHereDevelop(0.5, 0.5, 3)).toBe(0.5);
  });

  it("takes no step on a step it cannot read, and stays in 0 to 1", () => {
    expect(standHereDevelop(0.3, 1, Number.NaN)).toBe(0.3);
    expect(standHereDevelop(0.3, 1, -1)).toBe(0.3);
    expect(standHereDevelop(Number.NaN, 1, 0.1)).toBeGreaterThanOrEqual(0);
    expect(standHereDevelop(2, 1, 0)).toBe(1);
  });

  it("plays within a second of standing on the spot, across the plausible rates", () => {
    // Why: the rate is the prototype's 1.6 per second, so a visitor on
    // the spot, facing it, sees it play after 0.57 s; swept from 1 to 2.5
    // per second the wait stays between 0.37 s and 0.92 s, under the second
    // a visitor holds still for (the look trigger's dwell is 0.6 s).
    expect(STAND_HERE_RATE).toBe(1.6);
    expect(STAND_HERE_PLAYS_AT).toBe(0.6);
    for (const rate of [1, 1.3, 1.6, 2, 2.5]) {
      expect(secondsToPlay(rate)).toBeGreaterThan(0.36);
      expect(secondsToPlay(rate)).toBeLessThan(0.93);
    }
    let develop = 0;
    let t = 0;
    while (develop <= STAND_HERE_PLAYS_AT) {
      develop = standHereDevelop(develop, 1, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(secondsToPlay(STAND_HERE_RATE), 1);
  });
});

describe("what a stand-here video says", () => {
  it("asks the visitor onto the footprints, then to face it, until it develops", () => {
    // Why: without a word nobody knows the spot is the way in; the guide
    // goes once the picture is clear enough to speak for itself.
    expect(standHereGuide(0, 5.6, true)).toBe("Stand on the footprints · 6 m");
    expect(standHereGuide(0, 1.3, true)).toBe("Stand on the footprints · 1 m");
    expect(standHereGuide(0, 1.2, true)).toBe("Face the video");
    expect(standHereGuide(0.54, 0.5, true)).toBe("Face the video");
    expect(standHereGuide(0.55, 9, true)).toBeNull();
    expect(standHereGuide(0, 9, false)).toBeNull();
    expect(standHereGuide(0, Number.NaN, true)).toBe("Face the video");
  });

  it("shows its captions only once developed past half", () => {
    expect(STAND_HERE_CAPTIONS_AT).toBe(0.5);
    expect(standHereCaptions(0.5)).toBe(false);
    expect(standHereCaptions(0.51)).toBe(true);
  });
});

describe("how a stand-here video is drawn at its develop", () => {
  // Why: the shade is what the visitor sees of the rule: undeveloped a
  // faint warm-toned ghost with a wide soft edge and bright footprints,
  // developed the clip itself, its edge tighter and the footprints faded
  // to a trace. The values are the prototype's.
  it("goes from a sepia ghost to the clip", () => {
    const ghost = standHereShade(0, 0);
    expect(ghost.opacity).toBeCloseTo(0.13, 10);
    expect(ghost.tone).toBe(1);
    expect(ghost.tint).toBeCloseTo(1.15, 10);
    expect(ghost.feather).toBeCloseTo(0.75, 10);
    expect(ghost.footprints).toBeCloseTo(0.9, 10);
    expect(ghost.pulse).toBeCloseTo(0.18, 10);
    const clear = standHereShade(1, 0);
    expect(clear.opacity).toBe(1);
    expect(clear.tone).toBe(0);
    expect(clear.tint).toBe(1);
    expect(clear.feather).toBeCloseTo(0.38, 10);
    expect(clear.footprints).toBeCloseTo(0.9 * 0.35, 10);
    expect(clear.pulse).toBe(0);
  });

  it("breathes its pulse between 0.04 and 0.32 while undeveloped", () => {
    expect(standHereShade(0, (Math.PI / 2) * 0.5).pulse).toBeCloseTo(0.32, 10);
    expect(standHereShade(0, (-Math.PI / 2) * 0.5).pulse).toBeCloseTo(0.04, 10);
    expect(standHereShade(0.5, (Math.PI / 2) * 0.5).pulse).toBeCloseTo(
      0.16,
      10,
    );
  });
});
