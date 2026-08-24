/**
 * The route as scene geometry, and as a walk along it.
 *
 * WHY THESE TESTS MATTER. Two things go wrong here and neither is visible in a
 * screenshot:
 *
 * 1. **The ENU→scene reflection.** `+y` north becomes `-z` north, and getting it
 *    wrong mirrors the route about the east axis — which still starts at the
 *    agent, still ends near the click, and still looks like a plausible path.
 *    The package's own `mesh-orientation.test.ts` exists because exactly that
 *    shipped unnoticed once.
 * 2. **The walk.** An agent that reaches its destination is the easy half; an
 *    agent that keeps reporting "still moving" after it arrives is a permanent
 *    render loop, which is the measured regression DEC-R11-15 names — ~6x
 *    slower e2e and one test into a timeout. `done` is therefore asserted as
 *    hard as the position is.
 */

import { describe, expect, it } from "vitest";
import { enuFrameAt } from "gps-plus-slam-osm";

import {
  pathLengthM,
  pointAlong,
  scenePathOf,
  AGENT_SPEED_MPS,
} from "./route-path.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(HOME);
/** ~11 m of latitude, so the numbers below are metres rather than degrees. */
const TENTH_MILLI = 0.0001;

describe("scenePathOf", () => {
  it("puts NORTH at negative z, which is the scene's convention", () => {
    // THE REFLECTION, as the first assertion in the file. A route drawn in the
    // mirrored frame runs south past the wall it was supposed to go round, and
    // every other assertion here would still pass.
    const path = scenePathOf(
      [
        { position: HOME, heightM: 0 },
        {
          position: { lat: HOME.lat + TENTH_MILLI, lng: HOME.lng },
          heightM: 0,
        },
      ],
      FRAME,
      0,
    );

    expect(path).toHaveLength(2);
    expect(path[0]!.x).toBeCloseTo(0, 6);
    expect(path[0]!.z).toBeCloseTo(0, 6);
    // North of the origin, so z must be NEGATIVE and about 11 m away.
    expect(path[1]!.z).toBeLessThan(0);
    expect(Math.abs(path[1]!.z)).toBeGreaterThan(10);
    expect(path[1]!.x).toBeCloseTo(0, 6);
  });

  it("puts EAST at positive x", () => {
    // The counterweight: without it, a path that negated BOTH axes would pass
    // the north test by accident.
    const path = scenePathOf(
      [
        { position: HOME, heightM: 0 },
        {
          position: { lat: HOME.lat, lng: HOME.lng + TENTH_MILLI },
          heightM: 0,
        },
      ],
      FRAME,
      0,
    );

    expect(path[1]!.x).toBeGreaterThan(0);
    expect(path[1]!.z).toBeCloseTo(0, 6);
  });

  it("lifts every point off the ground it was sampled on", () => {
    // The route is coplanar with the terrain by construction — `heightM` IS the
    // ground height at that cell — so an unlifted line z-fights the ground for
    // its whole length. That reads as a rendering bug rather than as a route.
    const path = scenePathOf(
      [
        { position: HOME, heightM: 12 },
        {
          position: { lat: HOME.lat + TENTH_MILLI, lng: HOME.lng },
          heightM: 15,
        },
      ],
      FRAME,
      0.2,
    );

    expect(path[0]!.y).toBeCloseTo(12.2, 6);
    expect(path[1]!.y).toBeCloseTo(15.2, 6);
  });

  it("returns an empty path for an empty route", () => {
    expect(scenePathOf([], FRAME, 0)).toStrictEqual([]);
  });
});

describe("pathLengthM", () => {
  it("sums the segments, climb included", () => {
    // 3-4-5: the climb is part of the distance, so an agent walking up a hill
    // does not arrive early. Asserting a triangle rather than a flat line is
    // what makes the third coordinate observable.
    expect(
      pathLengthM([
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ]),
    ).toBeCloseTo(5, 6);
  });

  it("is zero for a path with fewer than two points", () => {
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([{ x: 5, y: 5, z: 5 }])).toBe(0);
  });
});

describe("pointAlong", () => {
  const straight = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 20, y: 0, z: 0 },
  ];

  it("starts at the first point", () => {
    expect(pointAlong(straight, 0)).toEqual({
      point: { x: 0, y: 0, z: 0 },
      done: false,
    });
  });

  it("interpolates INSIDE a segment, not just between vertices", () => {
    // A walk that only ever snapped to vertices would still arrive, and would
    // still stop — it would just move in visible jumps. This is the assertion
    // that separates a real interpolation from a step function.
    expect(pointAlong(straight, 5)?.point.x).toBeCloseTo(5, 6);
    expect(pointAlong(straight, 15)?.point.x).toBeCloseTo(15, 6);
  });

  it("reports DONE at the end and never walks past it", () => {
    // THE ASSERTION THE FRAME SCHEDULING RESTS ON. `done` is what stops the
    // animation, so a walk that never reports it is a permanent rAF loop —
    // the measured ~6x e2e slowdown DEC-R11-15 accepted the risk of.
    const atEnd = pointAlong(straight, 20);
    expect(atEnd).toEqual({ point: { x: 20, y: 0, z: 0 }, done: true });

    const past = pointAlong(straight, 1000);
    expect(past).toEqual({ point: { x: 20, y: 0, z: 0 }, done: true });
  });

  it("clamps a negative distance to the start rather than extrapolating", () => {
    // Defensive: a clock that goes backwards (a tab restored from bfcache, a
    // test that rewinds) must not send the agent off the front of its route.
    expect(pointAlong(straight, -5)).toEqual({
      point: { x: 0, y: 0, z: 0 },
      done: false,
    });
  });

  it("returns undefined for an empty path", () => {
    expect(pointAlong([], 3)).toBeUndefined();
  });

  it("is DONE immediately for a single-point path", () => {
    // A route whose start cell is its goal cell. Without this it would be a walk
    // of length zero that never completes, which is the render-loop failure
    // arriving through the shortest possible route.
    expect(pointAlong([{ x: 1, y: 2, z: 3 }], 0)).toEqual({
      point: { x: 1, y: 2, z: 3 },
      done: true,
    });
  });
});

describe("AGENT_SPEED_MPS", () => {
  it("is a demo pace: faster than walking, slower than a vehicle", () => {
    // Pinned because it is the one number that decides how long the e2e's
    // "the scene goes quiet" assertion has to wait. At a human 1.4 m/s a 200 m
    // route is nearly two and a half minutes, which is neither watchable nor
    // testable; anything much above this reads as a car rather than an agent.
    expect(AGENT_SPEED_MPS).toBeGreaterThan(5);
    expect(AGENT_SPEED_MPS).toBeLessThan(20);
  });
});
