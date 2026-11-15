/**
 * Why these tests matter: the chosen then-and-now page lets the old
 * picture melt into today at its edges rather than end on a hard line,
 * which is what makes the overlay read as a window into the past and
 * hides a small misalignment at its border. The feather must be whole in
 * the picture's middle, nothing at its very edge, never step back, and
 * stay so over the range of widths a later tuning may pick.
 */
import { DataTexture, LinearFilter } from "three";
import { describe, expect, it } from "vitest";

import {
  THEN_NOW_FEATHER,
  thenNowFeather,
  thenNowFeatherMap,
} from "./then-now-feather.js";

describe("thenNowFeather", () => {
  it("is 0 at every edge and 1 inside, the top and bottom 1.5 x wider", () => {
    for (const feather of [0.02, 0.035, 0.05, 0.08]) {
      expect(thenNowFeather(0, 0.5, feather)).toBe(0);
      expect(thenNowFeather(1, 0.5, feather)).toBe(0);
      expect(thenNowFeather(0.5, 0, feather)).toBe(0);
      expect(thenNowFeather(0.5, 1, feather)).toBe(0);
      expect(thenNowFeather(0.5, 0.5, feather)).toBe(1);
      expect(thenNowFeather(feather, 0.5, feather)).toBe(1);
      expect(thenNowFeather(0.5, 1.5 * feather, feather)).toBe(1);
      // Half way up the side ramp, short of whole at the same depth from
      // the top.
      expect(thenNowFeather(0.5, feather, feather)).toBeLessThan(1);
      // Monotone from the edge inwards, both ways.
      let lastU = 0;
      let lastV = 0;
      for (let t = 0; t <= 0.5; t += 0.005) {
        const u = thenNowFeather(t, 0.5, feather);
        const v = thenNowFeather(0.5, t, feather);
        expect(u).toBeGreaterThanOrEqual(lastU - 1e-12);
        expect(v).toBeGreaterThanOrEqual(lastV - 1e-12);
        lastU = u;
        lastV = v;
      }
    }
  });

  it("reads 0 for a point off the picture or not a number", () => {
    expect(thenNowFeather(-0.1, 0.5)).toBe(0);
    expect(thenNowFeather(0.5, 1.2)).toBe(0);
    expect(thenNowFeather(Number.NaN, 0.5)).toBe(0);
    expect(thenNowFeather(0.5, 0.5, Number.NaN)).toBe(1);
  });

  it("is the chosen page's width by default", () => {
    expect(THEN_NOW_FEATHER).toBe(0.035);
    expect(thenNowFeather(0.0175, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("thenNowFeatherMap", () => {
  it("is one shared, smoothly filtered alpha map of the feather", () => {
    const map = thenNowFeatherMap();
    expect(map).toBeInstanceOf(DataTexture);
    expect(thenNowFeatherMap()).toBe(map);
    expect(map.magFilter).toBe(LinearFilter);
    const { width, height, data } = map.image as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    // three's alpha map reads the green channel.
    const green = (x: number, y: number) => data[(y * width + x) * 4 + 1]!;
    expect(green(0, height / 2)).toBe(0);
    expect(green(width / 2, height / 2)).toBe(255);
    expect(green(width / 2, 0)).toBe(0);
    // The ramp spans several texels, so filtering cannot turn it into a
    // step.
    let ramp = 0;
    for (let x = 0; x < width / 2; x += 1) {
      const g = green(x, height / 2);
      if (g > 0 && g < 255) ramp += 1;
    }
    expect(ramp).toBeGreaterThanOrEqual(6);
  });
});
