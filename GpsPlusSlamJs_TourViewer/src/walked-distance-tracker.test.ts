/**
 * How far the author has walked in the running visit (review R1 and R3 of
 * D33, authoring plan 2026-09-28-0953 §7p).
 *
 * Why these tests matter: the settle decides by WALKED distance which code
 * event a note shares its alignment with (R1) and which sighting corrects
 * it (R3), because SLAM drift grows with the distance walked, not with
 * time. The distance is the odometry path length over the store's device
 * fixes; a synthetic code vote's odometry is the code's corner, not a
 * place anybody walked, so counting one would add a jump of metres.
 */
import { describe, expect, it } from "vitest";

import { createWalkedDistanceTracker } from "./walked-distance-tracker.js";

/** A store fix and its odometry partner (odometry NUE: x north, y up,
 *  z east). */
function sample(
  n: number,
  e: number,
  source?: string,
): {
  fix: {
    latitude: number;
    longitude: number;
    latLongAccuracy: number;
    timestamp: number;
    source?: string;
  };
  odom: number[];
} {
  return {
    fix: {
      latitude: 48.1,
      longitude: 11.5,
      latLongAccuracy: 5,
      timestamp: 1_000,
      ...(source === undefined ? {} : { source }),
    },
    odom: [n, 1.4 + n * 0.1, e],
  };
}

function lists(samples: ReturnType<typeof sample>[]) {
  return {
    gpsPositions: samples.map((s) => s.fix),
    odometryPositions: samples.map((s) => s.odom),
  };
}

describe("createWalkedDistanceTracker", () => {
  // Why this test matters: the path length is the sum of the horizontal
  // steps between consecutive fixes; height is no walk (stairs aside, a
  // phone's height wobbles).
  it("sums the horizontal steps between consecutive device fixes, height ignored", () => {
    const tracker = createWalkedDistanceTracker();
    expect(tracker.update(lists([]))).toBe(0);
    expect(tracker.update(lists([sample(0, 0)]))).toBe(0);
    const walk = [sample(0, 0), sample(3, 4), sample(3, 10)];
    expect(createWalkedDistanceTracker().update(lists(walk))).toBeCloseTo(
      11,
      9,
    );
  });

  // Why this test matters: an out-and-back returns to where it started,
  // but its drift grew all the way; the length counts both legs, which a
  // displacement would not.
  it("counts an out-and-back in full", () => {
    const walk = [sample(0, 0), sample(0, 20), sample(0, 0)];
    expect(createWalkedDistanceTracker().update(lists(walk))).toBeCloseTo(
      40,
      9,
    );
  });

  // Why this test matters: synthetic code votes sit in the same list with
  // the code's odometry; through `deviceSamples` (the one device-only
  // filter of the store's history) they are skipped, and the step bridges
  // the device fixes on either side.
  it("skips synthetic votes and unknown sources", () => {
    const walk = [
      sample(0, 0),
      sample(50, 50, "synthetic-qr"),
      sample(0, 3),
      sample(70, 0, "some-future-source"),
      sample(0, 5, "device"),
    ];
    expect(createWalkedDistanceTracker().update(lists(walk))).toBeCloseTo(5, 9);
  });

  // Why this test matters: it is called on every store change with the
  // growing list; it folds only the new tail and gives the same answer.
  it("folds a growing list incrementally", () => {
    const tracker = createWalkedDistanceTracker();
    const walk = [sample(0, 0), sample(1, 0)];
    expect(tracker.update(lists(walk))).toBeCloseTo(1, 9);
    walk.push(sample(1, 7));
    const grown = lists(walk);
    expect(tracker.update(grown)).toBeCloseTo(8, 9);
    expect(tracker.update(grown)).toBeCloseTo(8, 9);
  });

  // Why this test matters: a store reset (a new AR entry) or a swapped
  // list is a new walk, counted from scratch, never added to the old one.
  it("starts over on a shorter list or one with another first fix", () => {
    const tracker = createWalkedDistanceTracker();
    tracker.update(lists([sample(0, 0), sample(0, 30)]));
    expect(tracker.update(lists([sample(5, 5)]))).toBe(0);
    const other = [sample(0, 0), sample(4, 0)];
    expect(tracker.update(lists(other))).toBeCloseTo(4, 9);
    const swapped = [sample(0, 0), sample(0, 2), sample(0, 3)];
    expect(tracker.update(lists(swapped))).toBeCloseTo(3, 9);
  });

  // Why this test matters: external data (a replay, an older shape) can
  // carry a fix without readable odometry; it adds no step and does not
  // break the walk.
  it("bridges a fix whose odometry does not read", () => {
    const walk = [sample(0, 0), sample(0, 4), sample(0, 6)];
    const input = lists(walk);
    const broken = {
      gpsPositions: input.gpsPositions,
      odometryPositions: [
        input.odometryPositions[0]!,
        [Number.NaN, 0, 0],
        input.odometryPositions[2]!,
      ],
    };
    expect(createWalkedDistanceTracker().update(broken)).toBeCloseTo(6, 9);
  });
});
