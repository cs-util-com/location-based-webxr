import type { DepthSample } from "gps-plus-slam-app-framework/state";
import { describe, expect, it } from "vitest";

import {
  loadSplatJs,
  type SplatJsModule,
  type SplatSessionLike,
} from "./splat-js.js";
import type { WindowJob, WindowPhoto } from "./splat-inputs.js";
import type { RunResult } from "./window-run.js";
import {
  colourSampler,
  serveTrainer,
  trainInWorker,
  type FromWorker,
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
    prepareCapMs: 300_000,
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
  // Why: a library that is not the pinned one must end the window as
  // failed with its sentence, before any photo is decoded; the same
  // library would be refused on a second try, so none is offered.
  it("ends as failed when the library is refused", async () => {
    const d = deps({
      load: () => loadSplatJs(() => Promise.resolve({ createSession() {} })),
    });
    const r = await trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [new Blob()] },
      () => {},
      live(),
      d,
    );
    expect(r).toMatchObject({ outcome: "failed", ply: null });
    expect(r.detail).toMatch(/not the version/);
    expect(r.retryHelps).toBe(false);
    expect(d.decoded).toBe(0);
  });

  // Why: a download that failed (a moment without network) was marked as
  // one training again cannot fix, so the stretch lost its "Train again"
  // although the next worker would load the library fine.
  it("leaves a retry on offer when the library could not be downloaded", async () => {
    const d = deps({
      load: () =>
        loadSplatJs(() =>
          Promise.reject(
            new TypeError("Failed to fetch dynamically imported module"),
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
    expect(r.detail).toMatch(/could not be loaded .*Failed to fetch/);
    expect(r.retryHelps).toBeUndefined();
    expect(d.decoded).toBe(0);
  });

  // Why: nothing bounded the library's download: a request the network
  // never answered left the print on "Loading the trainer" for ever. The
  // download has the preparation's cap and ends in words, with a retry
  // still on offer.
  it("ends as failed in words when the library does not arrive in time", async () => {
    let fire = (): void => {};
    let wanted = 0;
    let cleared: unknown = null;
    const d = deps({
      load: () => new Promise<never>(() => {}),
      clock: {
        now: () => 0,
        setTimeout: (fn, ms) => {
          fire = fn;
          wanted = ms;
          return 7;
        },
        clearTimeout: (id) => (cleared = id),
      },
    });
    const run = trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [new Blob()] },
      () => {},
      live(),
      d,
    );
    await Promise.resolve();
    expect(wanted).toBe(300_000);
    fire();
    const r = await run;
    expect(r).toMatchObject({ outcome: "failed", ply: null });
    expect(r.detail).toMatch(/did not arrive within 5 min/);
    expect(r.retryHelps).toBeUndefined();
    expect(cleared).toBe(7);
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
      retryHelps: false,
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

  // Why: loading the library is the first wait of a stretch; the page
  // says so before the library has arrived, and says nothing more when
  // it never does.
  it("says it is loading the trainer before the library is there", async () => {
    const stages: string[] = [];
    let release!: () => void;
    const loaded = new Promise<void>((r) => (release = r));
    const fin = finishing();
    const run = trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [new Blob()] },
      (p) => stages.push(p.stage),
      live(),
      deps({ load: () => loaded.then(() => fin.mod) }),
    );
    await Promise.resolve();
    expect(stages).toEqual(["loading"]);
    release();
    const r = await run;
    expect(r.outcome).toBe("finished");
    expect(stages.slice(0, 2)).toEqual(["loading", "preparing"]);
  });

  // Why: the worker hands its look-taker to the run; without it the run
  // still trains (the unit-tested path), with it the looks reach the page.
  it("passes its preview to the run", async () => {
    const posted: unknown[] = [];
    const r = await trainInWorker(
      { type: "train", job: job([photo("a.jpg")]), photos: [new Blob()] },
      () => {},
      live(),
      deps({
        preview: {
          everyMs: 15_000,
          take: () => "a look",
          post: (p) => posted.push(p),
        },
      }),
    );
    expect(r.outcome).toBe("finished");
    // The last look, taken once the stretch is scored.
    expect(posted).toEqual(["a look"]);
  });
});

describe("serveTrainer", () => {
  const msg = {
    type: "train" as const,
    job: job([photo("a.jpg")]),
    photos: [new Blob()],
  };

  // Why: the worker posted its result only when the training promise
  // resolved; a rejection posted nothing, so the stretch hung with no
  // progress and no failure. A rejection now ends as a failed result
  // that says why.
  it("posts a failed result with the reason when training rejects", async () => {
    const posted: FromWorker[] = [];
    const serve = serveTrainer(
      (m) => posted.push(m),
      deps(),
      () => Promise.reject(new Error("out of memory")),
    );
    serve(msg);
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toEqual([
      {
        type: "result",
        result: expect.objectContaining({
          outcome: "failed",
          ply: null,
          detail: "The trainer stopped unexpectedly (out of memory).",
        }) as RunResult,
      },
    ]);
  });

  // Why: one window per worker; a second message must not start a
  // second training on the same graphics device.
  it("trains one window and passes its progress and result on", async () => {
    const posted: FromWorker[] = [];
    let runs = 0;
    const serve = serveTrainer(
      (m) => posted.push(m),
      deps(),
      (_m, onProgress) => {
        runs++;
        onProgress({
          stage: "training",
          fraction: 0.5,
          secondsLeft: null,
          previewEveryS: null,
        });
        return Promise.resolve({
          outcome: "finished",
          metrics: null,
          trainingS: 1,
          ply: null,
        });
      },
    );
    serve(msg);
    serve(msg);
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(1);
    expect(posted.map((m) => m.type)).toEqual(["progress", "result"]);
  });
});
