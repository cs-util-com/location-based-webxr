import { describe, expect, it } from "vitest";

import { hasNearbyTrail, MIN_TRAIL_COVERAGE_COUNT } from "./trail-coverage.js";
import type { HorizontalPoint } from "./trail-window.js";

/** `count` points at distance `distanceM` from the origin along +X. */
function pointsAt(count: number, distanceM: number): HorizontalPoint[] {
  return Array.from({ length: count }, () => ({ x: distanceM, z: 0 }));
}

const ORIGIN: HorizontalPoint = { x: 0, z: 0 };
const RADIUS_M = 15;

describe("hasNearbyTrail", () => {
  it("returns false for an empty breadcrumb array", () => {
    expect(hasNearbyTrail(ORIGIN, [], RADIUS_M)).toBe(false);
  });

  it("returns true when at least minCount points are within radius", () => {
    expect(hasNearbyTrail(ORIGIN, pointsAt(10, 5), RADIUS_M, 10)).toBe(true);
  });

  it("returns false when one short of minCount points are within radius", () => {
    expect(hasNearbyTrail(ORIGIN, pointsAt(9, 5), RADIUS_M, 10)).toBe(false);
  });

  it("does not count points outside the radius, however many there are", () => {
    expect(hasNearbyTrail(ORIGIN, pointsAt(50, 20), RADIUS_M, 10)).toBe(false);
  });

  it("counts a point exactly on the radius boundary (inclusive, matches selectTrailWindow)", () => {
    expect(hasNearbyTrail(ORIGIN, pointsAt(10, 15), RADIUS_M, 10)).toBe(true);
  });

  it("skips null entries and only counts non-null in-range points", () => {
    const points: (HorizontalPoint | null)[] = [
      ...pointsAt(9, 5),
      null,
      null,
      null,
    ];
    expect(hasNearbyTrail(ORIGIN, points, RADIUS_M, 10)).toBe(false);
    expect(
      hasNearbyTrail(ORIGIN, [...points, { x: 5, z: 0 }], RADIUS_M, 10),
    ).toBe(true);
  });

  it("defaults minCount to MIN_TRAIL_COVERAGE_COUNT when omitted", () => {
    expect(
      hasNearbyTrail(ORIGIN, pointsAt(MIN_TRAIL_COVERAGE_COUNT, 5), RADIUS_M),
    ).toBe(true);
    expect(
      hasNearbyTrail(
        ORIGIN,
        pointsAt(MIN_TRAIL_COVERAGE_COUNT - 1, 5),
        RADIUS_M,
      ),
    ).toBe(false);
  });
});
