import { describe, expect, it } from "vitest";

import {
  BACKGROUND_UNDER_VOICE,
  circleInside,
  glide,
  LOWER_GLIDE_S,
  zoneGain,
} from "./sound-reach.js";

describe("an ambient zone's loudness", () => {
  it("is full within the inner calm, falls linearly and is silent at the reach", () => {
    // Why: the ground glow draws this same curve, so a visitor sees where
    // the sound is loud; a curve that ran past the reach would play a sound
    // nobody can see the edge of.
    const zone = { minM: 4, maxM: 14, volume: 0.5 };
    expect(zoneGain(0, zone)).toBe(0.5);
    expect(zoneGain(4, zone)).toBe(0.5);
    expect(zoneGain(9, zone)).toBeCloseTo(0.25);
    expect(zoneGain(14, zone)).toBe(0);
    expect(zoneGain(40, zone)).toBe(0);
  });

  it("without an inner calm is full only at the centre, and refuses nonsense", () => {
    // Why: `minM` is optional in the format; a broken distance (NaN from a
    // lost pose) must mean silence, never a blast.
    expect(zoneGain(5, { maxM: 10, volume: 1 })).toBeCloseTo(0.5);
    expect(zoneGain(Number.NaN, { maxM: 10, volume: 1 })).toBe(0);
    expect(zoneGain(-1, { maxM: 10, volume: 1 })).toBe(0);
  });
});

describe("a narration circle's edge", () => {
  it("opens at the radius and closes only beyond the margin", () => {
    // Why: the margin is what keeps a visitor standing at the edge from
    // having the player open and close with every GPS wobble.
    expect(circleInside(6, 6, 1, false)).toBe(true);
    expect(circleInside(6.5, 6, 1, false)).toBe(false);
    expect(circleInside(6.5, 6, 1, true)).toBe(true);
    expect(circleInside(7, 6, 1, true)).toBe(true);
    expect(circleInside(7.01, 6, 1, true)).toBe(false);
    expect(circleInside(Number.NaN, 6, 1, true)).toBe(false);
  });
});

describe("lowering the background under a voice", () => {
  it("glides toward its target with the prototype's time constant", () => {
    // Why: a step change clicks; the glide's constant is the one value the
    // sound design names, so it is pinned here.
    expect(BACKGROUND_UNDER_VOICE).toBe(0.3);
    expect(LOWER_GLIDE_S).toBe(0.35);
    const after = glide(1, 0.3, LOWER_GLIDE_S);
    expect(after).toBeCloseTo(1 - 0.7 * (1 - Math.exp(-1)));
    expect(glide(1, 0.3, 100)).toBeCloseTo(0.3);
    expect(glide(1, 0.3, 0)).toBe(1);
    expect(glide(1, 0.3, -1)).toBe(1);
  });
});
