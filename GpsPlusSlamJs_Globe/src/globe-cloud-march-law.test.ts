import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLOUD_LIFE_PERIOD_S,
  CLOUD_MARCH_LAYER,
  cloudDistanceKm,
  cloudFilterReference,
  cloudHazeReachKm,
  cloudLawAt,
  cloudLifeClock,
  cloudMarchAt,
  cloudTargetSize,
  cloudViewSettings,
} from "./globe-cloud-march-law.js";
import { GLOBE_QUALITIES, GLOBE_QUALITY_NAMES } from "./globe-quality.js";

describe("cloudDistanceKm", () => {
  // Why this test matters: the scale is keyed on the distance to the layer,
  // not on the altitude; inside the layer it is 0, the finest setting.
  it("is the gap to the layer, 0 inside it", () => {
    expect(cloudDistanceKm(10)).toBeCloseTo(10 - CLOUD_MARCH_LAYER.topKm);
    expect(cloudDistanceKm(0.1)).toBeCloseTo(CLOUD_MARCH_LAYER.baseKm - 0.1);
    expect(cloudDistanceKm(2)).toBe(0);
  });
});

describe("cloudMarchAt", () => {
  it("runs from the cheapest march to the finest", () => {
    const low = cloudMarchAt(0);
    const high = cloudMarchAt(1);
    expect(low.maxSteps).toBeCloseTo(24);
    expect(high.maxSteps).toBeCloseTo(96);
    expect(low.segments).toBeCloseTo(14);
    expect(high.segments).toBeCloseTo(56);
    expect(low.stepFactor).toBeCloseTo(0.09);
    expect(high.stepFactor).toBeCloseTo(0.025);
    expect(high.lightSteps).toBeCloseTo(5);
    expect(high.detail).toBe(1);
    expect(low.detail).toBe(0);
  });

  // Why this test matters: a step that got longer with more quality would
  // make a dearer setting look worse.
  it("never coarsens as the quality rises", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const lo = cloudMarchAt(Math.min(a, b));
          const hi = cloudMarchAt(Math.max(a, b));
          expect(hi.maxSteps).toBeGreaterThanOrEqual(lo.maxSteps - 1e-9);
          expect(hi.stepFactor).toBeLessThanOrEqual(lo.stepFactor + 1e-12);
        },
      ),
    );
  });
});

describe("cloudLawAt", () => {
  const law = GLOBE_QUALITIES.high.clouds.law;

  it("holds the ends and eases between the stations", () => {
    expect(cloudLawAt(law, 0)).toEqual({ march: 1, pixelsPerCss: 0.75 });
    expect(cloudLawAt(law, 500)).toEqual({ march: 0.85, pixelsPerCss: 1 });
    const mid = cloudLawAt(law, Math.sqrt(1.5 * 7));
    expect(mid.pixelsPerCss).toBeCloseTo(0.875);
  });

  it("refuses an empty law", () => {
    expect(() => cloudLawAt([], 1)).toThrow(RangeError);
  });

  // Why this test matters: a jump in the scale between two frames is a pop
  // in the picture; every tier must move smoothly with the distance.
  it("has no jump on any tier", () => {
    for (const name of GLOBE_QUALITY_NAMES) {
      const tierLaw = GLOBE_QUALITIES[name].clouds.law;
      let previous = cloudLawAt(tierLaw, 0.1);
      for (let d = 0.1; d < 120; d *= 1.01) {
        const now = cloudLawAt(tierLaw, d);
        expect(Math.abs(now.march - previous.march)).toBeLessThan(0.02);
        expect(Math.abs(now.pixelsPerCss - previous.pixelsPerCss)).toBeLessThan(
          0.02,
        );
        previous = now;
      }
    }
  });
});

describe("cloudFilterReference", () => {
  // Why this test matters: the field's filter must not follow the quality,
  // or the clouds change shape with it; the reference is the law's coarsest.
  it("is the law's coarsest setting", () => {
    expect(cloudFilterReference(GLOBE_QUALITIES.high.clouds.law)).toEqual({
      march: 0.85,
      pixelsPerCss: 0.75,
    });
  });
});

describe("cloudTargetSize", () => {
  // Why this test matters: the target is allocated once at its largest, so
  // the scale changes every frame without a reallocation.
  it("is the tier's cap, never above the canvas", () => {
    const high = GLOBE_QUALITIES.high.clouds;
    expect(cloudTargetSize(1000, 500, 2, high)).toEqual({
      width: 1500,
      height: 750,
    });
    expect(cloudTargetSize(1000, 500, 1, high)).toEqual({
      width: 1000,
      height: 500,
    });
  });

  it("is at least one pixel", () => {
    const low = GLOBE_QUALITIES.low.clouds;
    expect(cloudTargetSize(0, 0, 1, low)).toEqual({ width: 1, height: 1 });
  });
});

describe("cloudViewSettings", () => {
  const view = {
    cssWidth: 1000,
    cssHeight: 500,
    pixelRatio: 2,
    altitudeKm: 20,
    pixelScale: 1,
  };

  it("draws a share of the target, the rest of the view's pixels up", () => {
    const s = cloudViewSettings(GLOBE_QUALITIES.high.clouds, view);
    expect(s.width).toBe(1000);
    expect(s.height).toBe(500);
    expect(s.uv[0]).toBeCloseTo(1000 / 1500);
    expect(s.canvasPixelsPerCloudPixel).toBeCloseTo(2);
  });

  // Why this test matters: the automatic step-down only lowers the pixel
  // count; the field's filter stays, so the clouds keep their shape.
  it("keeps the filter when the pixel count steps down", () => {
    const whole = cloudViewSettings(GLOBE_QUALITIES.high.clouds, view);
    const half = cloudViewSettings(GLOBE_QUALITIES.high.clouds, {
      ...view,
      pixelScale: 0.5,
    });
    expect(half.width).toBe(500);
    expect(half.filterPixels).toBe(whole.filterPixels);
    expect(half.filterStep).toEqual(whole.filterStep);
  });

  it("refuses a pixel scale outside 0..1", () => {
    expect(() =>
      cloudViewSettings(GLOBE_QUALITIES.high.clouds, {
        ...view,
        pixelScale: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("cloudHazeReachKm", () => {
  // Why this test matters: the far fade ends the march; a reach that is not
  // finite or that grows with thicker haze would draw clouds through it.
  it("reaches less far at a stricter limit", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 60, noNaN: true }), (h) => {
        const near = cloudHazeReachKm(h, 2.2, 0.1);
        const far = cloudHazeReachKm(h, 2.2, 0.01);
        expect(near).toBeGreaterThan(0);
        expect(far).toBeGreaterThanOrEqual(near);
        expect(far).toBeLessThanOrEqual(4000);
      }),
    );
  });

  it("reaches further from higher up", () => {
    expect(cloudHazeReachKm(60, 2.2, 0.1)).toBeGreaterThan(
      cloudHazeReachKm(1, 2.2, 0.1),
    );
  });
});

describe("cloudLifeClock", () => {
  it("runs the phase once a period at speed 1", () => {
    expect(cloudLifeClock(CLOUD_LIFE_PERIOD_S / 2, 1).phase).toBeCloseTo(0.5);
  });

  // Why this test matters: x30 is the library's default and the uniforms
  // must wrap to their tiles' periods, or float32 eats them after hours.
  it("stays inside the tiles' periods at any time", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0, max: 120, noNaN: true }),
        (t, speed) => {
          const c = cloudLifeClock(t, speed);
          expect(c.phase).toBeGreaterThanOrEqual(0);
          expect(c.phase).toBeLessThan(1);
          expect(c.billow[0]).toBeGreaterThanOrEqual(0);
          expect(c.billow[0]).toBeLessThan(3.8);
          expect(c.billow[1]).toBeGreaterThanOrEqual(0);
          expect(c.billow[1]).toBeLessThan(0.85);
        },
      ),
    );
  });
});
