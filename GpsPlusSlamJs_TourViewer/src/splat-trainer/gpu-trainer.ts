/**
 * The GPU trainer as the page sees it: a {@link TrainerAdapter} that plans
 * a window's job (`splat-inputs.ts`), refuses in words a window whose
 * photos the graphics card cannot hold, reads the window's photos from the
 * recording, and trains it in a worker running Splat.js
 * (`splat-trainer.worker.ts`), so the page stays responsive. It says it is
 * loading from the first moment, passes on the worker's stage, progress,
 * looks at the model and, for a failed run, its reason, and closes a look
 * that arrives after the page stopped the stretch. A stop ends the worker
 * at once. Its judge reads the held-out sharpness against provisional
 * thresholds.
 *
 * @see gpu-trainer.ts.md
 */

import { closePicture } from "./kept-look.js";
import { SPLAT_JS_MIN_TRAIN_DIM } from "./splat-js.js";
import { planWindowJob } from "./splat-inputs.js";
import {
  failedJudgement,
  probeWebGpu,
  type GpuLike,
  type GpuProbe,
  type TrainerAdapter,
  type TrainRequest,
  type WindowJudgement,
  type WindowTrainResult,
} from "./trainer-adapter.js";
import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
import {
  memoryBudgetBytes,
  photoScale,
  type AdapterLimits,
  type PhotoScale,
} from "./training-budget.js";
import type { FromWorker, ToWorker } from "./worker-train.js";

/** The parts of a Worker the trainer uses. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: { readonly data: FromWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface GpuTrainerDeps {
  readonly gpu: GpuLike | null | undefined;
  /** The photos of `entries`, in order, from the recording zip. */
  readonly readPhotos: (
    recording: Blob,
    entries: readonly string[],
  ) => Promise<readonly Blob[]>;
  /** A fresh trainer worker; one per window. */
  readonly spawn: () => WorkerLike;
  readonly timer: { now(): number };
  readonly settings?: TrainerSettings;
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const megabytes = (bytes: number): string => String(Math.ceil(bytes / 1e6));

/**
 * The photo memory budget of a card with `limits` for a window of
 * `photos` photos of `width` x `height`, and why the window cannot train
 * on it, in words (null when it fits). The smallest size counted is the
 * larger of `minShortSidePx` and the one Splat.js stops shrinking at
 * (for camera photos the library's, see `minShortSidePx`). Null when
 * the limits are not ones the budget can read; sizes it cannot judge keep
 * the budget and refuse nothing (the trainer then meets them itself).
 */
function cardFit(
  photos: number,
  width: number,
  height: number,
  limits: AdapterLimits,
  settings: TrainerSettings,
): { readonly budgetBytes: number; readonly tooLarge: string | null } | null {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const libraryFloor =
    long > SPLAT_JS_MIN_TRAIN_DIM
      ? Math.round((short * SPLAT_JS_MIN_TRAIN_DIM) / long)
      : short;
  let budgetBytes: number;
  try {
    budgetBytes = memoryBudgetBytes(limits, settings);
  } catch {
    return null;
  }
  // A size the budget cannot judge still leaves the budget to pass on.
  let fit: PhotoScale;
  try {
    fit = photoScale(photos, width, height, budgetBytes, {
      ...settings,
      minShortSidePx: Math.max(settings.minShortSidePx, libraryFloor),
    });
  } catch {
    return { budgetBytes, tooLarge: null };
  }
  return {
    budgetBytes,
    tooLarge:
      fit.kind === "fits"
        ? null
        : `The stretch's ${String(photos)} photos need ${megabytes(fit.neededBytes)} MB of graphics memory even at their smallest, and this graphics card allows ${megabytes(fit.budgetBytes)} MB, so it cannot be trained on this computer.`,
  };
}

export function createGpuTrainer(deps: GpuTrainerDeps): TrainerAdapter {
  const settings = deps.settings ?? TRAINER_DEFAULTS;
  /** The newest probe; the window check reads the card's limits from it. */
  let probed: GpuProbe | null = null;

  async function probe(): Promise<GpuProbe> {
    const found = await probeWebGpu(deps.gpu);
    probed = found;
    return found;
  }

  async function trainWindow(
    request: TrainRequest,
    events: Parameters<TrainerAdapter["trainWindow"]>[1],
    signal: AbortSignal,
  ): Promise<WindowTrainResult> {
    const t0 = deps.timer.now();
    const ended = (
      outcome: WindowTrainResult["outcome"],
      why: Pick<WindowTrainResult, "detail" | "retryHelps"> = {},
    ): WindowTrainResult => ({
      outcome,
      metrics: null,
      trainingS: Math.max(0, (deps.timer.now() - t0) / 1000),
      ply: null,
      ...why,
    });
    if (signal.aborted) return ended("cancelled");
    events.onProgress({
      stage: "loading",
      fraction: 0,
      secondsLeft: null,
      previewEveryS: null,
    });
    const planned = planWindowJob(
      request.inputs,
      request.window,
      request.timeScale,
      settings,
    );
    const found = probed ?? (await probe());
    if (signal.aborted) return ended("cancelled");
    const { frameWidth, frameHeight } = request.inputs.census;
    const fit =
      found.kind !== "no-webgpu" && found.limits !== undefined
        ? cardFit(
            planned.photos.length,
            frameWidth,
            frameHeight,
            found.limits,
            settings,
          )
        : null;
    if (fit !== null && fit.tooLarge !== null) {
      return ended("failed", { detail: fit.tooLarge, retryHelps: false });
    }
    // Splat.js shrinks its photos to its own fixed budget unless told
    // the card's, which on a card with small limits is several times less.
    const job =
      fit === null
        ? planned
        : { ...planned, photoBudgetBytes: fit.budgetBytes };
    let photos: readonly Blob[];
    try {
      photos = await deps.readPhotos(
        request.recording,
        job.photos.map((p) => p.entry),
      );
    } catch (err) {
      return signal.aborted
        ? ended("cancelled")
        : ended("failed", {
            detail: `The stretch's photos could not be read from the recording (${errorText(err)}).`,
            retryHelps: false,
          });
    }
    if (signal.aborted) return ended("cancelled");

    const worker = deps.spawn();
    let onAbort = (): void => {};
    try {
      const result = await new Promise<WindowTrainResult>((resolve) => {
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") {
            if (signal.aborted) return;
            events.onProgress({
              stage: data.progress.stage,
              fraction: data.progress.fraction,
              secondsLeft: data.progress.secondsLeft,
              previewEveryS: data.progress.previewEveryS,
            });
          } else if (data.type === "preview") {
            if (signal.aborted) closePicture(data.picture);
            else events.onPreview(data.picture);
          } else {
            const r = data.result;
            resolve({
              outcome: r.outcome,
              metrics: r.metrics,
              trainingS: r.trainingS,
              ply: r.ply,
              ...(r.detail === undefined ? {} : { detail: r.detail }),
              ...(r.retryHelps === false ? { retryHelps: false as const } : {}),
            });
          }
        };
        worker.onerror = (event) => {
          const message = (event as { message?: unknown } | null)?.message;
          resolve(
            ended("failed", {
              detail:
                typeof message === "string" && message !== ""
                  ? `The trainer stopped unexpectedly (${message}).`
                  : "The trainer stopped unexpectedly.",
            }),
          );
        };
        // The page needs no answer from a stopped worker: ending it at
        // once frees the graphics card before a continued stretch starts
        // a worker of its own.
        onAbort = () => {
          worker.terminate();
          resolve(ended("cancelled"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ type: "train", job, photos: [...photos] });
      });
      // The page's own stop always reads as cancelled, whatever the worker
      // managed to finish before it heard of it.
      return signal.aborted
        ? { ...result, outcome: "cancelled", ply: null }
        : result;
    } finally {
      signal.removeEventListener("abort", onAbort);
      // A look already on its way when the worker ended still arrives:
      // it is closed, not left holding its pixels until collected.
      worker.onmessage = ({ data }) => {
        if (data.type === "preview") closePicture(data.picture);
      };
      worker.onerror = null;
      worker.terminate();
    }
  }

  return {
    kind: "gpu",
    probe,
    trainWindow,
    judge: (_request, result) => judgeGpuRun(result, settings),
  };
}

/**
 * The provisional judge: a lost device or a failed run is poor (a failed
 * one says why, when it knows); otherwise the held-out sharpness decides
 * against `goodHeldOutDb` and `weakHeldOutDb`, and a run that ran out of
 * time is at best weak.
 */
export function judgeGpuRun(
  result: WindowTrainResult,
  settings: Pick<TrainerSettings, "goodHeldOutDb" | "weakHeldOutDb">,
): WindowJudgement {
  if (result.outcome === "gpu-lost") {
    return {
      verdict: "poor",
      reasons: ["the graphics card stopped"],
      say: "The graphics card stopped during training.",
    };
  }
  const m = result.metrics;
  if (result.outcome === "failed" || m === null) {
    return failedJudgement(result);
  }
  const late = result.outcome === "deadline";
  const lateReason = late ? ["ran out of time"] : [];
  if (m.heldOutDb === null) {
    return {
      verdict: "weak",
      reasons: ["no photos to check it on", ...lateReason],
      say: `It matches its own photos at ${m.atCameraDb.toFixed(1)} dB; no photo was left out to check it on.`,
    };
  }
  const db = m.heldOutDb;
  const say = `It shows photos it did not train on at ${db.toFixed(1)} dB${late ? ", after running out of time" : ""}.`;
  if (db >= settings.goodHeldOutDb && !late) {
    return { verdict: "good", reasons: [], say };
  }
  if (db >= settings.weakHeldOutDb) {
    return {
      verdict: "weak",
      reasons: [
        ...(db >= settings.goodHeldOutDb ? [] : ["a little blurry"]),
        ...lateReason,
      ],
      say,
    };
  }
  return { verdict: "poor", reasons: ["blurry", ...lateReason], say };
}
