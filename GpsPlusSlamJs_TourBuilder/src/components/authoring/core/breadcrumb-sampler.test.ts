import { describe, expect, it } from "vitest";

import {
  MIN_BREADCRUMB_DISTANCE_M,
  shouldSampleBreadcrumbPoint,
} from "./breadcrumb-sampler.js";

/**
 * Why this matters: this is the only thing standing between a noisy phone GPS
 * (1-2 m jitter, TASK.md §2.5.2) and a breadcrumb trail with a point recorded
 * on every tick. Distance is always measured from the last *sampled* point,
 * never accumulated across small moves and never from the last raw fix —
 * that's the one non-obvious contract pinned below.
 */

const ORIGIN = { lat: 50.7753, lon: 6.0839 };

/** ~1 degree of latitude is ~111,320 m; small deltas approximate meters. */
function metersNorth(base: typeof ORIGIN, meters: number) {
  return { lat: base.lat + meters / 111_320, lon: base.lon };
}

describe("shouldSampleBreadcrumbPoint", () => {
  it("always samples the first point (last === null)", () => {
    expect(shouldSampleBreadcrumbPoint(null, ORIGIN)).toBe(true);
  });

  it("does not sample a point under the minimum distance from the last sampled point", () => {
    const next = metersNorth(ORIGIN, MIN_BREADCRUMB_DISTANCE_M - 1);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, next)).toBe(false);
  });

  it("samples a point clearly past the minimum distance", () => {
    const next = metersNorth(ORIGIN, MIN_BREADCRUMB_DISTANCE_M + 1);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, next)).toBe(true);
  });

  it("respects a custom minDistanceM override", () => {
    const next = metersNorth(ORIGIN, 1);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, next, 0.5)).toBe(true);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, next, 5)).toBe(false);
  });

  it("measures from the last SAMPLED point, not an accumulation of small moves", () => {
    // Two 2 m hops from the same last-sampled point never sum to "moved 4 m" —
    // each is independently checked against the same last-sampled point.
    const hop1 = metersNorth(ORIGIN, 2);
    const hop2 = metersNorth(ORIGIN, 2);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, hop1)).toBe(false);
    expect(shouldSampleBreadcrumbPoint(ORIGIN, hop2)).toBe(false);
  });
});
