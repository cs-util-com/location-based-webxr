/**
 * Why these tests matter: the owner tunes the two thresholds by eye
 * through the link, so each must mean exactly what its name says (a size
 * in px, a distance in px), and the hysteresis must keep an object at the
 * edge from blinking. A rule that hides the selected station, or that
 * hides one pin of a crowded pair and not the other, shows the creator a
 * tour that changes as they look at it.
 */
import { describe, expect, it } from "vitest";

import {
  GLOBE_VISIBILITY,
  crowdedPins,
  screenSizePx,
  sizeShown,
} from "./globe-visibility.js";

const VIEW = { fovYDeg: 50, viewportHeightPx: 800 };

describe("screenSizePx", () => {
  // Why: the knob is in px; a sphere filling exactly the view's height
  // must read as the view's height.
  it("is the view's height for a sphere that spans the field of view", () => {
    const distanceM = 100;
    const radiusM = distanceM * Math.tan((25 * Math.PI) / 180);
    expect(screenSizePx({ radiusM, distanceM, ...VIEW })).toBeCloseTo(800, 9);
  });

  it("halves at twice the distance and doubles with twice the radius", () => {
    const at = (radiusM: number, distanceM: number) =>
      screenSizePx({ radiusM, distanceM, ...VIEW });
    expect(at(1, 600)).toBeCloseTo(at(1, 300) / 2, 9);
    expect(at(2, 300)).toBeCloseTo(at(1, 300) * 2, 9);
  });

  // Why: the default of 3 px rests on this: a 1 m sign (radius 0.5) is
  // about 3 px at 300 m, a 200 m object (radius 100) at about 57 km.
  it("puts the owner's examples where the default hides them", () => {
    expect(screenSizePx({ radiusM: 0.5, distanceM: 300, ...VIEW })).toBeCloseTo(
      2.86,
      2,
    );
    expect(
      screenSizePx({ radiusM: 100, distanceM: 57_200, ...VIEW }),
    ).toBeCloseTo(3, 1);
  });

  it("is Infinity with the camera inside the sphere", () => {
    expect(screenSizePx({ radiusM: 5, distanceM: 4, ...VIEW })).toBe(Infinity);
    expect(screenSizePx({ radiusM: 5, distanceM: 5, ...VIEW })).toBe(Infinity);
  });

  it("refuses inputs that are not finite or out of range", () => {
    const ok = { radiusM: 1, distanceM: 10, ...VIEW };
    for (const bad of [
      { ...ok, radiusM: -1 },
      { ...ok, radiusM: NaN },
      { ...ok, distanceM: Infinity },
      { ...ok, fovYDeg: 0 },
      { ...ok, fovYDeg: 180 },
      { ...ok, viewportHeightPx: 0 },
      { ...ok, viewportHeightPx: Infinity },
    ]) {
      expect(() => screenSizePx(bad)).toThrow(RangeError);
    }
  });
});

describe("sizeShown", () => {
  it("hides a drawn object below the threshold and keeps it at it", () => {
    expect(sizeShown(true, 3, 3)).toBe(true);
    expect(sizeShown(true, 2.99, 3)).toBe(false);
  });

  // Why: hysteresis - a hidden object waits for 1.5x before it shows again,
  // so a camera drifting a pixel at the edge does not make it blink.
  it("shows a hidden object again only at the threshold times the ratio", () => {
    expect(GLOBE_VISIBILITY.showRatio).toBe(1.5);
    expect(sizeShown(false, 4.49, 3)).toBe(false);
    expect(sizeShown(false, 4.5, 3)).toBe(true);
  });

  // Why: the knob is swept by the owner; the rule must hold at any value
  // of it, not only at the default.
  it("holds the same band for every threshold of a sweep", () => {
    for (const hidePx of [0.5, 1, 3, 8, 20, 200]) {
      expect(sizeShown(true, hidePx, hidePx)).toBe(true);
      expect(sizeShown(true, hidePx * 0.999, hidePx)).toBe(false);
      expect(sizeShown(false, hidePx * 1.499, hidePx)).toBe(false);
      expect(sizeShown(false, hidePx * 1.5, hidePx)).toBe(true);
    }
  });

  it("refuses a bad threshold, ratio or size", () => {
    expect(() => sizeShown(true, 1, -1)).toThrow(RangeError);
    expect(() => sizeShown(true, 1, NaN)).toThrow(RangeError);
    expect(() => sizeShown(true, 1, 3, 0.5)).toThrow(RangeError);
    expect(() => sizeShown(true, NaN, 3)).toThrow(RangeError);
    expect(() => sizeShown(true, -1, 3)).toThrow(RangeError);
  });
});

describe("crowdedPins", () => {
  const none = new Set<string>();

  it("hides both pins of a pair closer than the threshold", () => {
    const pins = [
      { id: "bench", x: 100, y: 100 },
      { id: "fountain", x: 120, y: 100 },
      { id: "gate", x: 400, y: 300 },
    ];
    expect([...crowdedPins(pins, 24, none)].sort()).toEqual([
      "bench",
      "fountain",
    ]);
    // At exactly the threshold they are not closer than it.
    expect(crowdedPins(pins, 20, none).size).toBe(0);
  });

  it("never hides the selected pin", () => {
    const pins = [
      { id: "bench", x: 100, y: 100 },
      { id: "fountain", x: 110, y: 100 },
    ];
    expect([...crowdedPins(pins, 24, none, "bench")]).toEqual(["fountain"]);
  });

  // Why: hysteresis - a crowded pin waits for 1.25x the threshold.
  it("shows a hidden pin again only at the threshold times the ratio", () => {
    expect(GLOBE_VISIBILITY.uncrowdRatio).toBe(1.25);
    const pair = (gap: number) => [
      { id: "bench", x: 0, y: 0 },
      { id: "fountain", x: gap, y: 0 },
    ];
    const was = new Set(["bench", "fountain"]);
    expect(crowdedPins(pair(29.9), 24, was).size).toBe(2);
    expect(crowdedPins(pair(30), 24, was).size).toBe(0);
    expect(crowdedPins(pair(25), 24, none).size).toBe(0);
  });

  it("hides nothing with the crowding off, a single pin or a pin off screen", () => {
    const close = [
      { id: "bench", x: 0, y: 0 },
      { id: "fountain", x: 1, y: 0 },
    ];
    expect(crowdedPins(close, 0, none).size).toBe(0);
    expect(crowdedPins([{ id: "bench", x: 0, y: 0 }], 24, none).size).toBe(0);
    const behind = [
      { id: "bench", x: 0, y: 0 },
      { id: "fountain", x: NaN, y: NaN },
    ];
    expect(crowdedPins(behind, 24, none).size).toBe(0);
  });

  it("holds the same rule for every threshold of a sweep", () => {
    for (const crowdPx of [1, 8, 24, 60, 500]) {
      const pair = (gap: number) => [
        { id: "bench", x: 0, y: 0 },
        { id: "fountain", x: 0, y: gap },
      ];
      expect(crowdedPins(pair(crowdPx * 0.99), crowdPx, none).size).toBe(2);
      expect(crowdedPins(pair(crowdPx), crowdPx, none).size).toBe(0);
    }
  });

  it("refuses a bad threshold or ratio", () => {
    expect(() => crowdedPins([], -1, none)).toThrow(RangeError);
    expect(() => crowdedPins([], Infinity, none)).toThrow(RangeError);
    expect(() => crowdedPins([], 24, none, null, 0.9)).toThrow(RangeError);
  });
});
