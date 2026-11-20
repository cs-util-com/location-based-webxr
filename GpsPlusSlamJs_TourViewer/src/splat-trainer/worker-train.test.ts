import type { DepthSample } from "gps-plus-slam-app-framework/state";
import { describe, expect, it } from "vitest";

import type { SplatJsModule, SplatSessionLike } from "./splat-js.js";
import type { WindowJob, WindowPhoto } from "./splat-inputs.js";
import {
  colourSampler,
  trainInWorker,
  type DecodedPhoto,
  type WorkerTrainDeps,
} from "./worker-train.js";

const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.02, 0];

/** A 4 x 2 photo, every pixel the given colour. */
function solid(rgb: [number, number, number], w = 4, h = 2): DecodedPhoto {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
}

function photo(name: string, over: Partial<WindowPhoto> = {}): WindowPhoto {
  return {
    name,
    entry: `rec/${name}`,
    train: true,
    camera: {
      image: name,
      R_w2c_rowmajor: [1, 0, 0, 0, -1, 0, 0, 0, -1],
      t_w2c: [0, 0, 0],
      fx: 48,
      fy: 48,
      cx: 48,
      cy: 48,
      width: 96,
      height: 96,
    },
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    depth: [],
    shell: false,
    ...over,
  };
}

const depth: DepthSample = {
  timestamp: 0,
  cameraPos: [0, 0, 0],
  cameraRot: [0, 0, 0, 1],
  points: [
    { screenX: 0.5, screenY: 0.5, depthM: 2.01 },
    { screenX: 0.5, screenY: 0.5, depthM: 2.03 },
  ],
  projectionMatrix: P as unknown as NonNullable<
    DepthSample["projectionMatrix"]
  >,
};

function job(photos: WindowPhoto[]): WindowJob {
  return {
    photos,
    evalFrames: [],
    maxIters: 4000,
    deadlineMs: 1000,
    keepM: 32,
    trainPositions: [[0, 0, 0]],
    seedVoxelM: 0.05,
    shellVoxelM: 1,
    shellDistanceM: 40,
    shellGridPx: 48,
    etaMinIterations: 200,
  };
}

/** A Splat.js that records the seeds it got and finishes at once. */
function finishing(): { mod: SplatJsModule; seeds: unknown[][] } {
  const seeds: unknown[][] = [];
  const handlers: ((e: { kind: string }) => void)[] = [];
  const session = {
    on: (type: string, fn: (e: { kind: string }) => void) => {
      if (type === "event") handlers.push(fn);
    },
    load: () => Promise.resolve(),
    useKnownCameras: (_c: unknown, o: { points: unknown[] }) =>
      seeds.push(o.points),
    seed: () => Promise.resolve(),
    start: () =>
      queueMicrotask(() =>
        handlers.forEach((h) => h({ kind: "train-complete" })),
      ),
    pause: () => {},
    evalFramePsnr: () => Promise.resolve(30),
    evalTestPsnr: () => Promise.resolve(null),
    exportPlyBlob: () =>
      Promise.resolve(
        new Blob([
          "ply\nformat binary_little_endian 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n",
        ]),
      ),
    dispose: () => {},
    trainer: { iter: 0, camMeta: [{}] },
  } as unknown as SplatSessionLike;
  return {
    mod: {
      createSession: () => session,
      parseCameras: (j) => j.cameras,
      TRAIN_MAX_DIM: 1600,
    },
    seeds,
  };
}

const clock = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

function deps(over: Partial<WorkerTrainDeps> = {}): WorkerTrainDeps & {
  decoded: number;
} {
  const d = {
    decoded: 0,
    load: () => Promise.resolve(finishing().mod),
    decode: () => {
      d.decoded++;
      return Promise.resolve(solid([255, 0, 0], 96, 96));
    },
    clock,
    ...over,
  };
  return d;
}

const live = (): AbortSignal => new AbortController().signal;

describe("colourSampler", () => {
  // Why: the photo may decode at another size than the camera's; a pixel
  // of the camera must read the matching pixel of the photo, and a pixel
  // off the photo reads nothing.
  it("scales camera pixels to the decoded photo", () => {
    const img = solid([0, 0, 0], 4, 2);
    img.data.set([255, 51, 0, 255], (1 * 4 + 3) * 4);
    const at = colourSampler(img, 8, 4);
    expect(at(7.5, 3.5)).toEqual([1, 0.2, 0]);
    expect(at(0, 0)).toEqual([0, 0, 0]);
    expect(at(8, 0)).toBeNull();
    expect(at(-1, 0)).toBeNull();
  });
});

describe("trainInWorker", () => {
  // Why: a refused library (a network error, a changed version) must end
  // the window as failed with its sentence, before any photo is decoded.
  it("ends as failed when the library is refused", async () => {
    const d = deps({
      load: () =>
        Promise.reject(
          new Error(
            "The splat trainer library is not the version this page expects (no parseCameras).",
          ),
        ),
    });
    const r = await trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [new Blob()] },
      () => {},
      live(),
      d,
    );
    expect(r).toMatchObject({ outcome: "failed", ply: null });
    expect(r.detail).toMatch(/not the version/);
    expect(d.decoded).toBe(0);
  });

  // Why: only photos that seed are decoded (decoding is the worker's
  // cost); depth readings in one 5 cm cube become one seed, and a shell
  // photo adds its grid of shell points.
  it("decodes only seeding photos and thins their seeds", async () => {
    const fin = finishing();
    const d = deps({ load: () => Promise.resolve(fin.mod) });
    const r = await trainInWorker(
      {
        type: "train",
        job: job([
          photo("a.jpg", { depth: [depth] }),
          photo("b.jpg"),
          photo("c.jpg", { shell: true }),
        ]),
        photos: [new Blob(), new Blob(), new Blob()],
      },
      () => {},
      live(),
      d,
    );
    expect(r.outcome).toBe("finished");
    expect(d.decoded).toBe(2);
    // 1 depth seed plus a 2 x 2 shell grid, each shell point in its own
    // 1 m cube at 40 m.
    expect(fin.seeds[0]).toHaveLength(1 + 4);
  });

  // Why: a photo the browser cannot decode must fail the window in words.
  it("ends as failed when a photo cannot be decoded", async () => {
    const d = deps({ decode: () => Promise.reject(new Error("bad JPEG")) });
    const r = await trainInWorker(
      {
        type: "train",
        job: job([photo("a.jpg", { shell: true })]),
        photos: [new Blob()],
      },
      () => {},
      live(),
      d,
    );
    expect(r).toMatchObject({
      outcome: "failed",
      detail: "A photo could not be read (bad JPEG).",
    });
  });

  // Why: the page's photo list and the job must match one to one, or a
  // camera trains on another camera's photo.
  it("refuses photos that do not match the job", async () => {
    const r = await trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [] },
      () => {},
      live(),
      deps(),
    );
    expect(r.outcome).toBe("failed");
  });

  // Why: a cancel while the seeds are built must stop before training.
  it("ends as cancelled when aborted while seeding", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await trainInWorker(
      {
        type: "train",
        job: job([photo("a.jpg", { shell: true })]),
        photos: [new Blob()],
      },
      () => {},
      ctrl.signal,
      deps(),
    );
    expect(r.outcome).toBe("cancelled");
  });
});
