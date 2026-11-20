import type { DepthSample } from "gps-plus-slam-app-framework/state";
import { describe, expect, it } from "vitest";

import {
  depthNear,
  depthSeeds,
  planWindowJob,
  shellSeeds,
  splatCamera,
  voxelThin,
  type ColourAt,
} from "./splat-inputs.js";
import { TRAINER_DEFAULTS } from "./trainer-defaults.js";
import type { SplatInputs } from "./recording-reader.js";
import type { PlannedWindow } from "./window-plan.js";

/** A centred 90-degree-ish projection (column-major): fx = W/2 * 1. */
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.02, 0] as const;
const K = { fx: 32, fy: 24, cx: 32, cy: 24 };
const W = 64;
const H = 48;
const IDENTITY = [0, 0, 0, 1] as const;
/** Half a turn about +y: the camera looks along world +z. */
const TURNED = [0, 1, 0, 0] as const;

/** Applies an OpenCV world-to-camera entry and projects to pixels. */
function project(
  cam: ReturnType<typeof splatCamera>,
  X: readonly number[],
): [number, number, number] {
  const R = cam.R_w2c_rowmajor;
  const c = [0, 1, 2].map(
    (r) =>
      (R[r * 3] ?? 0) * (X[0] ?? 0) +
      (R[r * 3 + 1] ?? 0) * (X[1] ?? 0) +
      (R[r * 3 + 2] ?? 0) * (X[2] ?? 0) +
      (cam.t_w2c[r] ?? 0),
  );
  const z = c[2] ?? 0;
  return [
    (cam.fx * (c[0] ?? 0)) / z + cam.cx,
    (cam.fy * (c[1] ?? 0)) / z + cam.cy,
    z,
  ];
}

const red: ColourAt = () => [1, 0, 0];

describe("splatCamera", () => {
  // Why: a sign slip in the WebXR-to-OpenCV flip trains every photo from
  // behind its camera; a point straight ahead must land on the principal
  // point at its true depth, for an unturned and a turned camera alike.
  it("puts a point straight ahead on the principal point", () => {
    const cam = splatCamera(
      "a.jpg",
      { position: [1, 2, 3], rotation: IDENTITY },
      K,
      W,
      H,
    );
    expect(cam).toMatchObject({ image: "a.jpg", width: W, height: H, ...K });
    const [u, v, z] = project(cam, [1, 2, -2]);
    expect(u).toBeCloseTo(32);
    expect(v).toBeCloseTo(24);
    expect(z).toBeCloseTo(5);
    const turned = splatCamera(
      "b.jpg",
      { position: [0, 0, 0], rotation: TURNED },
      K,
      W,
      H,
    );
    expect(project(turned, [0, 0, 4])[2]).toBeCloseTo(4);
  });

  // Why: image y grows downward in OpenCV; a point above the camera must
  // land in the upper half of the photo, a point to its right in the right.
  it("keeps up as up and right as right", () => {
    const cam = splatCamera(
      "a.jpg",
      { position: [0, 0, 0], rotation: IDENTITY },
      K,
      W,
      H,
    );
    const [u, v] = project(cam, [1, 1, -4]);
    expect(u).toBeGreaterThan(32);
    expect(v).toBeLessThan(24);
  });
});

function sample(
  points: DepthSample["points"],
  timestamp = 0,
  pos: [number, number, number] = [0, 0, 0],
): DepthSample {
  return {
    timestamp,
    cameraPos: pos,
    cameraRot: [...IDENTITY],
    points,
    projectionMatrix: [...P],
  };
}

describe("depthSeeds", () => {
  // Why: a seed must sit where the depth reading says and carry the
  // photo's colour at that pixel; readings off the photo or without depth
  // are dropped, never seeded at the origin.
  it("unprojects readings and colours them from the photo", () => {
    const seen: [number, number][] = [];
    const colour: ColourAt = (u, v) => {
      seen.push([u, v]);
      return [0.2, 0.4, 0.6];
    };
    const seeds = depthSeeds(
      [
        sample([
          { screenX: 0.5, screenY: 0.5, depthM: 3 },
          { screenX: 0.5, screenY: 0.5, depthM: 0 },
          { screenX: 0.5, screenY: 0.5, depthM: Number.NaN },
        ]),
      ],
      W,
      H,
      colour,
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.X[2]).toBeCloseTo(-3);
    expect(seeds[0]?.X[0]).toBeCloseTo(0);
    expect(seeds[0]?.rgb).toEqual([0.2, 0.4, 0.6]);
    expect(seen).toEqual([[32, 24]]);
  });

  // Why: a pixel the photo does not have (null colour) must drop the seed.
  it("drops readings the photo has no colour for", () => {
    expect(
      depthSeeds(
        [sample([{ screenX: 0.5, screenY: 0.5, depthM: 3 }])],
        W,
        H,
        () => null,
      ),
    ).toEqual([]);
  });

  // Why: a sample without a projection cannot be unprojected; it is
  // skipped rather than throwing for the whole window.
  it("skips a sample without a projection", () => {
    const bad = { ...sample([{ screenX: 0.5, screenY: 0.5, depthM: 3 }]) };
    delete (bad as { projectionMatrix?: unknown }).projectionMatrix;
    expect(depthSeeds([bad], W, H, red)).toEqual([]);
  });
});

describe("shellSeeds", () => {
  // Why: the shell gives far background something to start from; every
  // point must lie at the shell distance from its camera, in front of it,
  // one per grid square.
  it("puts one point per grid square at the shell distance", () => {
    const seeds = shellSeeds(
      { position: [1, 0, 0], rotation: IDENTITY },
      K,
      W,
      H,
      { distanceM: 40, gridPx: 16 },
      red,
    );
    expect(seeds).toHaveLength((W / 16) * (H / 16));
    for (const s of seeds) {
      expect(Math.hypot(s.X[0] - 1, s.X[1], s.X[2])).toBeCloseTo(40);
      expect(s.X[2]).toBeLessThan(0);
      expect(s.rgb).toEqual([1, 0, 0]);
    }
  });

  // Why: options that would loop forever or seed nothing are a caller bug.
  it("refuses a grid or distance that is not positive", () => {
    const pose = { position: [0, 0, 0] as const, rotation: IDENTITY };
    expect(() =>
      shellSeeds(pose, K, W, H, { distanceM: 0, gridPx: 16 }, red),
    ).toThrow(RangeError);
    expect(() =>
      shellSeeds(pose, K, W, H, { distanceM: 40, gridPx: 0 }, red),
    ).toThrow(RangeError);
  });
});

describe("voxelThin", () => {
  // Why: thinning bounds the seed count; points sharing a cube become
  // their mean, points in different cubes stay apart, in first-seen order.
  it("merges points per cube into their mean", () => {
    const out = voxelThin(
      [
        { X: [0.01, 0, 0], rgb: [1, 0, 0] },
        { X: [5, 5, 5], rgb: [0, 0, 1] },
        { X: [0.03, 0, 0], rgb: [0, 1, 0] },
      ],
      0.05,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.X[0]).toBeCloseTo(0.02);
    expect(out[0]?.rgb).toEqual([0.5, 0.5, 0]);
    expect(out[1]?.X).toEqual([5, 5, 5]);
    expect(() => voxelThin([], 0)).toThrow(RangeError);
  });
});

describe("depthNear", () => {
  // Why: a photo is seeded only by readings taken with it; an untimed
  // photo cannot be matched and gets none rather than a wrong one.
  it("keeps the samples within the time tolerance", () => {
    const s = [sample([], 0), sample([], 150), sample([], 500)];
    expect(depthNear(100, s, 200).map((x) => x.timestamp)).toEqual([0, 150]);
    expect(depthNear(null, s, 200)).toEqual([]);
  });
});

describe("planWindowJob", () => {
  const captures = Array.from({ length: 6 }, (_, i) => ({
    entry: `rec/photo-${String(i)}.jpg`,
    position: [i, 0, 0] as [number, number, number],
    rotation: [...IDENTITY] as [number, number, number, number],
    screenRotation: 0,
    capturedAt: i * 1000,
  }));
  const inputs = {
    captures,
    intrinsics: K,
    projectionMatrix: [...P],
    depthSamples: [sample([], 2000), sample([], 9000)],
    census: { frameWidth: W, frameHeight: H },
  } as unknown as SplatInputs;
  const planned = {
    id: "w0",
    index: 0,
    fromM: 0,
    toM: 5,
    frames: 6,
    window: {
      segment: 0,
      core: [0, 1, 2, 3, 4, 5],
      train: [1, 2, 4, 5],
      holdouts: [0, 3],
      tooFewHoldouts: false,
      tooFewFrames: false,
    },
  } as PlannedWindow;

  // Why: this is the whole contract between the page's plan and the
  // trainer: which photos load, which are scored and never trained, how
  // long it trains and what the crop keeps.
  it("lists the window's photos, its test set and its budget", () => {
    const job = planWindowJob(inputs, planned, 2, TRAINER_DEFAULTS);
    expect(job.photos.map((p) => [p.entry, p.train])).toEqual([
      ["rec/photo-0.jpg", false],
      ["rec/photo-1.jpg", true],
      ["rec/photo-2.jpg", true],
      ["rec/photo-3.jpg", false],
      ["rec/photo-4.jpg", true],
      ["rec/photo-5.jpg", true],
    ]);
    expect(job.evalFrames).toEqual([job.photos[0]?.name, job.photos[3]?.name]);
    expect(new Set(job.photos.map((p) => p.name)).size).toBe(6);
    expect(job.photos.every((p) => p.camera.image === p.name)).toBe(true);
    expect(job.maxIters).toBe(TRAINER_DEFAULTS.minIterations);
    expect(job.deadlineMs).toBe(TRAINER_DEFAULTS.deadlineS * 1000 * 2);
    expect(job.keepM).toBeCloseTo(
      TRAINER_DEFAULTS.keepFraction * TRAINER_DEFAULTS.shellDistanceM,
    );
    expect(job.trainPositions).toEqual([
      [1, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
    ]);
    // Only training photos seed; photo 2 was taken with the first sample.
    expect(job.photos.map((p) => p.depth.length)).toEqual([0, 0, 1, 0, 0, 0]);
    // Every shellEveryPhoto-th training photo grows shell points.
    expect(job.photos.filter((p) => p.shell).map((p) => p.entry)).toEqual([
      "rec/photo-1.jpg",
    ]);
  });

  // Why: a time scale that is not a positive number must not give a zero
  // or NaN deadline that ends training before it starts.
  it("treats a time scale that is not positive as one", () => {
    expect(
      planWindowJob(inputs, planned, Number.NaN, TRAINER_DEFAULTS).deadlineMs,
    ).toBe(TRAINER_DEFAULTS.deadlineS * 1000);
  });
});
