/**
 * The GPU trainer as the page sees it: a {@link TrainerAdapter} that plans
 * a window's job (`splat-inputs.ts`), reads the window's photos from the
 * recording, and trains it in a worker running Splat.js
 * (`splat-trainer.worker.ts`), so the page stays responsive. A cancel asks
 * the worker to stop and ends the worker if it does not answer in time.
 * Its judge reads the held-out sharpness against provisional thresholds.
 *
 * @see gpu-trainer.ts.md
 */

import { planWindowJob } from "./splat-inputs.js";
import {
  probeWebGpu,
  type GpuLike,
  type TrainerAdapter,
  type TrainRequest,
  type WindowJudgement,
  type WindowTrainResult,
} from "./trainer-adapter.js";
import { TRAINER_DEFAULTS, type TrainerSettings } from "./trainer-defaults.js";
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
  readonly timer: {
    now(): number;
    set(fn: () => void, ms: number): unknown;
    clear(id: unknown): void;
  };
  readonly settings?: TrainerSettings;
  /** How long a cancelled worker may take to answer before it is ended. */
  readonly cancelGraceMs?: number;
}

const DEFAULT_CANCEL_GRACE_MS = 5000;

export function createGpuTrainer(deps: GpuTrainerDeps): TrainerAdapter {
  const settings = deps.settings ?? TRAINER_DEFAULTS;
  const grace = deps.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;

  async function trainWindow(
    request: TrainRequest,
    events: Parameters<TrainerAdapter["trainWindow"]>[1],
    signal: AbortSignal,
  ): Promise<WindowTrainResult> {
    const t0 = deps.timer.now();
    const ended = (
      outcome: WindowTrainResult["outcome"],
    ): WindowTrainResult => ({
      outcome,
      metrics: null,
      trainingS: Math.max(0, (deps.timer.now() - t0) / 1000),
      ply: null,
    });
    if (signal.aborted) return ended("cancelled");
    let photos: readonly Blob[];
    const job = planWindowJob(
      request.inputs,
      request.window,
      request.timeScale,
      settings,
    );
    try {
      photos = await deps.readPhotos(
        request.recording,
        job.photos.map((p) => p.entry),
      );
    } catch {
      return ended(signal.aborted ? "cancelled" : "failed");
    }
    if (signal.aborted) return ended("cancelled");

    const worker = deps.spawn();
    let graceTimer: unknown = null;
    try {
      const result = await new Promise<WindowTrainResult>((resolve) => {
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") {
            if (signal.aborted) return;
            events.onProgress({
              fraction: data.progress.fraction,
              secondsLeft: data.progress.secondsLeft,
              nextPreviewInS: null,
            });
          } else {
            resolve({
              outcome: data.result.outcome,
              metrics: data.result.metrics,
              trainingS: data.result.trainingS,
              ply: data.result.ply,
            });
          }
        };
        worker.onerror = () => resolve(ended("failed"));
        signal.addEventListener(
          "abort",
          () => {
            worker.postMessage({ type: "cancel" });
            graceTimer = deps.timer.set(
              () => resolve(ended("cancelled")),
              grace,
            );
          },
          { once: true },
        );
        worker.postMessage({ type: "train", job, photos: [...photos] });
      });
      // The page's own stop always reads as cancelled, whatever the worker
      // managed to finish before it heard of it.
      return signal.aborted
        ? { ...result, outcome: "cancelled", ply: null }
        : result;
    } finally {
      if (graceTimer !== null) deps.timer.clear(graceTimer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  return {
    kind: "gpu",
    probe: () => probeWebGpu(deps.gpu),
    trainWindow,
    judge: (_request, result) => judgeGpuRun(result, settings),
  };
}

/**
 * The provisional judge: a lost device or a failed run is poor; otherwise
 * the held-out sharpness decides against `goodHeldOutDb` and
 * `weakHeldOutDb`, and a run that ran out of time is at best weak.
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
    return {
      verdict: "poor",
      reasons: ["the trainer stopped"],
      say: "Training stopped with an error.",
    };
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
