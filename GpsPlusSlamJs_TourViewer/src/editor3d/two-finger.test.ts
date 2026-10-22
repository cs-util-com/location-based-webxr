/**
 * Why these tests matter: two fingers on a tablet are the camera's only -
 * moved up or down side by side they tilt it, as in map apps; anything
 * else pinches, pans and twists. The kind is decided once the fingers
 * moved past a dead zone and kept until they lift, so a tilt does not
 * turn into a zoom half way. A misread gesture zooms when the creator
 * meant to tilt. The dead zone (10 px, the design's) is swept 5-20 px:
 * the verdict for each clean gesture must not hang on its exact value.
 */
import { describe, expect, it } from "vitest";

import {
  TWO_FINGER,
  mapGestureOf,
  tiltedPolarRad,
  twoFingerMode,
  type FingerPair,
} from "./two-finger.js";

const START: FingerPair = [
  { x: 100, y: 300 },
  { x: 200, y: 300 },
];

function moved(dx0: number, dy0: number, dx1: number, dy1: number): FingerPair {
  return [
    { x: START[0].x + dx0, y: START[0].y + dy0 },
    { x: START[1].x + dx1, y: START[1].y + dy1 },
  ];
}

describe("which two-finger gesture it is", () => {
  it("waits inside the dead zone, and for the second finger to move", () => {
    expect(twoFingerMode(START, moved(0, -6, 0, -6))).toBeNull();
    // One finger past the zone, the other still: still waiting...
    expect(twoFingerMode(START, moved(0, -12, 0, -1))).toBeNull();
    // ...unless the first went far (a pinch against a still thumb).
    expect(twoFingerMode(START, moved(-30, 0, 0, 0))).toBe("map");
  });

  for (const deadPx of [5, 10, 15, 20]) {
    it(`reads tilt, pinch, pan and twist the same with a ${String(deadPx)} px dead zone`, () => {
      expect(twoFingerMode(START, moved(1, -30, -1, -30), deadPx)).toBe("tilt");
      expect(twoFingerMode(START, moved(0, 30, 0, 30), deadPx)).toBe("tilt");
      // Apart: a pinch.
      expect(twoFingerMode(START, moved(-30, 0, 30, 0), deadPx)).toBe("map");
      // Side by side to the right: a pan.
      expect(twoFingerMode(START, moved(30, 0, 30, 0), deadPx)).toBe("map");
      // Round each other: a twist.
      expect(twoFingerMode(START, moved(0, 30, 0, -30), deadPx)).toBe("map");
    });
  }

  it("uses the design's numbers", () => {
    expect(TWO_FINGER).toEqual({ deadPx: 10, stillPx: 4, tiltPerPx: 0.0055 });
  });
});

describe("what the gesture does to the camera", () => {
  it("tilts 0.0055 rad per pixel of the fingers' mean rise: up makes it more oblique", () => {
    expect(tiltedPolarRad(0.8, START, moved(0, -100, 0, -100))).toBeCloseTo(
      0.8 + 0.55,
      9,
    );
    expect(tiltedPolarRad(0.8, START, moved(0, 40, 0, 20))).toBeCloseTo(
      0.8 - 30 * 0.0055,
      9,
    );
  });

  it("zooms by the fingers' spread and turns by their twist", () => {
    const pinch = mapGestureOf(START, moved(-50, 0, 50, 0));
    expect(pinch.distanceScale).toBeCloseTo(0.5, 9);
    expect(pinch.turnRad).toBeCloseTo(0, 9);
    // The second finger swung a quarter turn round the first.
    const twist = mapGestureOf(START, [
      { x: 100, y: 300 },
      { x: 100, y: 400 },
    ]);
    expect(twist.distanceScale).toBeCloseTo(1, 9);
    // Clockwise on the screen (y down) is a positive turn: the editing
    // adds it to the orbit's azimuth, which swings the camera the other
    // way round the centre, so the ground turns WITH the fingers, as on a
    // map.
    expect(twist.turnRad).toBeCloseTo(Math.PI / 2, 9);
    const back = mapGestureOf(START, [
      { x: 100, y: 300 },
      { x: 100, y: 200 },
    ]);
    expect(back.turnRad).toBeCloseTo(-Math.PI / 2, 9);
  });
});
