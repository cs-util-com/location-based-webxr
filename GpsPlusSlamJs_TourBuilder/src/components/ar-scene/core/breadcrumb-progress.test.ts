import { describe, expect, it } from "vitest";

import { advanceBreadcrumbProgress } from "./breadcrumb-progress.js";
import type { HorizontalPoint } from "./trail-window.js";

const ORIGIN: HorizontalPoint = { x: 0, z: 0 };
const RADIUS_M = 5;

/** Points laid out along +X at the given distances from the origin. */
function pointsAt(...distances: number[]): HorizontalPoint[] {
  return distances.map((x) => ({ x, z: 0 }));
}

describe("advanceBreadcrumbProgress", () => {
  it("returns null/null when there is no user position", () => {
    const result = advanceBreadcrumbProgress(
      pointsAt(1, 2),
      new Set(),
      null,
      RADIUS_M,
    );
    expect(result).toEqual({
      next: null,
      newlyVisited: null,
      nextDistSq: null,
    });
  });

  it("returns null/null for an empty points array", () => {
    const result = advanceBreadcrumbProgress([], new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({
      next: null,
      newlyVisited: null,
      nextDistSq: null,
    });
  });

  it("returns null/null when every point is already visited", () => {
    const points = pointsAt(1, 2);
    const result = advanceBreadcrumbProgress(
      points,
      new Set([0, 1]),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({
      next: null,
      newlyVisited: null,
      nextDistSq: null,
    });
  });

  it("picks the nearest unvisited point when it is beyond the arrival radius", () => {
    const points = pointsAt(20, 10, 30); // nearest unvisited is index 1 (10 m)
    const result = advanceBreadcrumbProgress(
      points,
      new Set(),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: 1, newlyVisited: null, nextDistSq: 100 });
  });

  it("ignores already-visited points even when they are nearest (BW3 one-way latch)", () => {
    const points = pointsAt(10, 20); // index 0 is nearest but visited
    const result = advanceBreadcrumbProgress(
      points,
      new Set([0]),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: 1, newlyVisited: null, nextDistSq: 400 });
  });

  it("marks arrival and advances to the following point in the same call (BW4)", () => {
    const points = pointsAt(3, 10); // index 0 within the 5 m radius
    const result = advanceBreadcrumbProgress(
      points,
      new Set(),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: 1, newlyVisited: 0, nextDistSq: 100 });
  });

  it("marks arrival with nothing left to advance to", () => {
    const points = pointsAt(3);
    const result = advanceBreadcrumbProgress(
      points,
      new Set(),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: null, newlyVisited: 0, nextDistSq: null });
  });

  it("treats a point exactly at the arrival radius as arrived (inclusive, matches trail-window's <=)", () => {
    const points = pointsAt(5, 10);
    const result = advanceBreadcrumbProgress(
      points,
      new Set(),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: 1, newlyVisited: 0, nextDistSq: 100 });
  });

  it("skips points that could not be converted to world space", () => {
    const points: (HorizontalPoint | null)[] = [null, { x: 3, z: 0 }];
    const result = advanceBreadcrumbProgress(
      points,
      new Set(),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: null, newlyVisited: 1, nextDistSq: null });
  });
});
