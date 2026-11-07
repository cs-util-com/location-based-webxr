import { describe, expect, it, vi } from "vitest";

import {
  GLOBE_QUALITIES,
  GLOBE_QUALITY_NAMES,
  GLOBE_QUALITY_PARAM,
  globeQualityPixelRatio,
  resolveGlobeQuality,
} from "./globe-quality.js";

/**
 * Why these tests matter: the quality names are the contract the sea and
 * the near clouds are built against, by two builders at once, so the names,
 * their order and what each sets must not drift. The table's steps are
 * checked as an order (a higher tier never costs less), since a mistyped
 * value would otherwise only show as a slow or a coarse picture on a device
 * nobody tested. The default follows the pointer: low is never a default,
 * and a mistyped link degrades to that default with a warning.
 */
describe("the quality table", () => {
  it("names three tiers, cheapest first", () => {
    expect(GLOBE_QUALITY_NAMES).toEqual(["low", "medium", "high"]);
    expect(Object.keys(GLOBE_QUALITIES)).toEqual(["low", "medium", "high"]);
    expect(GLOBE_QUALITY_PARAM).toBe("quality");
  });

  it("carries the look's wave sets, the far sea's long waves on low", () => {
    expect(GLOBE_QUALITIES.low.sea).toEqual({
      waveOctaves: 6,
      shortestWaveM: 32,
    });
    expect(GLOBE_QUALITIES.medium.sea).toEqual({
      waveOctaves: 7,
      shortestWaveM: 16,
    });
    expect(GLOBE_QUALITIES.high.sea).toEqual({
      waveOctaves: 8,
      shortestWaveM: 8,
    });
  });

  it("every tier's waves reach the same longest wave", () => {
    for (const { sea } of Object.values(GLOBE_QUALITIES)) {
      expect(sea.shortestWaveM * 2 ** (sea.waveOctaves - 1)).toBe(1024);
    }
  });

  it("never costs less on a higher tier", () => {
    const [low, medium, high] = GLOBE_QUALITY_NAMES.map(
      (name) => GLOBE_QUALITIES[name],
    );
    if (!low || !medium || !high) throw new Error("three tiers expected");
    expect(low.pixelRatioCap).toBeLessThan(medium.pixelRatioCap);
    expect(medium.pixelRatioCap).toBeLessThan(high.pixelRatioCap);
    expect(low.clouds.maxPixelsPerCss).toBeLessThan(
      medium.clouds.maxPixelsPerCss,
    );
    expect(medium.clouds.maxPixelsPerCss).toBeLessThan(
      high.clouds.maxPixelsPerCss,
    );
    expect(low.clouds.entrySubSteps).toBeLessThanOrEqual(
      high.clouds.entrySubSteps,
    );
  });

  it("each cloud law runs outward, with values in range", () => {
    for (const { clouds } of Object.values(GLOBE_QUALITIES)) {
      expect(clouds.law.length).toBeGreaterThan(0);
      let last = 0;
      for (const step of clouds.law) {
        expect(step.distanceKm).toBeGreaterThan(last);
        last = step.distanceKm;
        expect(step.march).toBeGreaterThan(0);
        expect(step.march).toBeLessThanOrEqual(1);
        expect(step.pixelsPerCss).toBeGreaterThan(0);
        expect(step.pixelsPerCss).toBeLessThanOrEqual(clouds.maxPixelsPerCss);
      }
    }
  });
});

describe("resolveGlobeQuality", () => {
  it("defaults to high with a fine pointer, medium with a coarse one", () => {
    expect(resolveGlobeQuality(null, false)).toBe("high");
    expect(resolveGlobeQuality(null, true)).toBe("medium");
  });

  it("a named tier wins over the pointer, silently", () => {
    const warn = vi.fn();
    expect(resolveGlobeQuality("low", false, warn)).toBe("low");
    expect(resolveGlobeQuality("high", true, warn)).toBe("high");
    expect(warn).not.toHaveBeenCalled();
  });

  it("a mistyped name is the default, with one warning", () => {
    const warn = vi.fn();
    expect(resolveGlobeQuality("ultra", true, warn)).toBe("medium");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("ultra");
  });

  it("does not take an inherited property for a tier", () => {
    const warn = vi.fn();
    expect(resolveGlobeQuality("constructor", false, warn)).toBe("high");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("globeQualityPixelRatio", () => {
  it("caps the device's ratio by the tier", () => {
    expect(globeQualityPixelRatio("high", 3)).toBe(2);
    expect(globeQualityPixelRatio("medium", 3)).toBe(1.5);
    expect(globeQualityPixelRatio("low", 3)).toBe(1);
  });

  it("keeps a device below the cap at its own ratio", () => {
    expect(globeQualityPixelRatio("high", 1.25)).toBe(1.25);
  });

  it("reads a missing or broken device ratio as 1", () => {
    expect(globeQualityPixelRatio("high", 0)).toBe(1);
    expect(globeQualityPixelRatio("high", Number.NaN)).toBe(1);
  });

  it("refuses a name not in the table", () => {
    expect(() => globeQualityPixelRatio("ultra" as "high", 2)).toThrow(
      RangeError,
    );
  });
});
