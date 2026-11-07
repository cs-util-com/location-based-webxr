import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLOUD_NIGHT_AMBIENT,
  CLOUD_SUN_FLOOR,
  cloudMarchLight,
} from "./globe-cloud-march-light.js";

const sunAt = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return [0, Math.sin(r), -Math.cos(r)] as const;
};
const luminance = (c: readonly [number, number, number]) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("cloudMarchLight", () => {
  // Why this test matters: the page was only ever looked at by day. A NaN
  // from the sun under the horizon would turn every cloud pixel black or
  // white at dusk; the sun at the nadir is the worst case of the column.
  it("is finite for every sun, the zenith and the nadir included", () => {
    fc.assert(
      fc.property(fc.double({ min: -90, max: 90, noNaN: true }), (deg) => {
        const l = cloudMarchLight(sunAt(deg));
        return [
          ...l.sunPath,
          ...l.cloudSun,
          ...l.ambientTop,
          ...l.ambientBottom,
        ].every(Number.isFinite);
      }),
    );
    expect(cloudMarchLight([0, 1, 0]).cloudSun.every(Number.isFinite)).toBe(
      true,
    );
    expect(cloudMarchLight([0, -1, 0]).cloudSun.every(Number.isFinite)).toBe(
      true,
    );
  });

  // Why this test matters: the numbers of the accepted look at its sun.
  it("is the page's cloud light by day", () => {
    const l = cloudMarchLight(sunAt(30));
    expect(luminance(l.cloudSun)).toBeGreaterThan(2);
    expect(luminance(l.ambientBottom)).toBeLessThan(luminance(l.ambientTop));
  });

  it("fades as the sun sinks", () => {
    let previous = Infinity;
    for (const deg of [60, 30, 10, 3, 0, -3, -8, -20]) {
      const now = luminance(cloudMarchLight(sunAt(deg)).cloudSun);
      expect(now).toBeLessThanOrEqual(previous + 1e-9);
      previous = now;
    }
  });

  // Why this test matters: a cloud at night must stay a dark shape, not a
  // hole of pure black against the night sky, and not lit by a sun below.
  it("leaves the night ambient at night", () => {
    const l = cloudMarchLight(sunAt(-30));
    expect(luminance(l.cloudSun)).toBeLessThan(1e-3);
    expect(l.ambientTop[2]).toBeGreaterThanOrEqual(CLOUD_NIGHT_AMBIENT[2]);
    expect(luminance(l.ambientTop)).toBeLessThan(0.05);
  });

  // Why this test matters: half desaturated, the last light through the air
  // is nearly pure red, and clouds at sunset came out crimson blotches.
  it("keeps a sunset cloud warm, not crimson", () => {
    for (const degrees of [3, 1, 0, -1, -2]) {
      const up = Math.sin((degrees * Math.PI) / 180);
      const [r = 0, g = 0, b = 0] = cloudMarchLight([
        Math.cos((degrees * Math.PI) / 180),
        up,
        0,
      ]).cloudSun;
      expect(g).toBeGreaterThanOrEqual(CLOUD_SUN_FLOOR.green * r - 1e-9);
      expect(b).toBeGreaterThanOrEqual(CLOUD_SUN_FLOOR.blue * r - 1e-9);
    }
  });

  it("leaves the day's sun as the page chose it", () => {
    const [r = 0, g = 0, b = 0] = cloudMarchLight([0.6, 0.8, 0]).cloudSun;
    expect(g / r).toBeGreaterThan(CLOUD_SUN_FLOOR.green + 0.2);
    expect(b / r).toBeGreaterThan(CLOUD_SUN_FLOOR.blue + 0.2);
  });

  it("refuses a sun that is not a direction", () => {
    expect(() => cloudMarchLight([0, 0, 0])).toThrow(RangeError);
    expect(() => cloudMarchLight([Number.NaN, 1, 0])).toThrow(RangeError);
  });
});
