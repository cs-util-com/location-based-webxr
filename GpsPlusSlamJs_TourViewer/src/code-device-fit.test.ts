/**
 * Where a visit's own GPS puts a code, with a code's votes left out: the
 * visit's alignment refitted from its device fixes alone, and the pose of
 * the code the fit is read at (the start and end sightings of one code
 * close the loop).
 *
 * Why these tests matter: a visit lined up by a stored code's votes keeps
 * those votes in its alignment, so the code seen through that alignment
 * sits exactly where it is stored. Read as a measurement, that is a
 * confirmation the visit never made. The fit here is the visit's only
 * independent view of the code; if it let the reference alignment's
 * heading or position leak in, the votes would be back in by the side
 * door. If the loop closure picked the wrong sighting, the AR drift of the
 * walk would land on the code.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";

import {
  codeDeviceFit,
  codeFitPose,
  deviceFitAlignment,
} from "./code-device-fit.js";
import type { DisplacementSample } from "./code-displacement.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";

const rad = (d: number): number => (d * Math.PI) / 180;

/** A yaw-only alignment (odometry-NUE to world-NUE). */
function yawAlignment(deg: number, t: [number, number, number]): number[] {
  const h = rad(deg) / 2;
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(0, Math.sin(h), 0, Math.cos(h)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

/** Where `alignment` puts the odometry-NUE point (n, up, e). */
function at(
  alignment: readonly number[],
  n: number,
  e: number,
  up = 0,
): [number, number, number] {
  const p = throughAlignment(
    { position: [n, up, e], rotation: [0, 0, 0, 1] },
    alignment,
  )!.position;
  return [p[0], p[1], p[2]];
}

/** Device fixes along a walk, placed exactly where `truth` puts them. */
function walk(
  truth: readonly number[],
  path: readonly [number, number][],
  t0 = 1_000_000,
): DisplacementSample[] {
  return path.map(([n, e], i) => {
    const w = at(truth, n, e);
    return { tMs: t0 + i * 1000, gps: [w[0], w[2]], odom: [n, e] };
  });
}

/** An L-shaped walk of about 30 m. */
const L_WALK: [number, number][] = [
  ...Array.from({ length: 16 }, (_, i): [number, number] => [i, 0]),
  ...Array.from({ length: 15 }, (_, i): [number, number] => [15, i + 1]),
];

describe("deviceFitAlignment", () => {
  it("finds the walk's own alignment whatever the reference says, and keeps the reference's height", () => {
    const truth = yawAlignment(37, [12, 400, -5]);
    // A reference held elsewhere (by a code's votes): another heading,
    // another place, another height.
    const reference = yawAlignment(-80, [40, 380, 22]);
    const fit = deviceFitAlignment(walk(truth, L_WALK), reference);
    expect(fit).not.toBeNull();
    for (const [n, e] of [
      [0, 0],
      [7, 3],
      [-4, 9],
    ] as const) {
      const got = at(fit!.alignment, n, e, 1.5);
      const want = at(truth, n, e);
      expect(Math.hypot(got[0] - want[0], got[2] - want[2])).toBeLessThan(1e-6);
      expect(got[1]).toBeCloseTo(at(reference, n, e, 1.5)[1], 9);
    }
    expect(fit!.samples).toBe(L_WALK.length);
  });

  it("refuses fixes with too little spread to fit a heading, an empty walk and an unreadable reference", () => {
    const truth = yawAlignment(10, [0, 400, 0]);
    const reference = yawAlignment(0, [0, 400, 0]);
    // Standing still: the reference's heading would leak into the result.
    const still = walk(
      truth,
      Array.from({ length: 30 }, (): [number, number] => [0.2, 0.1]),
    );
    expect(deviceFitAlignment(still, reference)).toBeNull();
    expect(deviceFitAlignment([], reference)).toBeNull();
    expect(
      deviceFitAlignment(walk(truth, L_WALK), [Number.NaN, ...reference]),
    ).toBeNull();
  });
});

describe("codeDeviceFit (the settle's gate)", () => {
  const truth = yawAlignment(-20, [3, 400, 9]);
  const reference = yawAlignment(5, [0, 400, 0]);
  const reliable = { extentM: 30, accuracyM: 5 };

  it("fits after a walk reliable for its accuracy, with at least three fixes", () => {
    const fit = codeDeviceFit({
      samples: walk(truth, L_WALK),
      reference,
      quality: reliable,
      frameChanged: false,
    });
    expect(fit).not.toBeNull();
  });

  it.each([
    ["a walk too short for its accuracy", { extentM: 20, accuracyM: 8 }],
    ["an unknown accuracy", { extentM: 30, accuracyM: null }],
  ] as const)("refuses %s", (_, quality) => {
    expect(
      codeDeviceFit({
        samples: walk(truth, L_WALK),
        reference,
        quality,
        frameChanged: false,
      }),
    ).toBeNull();
  });

  it("refuses fewer than three fixes, and a visit whose tracking restarted", () => {
    const three = walk(truth, [
      [0, 0],
      [20, 0],
      [20, 20],
    ]);
    expect(
      codeDeviceFit({
        samples: three.slice(0, 2),
        reference,
        quality: reliable,
        frameChanged: false,
      }),
    ).toBeNull();
    expect(
      codeDeviceFit({
        samples: three,
        reference,
        quality: reliable,
        frameChanged: false,
      }),
    ).not.toBeNull();
    expect(
      codeDeviceFit({
        samples: walk(truth, L_WALK),
        reference,
        quality: reliable,
        frameChanged: true,
      }),
    ).toBeNull();
  });
});

describe("codeFitPose (the loop closure)", () => {
  const pose = (x: number, z: number, yawDeg = 0): Pose => {
    const h = rad(yawDeg) / 2;
    return { position: [x, 0, z], rotation: [0, Math.sin(h), 0, Math.cos(h)] };
  };
  const fixes = walk(yawAlignment(0, [0, 400, 0]), L_WALK, 10_000);
  const firstFix = fixes[0]!.tMs;
  const lastFix = fixes.at(-1)!.tMs;

  it("reads the fit at the midpoint of a start and an end sighting that bracket the walk", () => {
    const start = { atMs: firstFix - 5_000, odomPose: pose(0, 0, 10) };
    const end = { atMs: lastFix + 5_000, odomPose: pose(2, -1, 14) };
    const got = codeFitPose([start, end], fixes);
    expect(got?.loopClosed).toBe(true);
    expect(got?.pose.position).toEqual([1, 0, -0.5]);
    // The heading is the latest sighting's.
    expect(got?.pose.rotation).toEqual(end.odomPose.rotation);
  });

  it.each([
    ["the first sighting comes after the first fix", firstFix + 1, lastFix + 1],
    ["the last sighting comes before the last fix", firstFix - 1, lastFix - 1],
  ])("reads the fit at the latest sighting when %s", (_, startAt, endAt) => {
    const start = { atMs: startAt, odomPose: pose(0, 0) };
    const end = { atMs: endAt, odomPose: pose(2, -1) };
    expect(codeFitPose([start, end], fixes)).toEqual({
      pose: end.odomPose,
      loopClosed: false,
    });
  });

  it("reads the fit at the only sighting, and at none without one", () => {
    const only = { atMs: lastFix + 1, odomPose: pose(4, 4) };
    expect(codeFitPose([only], fixes)).toEqual({
      pose: only.odomPose,
      loopClosed: false,
    });
    expect(codeFitPose([], fixes)).toBeNull();
    expect(codeFitPose([only], [])).toEqual({
      pose: only.odomPose,
      loopClosed: false,
    });
  });

  // The point of the closure: the tracking drifts along the walk, so the
  // code's start and end sightings differ by the drift, and the fixes in
  // between carry half of it on average. The midpoint removes that half;
  // the end sighting carries all of it.
  it("removes the walk's drift that the end sighting carries", () => {
    const truth = yawAlignment(30, [5, 400, -8]);
    const driftPerM = [0.03, -0.02] as const;
    const loop: [number, number][] = [
      ...Array.from({ length: 21 }, (_, i): [number, number] => [i, 0]),
      ...Array.from({ length: 20 }, (_, i): [number, number] => [20, i + 1]),
      ...Array.from({ length: 20 }, (_, i): [number, number] => [19 - i, 20]),
      ...Array.from({ length: 20 }, (_, i): [number, number] => [0, 19 - i]),
    ];
    let walked = 0;
    const samples: DisplacementSample[] = loop.map(([n, e], i) => {
      if (i > 0) walked += 1;
      const w = at(truth, n, e);
      return {
        tMs: 10_000 + i * 1000,
        gps: [w[0], w[2]],
        odom: [n + driftPerM[0] * walked, e + driftPerM[1] * walked],
      };
    });
    // The code sits at odometry (0, 0) at the start; the end sighting is
    // in the drifted frame. Raw WebXR: x = east, z = -north.
    const drift = [driftPerM[0] * walked, driftPerM[1] * walked];
    const start = { atMs: 5_000, odomPose: pose(0, 0) };
    const end = { atMs: 200_000, odomPose: pose(drift[1]!, -drift[0]!) };
    const fit = deviceFitAlignment(samples, yawAlignment(0, [0, 400, 0]))!;
    const codeTruth = at(truth, 0, 0);
    const errorAt = (p: Pose): number => {
      const w = throughAlignment(odomNueFromWebXr(p), fit.alignment)!;
      return Math.hypot(
        w.position[0] - codeTruth[0],
        w.position[2] - codeTruth[2],
      );
    };
    const closed = codeFitPose([start, end], samples)!;
    expect(closed.loopClosed).toBe(true);
    const gap = Math.hypot(drift[0]!, drift[1]!);
    expect(errorAt(end.odomPose)).toBeGreaterThan(gap / 3);
    expect(errorAt(closed.pose)).toBeLessThan(errorAt(end.odomPose) / 4);
  });
});
