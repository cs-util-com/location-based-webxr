import { describe, expect, it } from "vitest";

import { createRouteFollower } from "./route-follower.js";

const LINE = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
];

describe("route follower", () => {
  it("walks along the route and faces the direction of travel", () => {
    const follower = createRouteFollower({ path: LINE, speedMps: 2 });

    const pose = follower.advance(3);

    expect(pose.x).toBeCloseTo(6, 5);
    expect(pose.z).toBeCloseTo(0, 5);
    expect(pose.headingRad).toBeCloseTo(0, 5);
  });

  it("carries leftover distance across a corner and turns with the route", () => {
    const follower = createRouteFollower({
      path: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ],
      speedMps: 1,
    });

    const pose = follower.advance(14);

    expect(pose.x).toBeCloseTo(10, 5);
    expect(pose.z).toBeCloseTo(4, 5);
    expect(pose.headingRad).toBeCloseTo(Math.PI / 2, 5);
  });

  it("stops at the end of the route and reports it finished", () => {
    const follower = createRouteFollower({ path: LINE, speedMps: 2 });

    const pose = follower.advance(100);

    expect(pose.x).toBeCloseTo(10, 5);
    expect(pose.z).toBeCloseTo(0, 5);
    expect(follower.isFinished()).toBe(true);
  });

  it("holds still on a route too short to walk", () => {
    const follower = createRouteFollower({
      path: [{ x: 3, z: 4 }],
      speedMps: 2,
    });

    const pose = follower.advance(5);

    expect(pose).toEqual({ x: 3, z: 4, headingRad: 0 });
    expect(follower.isFinished()).toBe(true);
  });

  it("holds still on an empty route rather than throwing", () => {
    const follower = createRouteFollower({ path: [], speedMps: 2 });

    expect(follower.advance(5)).toEqual({ x: 0, z: 0, headingRad: 0 });
    expect(follower.isFinished()).toBe(true);
  });

  it("skips zero-length segments left by a stationary recording", () => {
    const follower = createRouteFollower({
      path: [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: 0, z: 6 },
      ],
      speedMps: 1,
    });

    const pose = follower.advance(2);

    expect(pose.z).toBeCloseTo(2, 5);
    expect(pose.headingRad).toBeCloseTo(Math.PI / 2, 5);
  });
});
