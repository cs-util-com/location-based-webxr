/**
 * The trainer worker's work for one window, apart from the worker's own
 * message plumbing: say it is loading, load Splat.js, decode the photos
 * that seed, build and thin the seeds, and run the window, with the
 * worker's look-taker when it has one. What touches the browser (the
 * import, the photo decoder, the clock) comes in, so the whole path is
 * testable without a worker or a graphics card.
 *
 * @see worker-train.ts.md
 */

import type { SplatJsModule } from "./splat-js.js";
import {
  depthSeeds,
  shellSeeds,
  voxelThin,
  type ColourAt,
  type WindowJob,
} from "./splat-inputs.js";
import {
  runWindow,
  type RunClock,
  type RunPreview,
  type RunProgress,
  type RunResult,
} from "./window-run.js";

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** A decoded photo: RGBA bytes, row by row. */
export interface DecodedPhoto {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** What the page sends the worker for one window. */
export interface TrainMessage {
  readonly type: "train";
  readonly job: WindowJob;
  /** One photo per `job.photos` entry, in the same order. */
  readonly photos: readonly Blob[];
}

/** The page stops a window by ending its worker, so "train" is all it sends. */
export type ToWorker = TrainMessage;

export type FromWorker =
  | { readonly type: "progress"; readonly progress: RunProgress }
  | { readonly type: "preview"; readonly picture: ImageBitmap }
  | { readonly type: "result"; readonly result: RunResult };

export interface WorkerTrainDeps<P = unknown> {
  readonly load: () => Promise<SplatJsModule>;
  readonly decode: (photo: Blob) => Promise<DecodedPhoto>;
  readonly clock: RunClock;
  /** Draws and hands on looks at the model while it trains; none without. */
  readonly preview?: RunPreview<P>;
}

/**
 * The colour of `photo` at pixel (u, v) of a `width` x `height` camera:
 * the photo may be decoded at another size, so (u, v) is scaled to it.
 * Null off the photo.
 */
export function colourSampler(
  photo: DecodedPhoto,
  width: number,
  height: number,
): ColourAt {
  const sx = photo.width / width;
  const sy = photo.height / height;
  return (u, v) => {
    const x = Math.floor(u * sx);
    const y = Math.floor(v * sy);
    if (!(x >= 0 && y >= 0 && x < photo.width && y < photo.height)) {
      return null;
    }
    const i = (y * photo.width + x) * 4;
    return [
      (photo.data[i] ?? 0) / 255,
      (photo.data[i + 1] ?? 0) / 255,
      (photo.data[i + 2] ?? 0) / 255,
    ];
  };
}

/**
 * Trains the window of `msg`. Never rejects: a library that will not load
 * or a photo that will not decode ends as `failed` with the reason in
 * `detail`; an abort before training ends as `cancelled`.
 */
export async function trainInWorker<P = unknown>(
  msg: TrainMessage,
  onProgress: (p: RunProgress) => void,
  signal: AbortSignal,
  deps: WorkerTrainDeps<P>,
): Promise<RunResult> {
  const t0 = deps.clock.now();
  const early = (
    outcome: "failed" | "cancelled",
    detail?: string,
    retryHelps?: false,
  ): RunResult => ({
    outcome,
    metrics: null,
    trainingS: Math.max(0, (deps.clock.now() - t0) / 1000),
    ply: null,
    ...(detail === undefined ? {} : { detail }),
    ...(retryHelps === false ? { retryHelps } : {}),
  });
  const { job, photos } = msg;
  if (photos.length !== job.photos.length) {
    return early("failed", "The photos do not match the window's list.");
  }
  onProgress({
    stage: "loading",
    fraction: 0,
    secondsLeft: null,
    previewEveryS: null,
  });
  let mod: SplatJsModule;
  try {
    mod = await deps.load();
  } catch (err) {
    // A library that will not download or is not the pinned one will not
    // on a second try either.
    return early("failed", errorText(err), false);
  }
  const depthPts = [];
  const shellPts = [];
  try {
    for (const [i, p] of job.photos.entries()) {
      if (signal.aborted) return early("cancelled");
      if (p.depth.length === 0 && !p.shell) continue;
      const blob = photos[i];
      if (blob === undefined) continue;
      const colour = colourSampler(
        await deps.decode(blob),
        p.camera.width,
        p.camera.height,
      );
      depthPts.push(
        ...depthSeeds(p.depth, p.camera.width, p.camera.height, colour),
      );
      if (p.shell) {
        shellPts.push(
          ...shellSeeds(
            p.pose,
            p.camera,
            p.camera.width,
            p.camera.height,
            { distanceM: job.shellDistanceM, gridPx: job.shellGridPx },
            colour,
          ),
        );
      }
    }
  } catch (err) {
    return early(
      "failed",
      `A photo could not be read (${errorText(err)}).`,
      false,
    );
  }
  const seeds = [
    ...voxelThin(depthPts, job.seedVoxelM),
    ...voxelThin(shellPts, job.shellVoxelM),
  ];
  return runWindow(
    mod,
    {
      photos: job.photos.map((p, i) => ({
        name: p.name,
        blob: photos[i] ?? new Blob(),
      })),
      cameras: job.photos.map((p) => p.camera),
      seeds,
      evalFrames: job.evalFrames,
      maxIters: job.maxIters,
      deadlineMs: job.deadlineMs,
      keepM: job.keepM,
      trainPositions: job.trainPositions,
      etaMinIterations: job.etaMinIterations,
      prepareCapMs: job.prepareCapMs,
    },
    onProgress,
    signal,
    deps.clock,
    deps.preview,
  );
}

/**
 * The worker's message handler: trains the window of the first "train"
 * message (one window per worker; the page spawns a fresh one for each)
 * and posts its progress and result through `post`. A training that
 * rejects (the library throwing past its own handling) still posts a
 * failed result with the reason, so the page never waits for ever.
 */
export function serveTrainer<P = unknown>(
  post: (message: FromWorker) => void,
  deps: WorkerTrainDeps<P>,
  train: typeof trainInWorker<P> = trainInWorker,
): (msg: ToWorker) => void {
  let started = false;
  return (msg) => {
    if (started) return;
    started = true;
    void train(
      msg,
      (progress) => post({ type: "progress", progress }),
      new AbortController().signal,
      deps,
    ).then(
      (result) => post({ type: "result", result }),
      (err: unknown) => {
        post({
          type: "result",
          result: {
            outcome: "failed",
            metrics: null,
            trainingS: 0,
            ply: null,
            detail: `The trainer stopped unexpectedly (${errorText(err)}).`,
          },
        });
      },
    );
  };
}
