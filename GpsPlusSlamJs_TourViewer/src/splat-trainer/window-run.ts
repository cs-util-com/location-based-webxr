/**
 * Trains one window with Splat.js: a session on known cameras and given
 * seeds, trained until it finishes, the deadline passes, the graphics
 * device is lost or the caller aborts; then scored at its training photos
 * and its held-out photos, exported, and cropped to what lies within the
 * window's reach of its training cameras. Says which stage it is in
 * (preparing, training, checking) and, given a preview, draws a look at
 * the model from one camera at the first report, every interval after it
 * and once more when it is scored. Runs wherever Splat.js runs (the
 * trainer's worker); Splat.js and the clock come in, so every ending is
 * testable with a scripted session.
 *
 * @see window-run.ts.md
 */

import type { Vector3 } from "gps-plus-slam-app-framework/core";

import { cropPly, readPly } from "./ply-crop.js";
import type {
  SeedPoint,
  SplatCameraEntry,
  SplatJsModule,
  SplatSessionLike,
  SplatTrainerLike,
} from "./splat-js.js";
import { shellCrop } from "./splat-ownership.js";
import type {
  TrainOutcome,
  TrainStage,
  WindowMetrics,
} from "./trainer-adapter.js";
import { liveEta } from "./training-budget.js";

/** One window's training input, photos decoded by Splat.js itself. */
export interface RunInput {
  readonly photos: readonly { readonly name: string; readonly blob: Blob }[];
  readonly cameras: readonly SplatCameraEntry[];
  readonly seeds: readonly SeedPoint[];
  /** The held-out photos' names, scored and never trained on. */
  readonly evalFrames: readonly string[];
  readonly maxIters: number;
  /** Training time allowed after the session is seeded (ms). */
  readonly deadlineMs: number;
  /** The shell crop keeps splats within this distance of a training
   *  camera (m). */
  readonly keepM: number;
  readonly trainPositions: readonly Vector3[];
  readonly etaMinIterations: number;
}

export interface RunProgress {
  /** What the run does now; the run itself never says `loading`, its
   *  caller does while the library arrives. */
  readonly stage: TrainStage;
  /** 0 to 1. */
  readonly fraction: number;
  /** Seconds left at the measured rate, or null while not yet measured. */
  readonly secondsLeft: number | null;
  /** Seconds to the next look while training with a preview, else null. */
  readonly nextPreviewInS: number | null;
}

/**
 * How the run shows the model while it trains. `take` draws it as seen
 * from training camera `ci` and returns the picture, or null when it
 * cannot; `post` hands a picture on. Both are called inside Splat.js's
 * own report, between training steps. A throw from either is ignored: a
 * look never stops a run.
 */
export interface RunPreview<P> {
  /** Time between looks (ms). */
  readonly everyMs: number;
  take(trainer: SplatTrainerLike, ci: number): P | null;
  post(picture: P): void;
}

export interface RunResult {
  readonly outcome: TrainOutcome;
  readonly metrics: WindowMetrics | null;
  /** Wall time from the call to its end, seconds. */
  readonly trainingS: number;
  /** The cropped splat file, or null without one. */
  readonly ply: Blob | null;
  /** Why a `failed` run failed, in words; absent otherwise. */
  readonly detail?: string;
}

export interface RunClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

type Ending = "finished" | "deadline" | "gpu-lost" | "cancelled";

/** Thrown inside the run when it must end before the stage finished. */
class Stop extends Error {
  constructor(readonly ending: Ending) {
    super(`stopped: ${ending}`);
  }
}

/** Splat.js reports the training horizon by itself; it is scored on its
 *  test set this often (steps), as the measured runs did. */
const evalEvery = (maxIters: number): number =>
  Math.max(1000, Math.round(maxIters / 4));

/**
 * Trains `input` with `mod`. Never rejects: a thrown error ends as
 * `failed` with its message in `detail`; an abort through `signal` ends
 * as `cancelled`; a lost device as `gpu-lost`, neither with a splat. A
 * run that reaches its deadline is paused and scored and exported like a
 * finished one. The session is disposed on every path.
 */
export async function runWindow<P = unknown>(
  mod: SplatJsModule,
  input: RunInput,
  onProgress: (p: RunProgress) => void,
  signal: AbortSignal,
  clock: RunClock,
  preview?: RunPreview<P>,
): Promise<RunResult> {
  const t0 = clock.now();
  const end = (
    outcome: TrainOutcome,
    rest: Partial<Omit<RunResult, "outcome" | "trainingS">> = {},
  ): RunResult => ({
    outcome,
    metrics: rest.metrics ?? null,
    trainingS: Math.max(0, (clock.now() - t0) / 1000),
    ply: rest.ply ?? null,
    ...(rest.detail === undefined ? {} : { detail: rest.detail }),
  });
  if (signal.aborted) return end("cancelled");

  let session: SplatSessionLike | null = null;
  let timer: unknown = null;
  // Resolves once with the first reason to stop early (abort, lost device).
  let stopNow: (e: Ending) => void = () => {};
  const stopped = new Promise<Ending>((resolve) => (stopNow = resolve));
  const onAbort = (): void => stopNow("cancelled");
  signal.addEventListener("abort", onAbort, { once: true });
  const guard = async <T>(p: Promise<T>): Promise<T> => {
    const r = await Promise.race([
      p.then((v) => ({ v })),
      stopped.then((e) => ({ e })),
    ]);
    if ("e" in r) throw new Stop(r.e);
    return r.v;
  };
  let fraction = 0;
  try {
    onProgress({
      stage: "preparing",
      fraction,
      secondsLeft: null,
      nextPreviewInS: null,
    });
    const s = mod.createSession({
      maxIters: input.maxIters,
      holdout: -1,
      evalHoldEvery: evalEvery(input.maxIters),
      trainer: { camOpt: false, expComp: false },
    });
    session = s;
    let complete: () => void = () => {};
    const completed = new Promise<"finished">(
      (resolve) => (complete = () => resolve("finished")),
    );
    s.on("event", (e) => {
      if (e.kind === "train-complete") complete();
      else if (e.kind === "device-lost") stopNow("gpu-lost");
    });
    // The rate is measured from the first report on, so shader
    // compilation and the first upload do not count against it.
    let mark: { iter: number; at: number } | null = null;
    // The first look comes with the first report.
    let nextLookAt: number | null = null;
    s.on("metrics", (m) => {
      if (!Number.isFinite(m.iter)) return;
      const at = clock.now();
      mark ??= { iter: m.iter, at };
      const ms = liveEta(
        {
          done: m.iter - mark.iter,
          total: input.maxIters - mark.iter,
          elapsedMs: at - mark.at,
        },
        input,
      );
      if (preview !== undefined && (nextLookAt === null || at >= nextLookAt)) {
        look(s, preview);
        nextLookAt = at + preview.everyMs;
      }
      fraction = Math.min(1, Math.max(0, m.iter / input.maxIters));
      onProgress({
        stage: "training",
        fraction,
        secondsLeft: ms === null ? null : ms / 1000,
        nextPreviewInS:
          nextLookAt === null ? null : Math.max(0, (nextLookAt - at) / 1000),
      });
    });

    await guard(
      s.load(input.photos.map((p) => ({ source: p.blob, name: p.name }))),
    );
    s.useKnownCameras(mod.parseCameras({ cameras: input.cameras }), {
      points: [...input.seeds],
    });
    await guard(s.seed({ evalFrames: [...input.evalFrames] }));

    const deadline = new Promise<"deadline">((resolve) => {
      timer = clock.setTimeout(() => resolve("deadline"), input.deadlineMs);
    });
    s.start();
    const ending = await guard(Promise.race([completed, deadline]));
    s.pause();
    clock.clearTimeout(timer);
    timer = null;
    onProgress({
      stage: "checking",
      fraction,
      secondsLeft: null,
      nextPreviewInS: null,
    });

    const metrics = await guard(scoreOf(s));
    if (preview !== undefined) look(s, preview);
    const raw = await guard(s.exportPlyBlob());
    const bytes = await guard(raw.arrayBuffer());
    const keep = shellCrop(
      readPly(bytes).positions,
      input.trainPositions,
      input.keepM,
    );
    const ply = new Blob([cropPly(bytes, keep)], {
      type: "application/octet-stream",
    });
    return end(ending, { metrics, ply });
  } catch (err) {
    if (err instanceof Stop) return end(err.ending);
    return end("failed", {
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (timer !== null) clock.clearTimeout(timer);
    if (session !== null) {
      try {
        session.pause();
        session.dispose();
      } catch {
        // A session on a lost device may throw on teardown; it is gone.
      }
    }
  }
}

/** The camera a look is drawn from: the middle test camera, else the
 *  middle camera the run trains on; null without either. */
function lookCamera(s: SplatSessionLike): number | null {
  const test = s.testCams ?? [];
  if (test.length > 0) return test[test.length >> 1] ?? null;
  const trainer = s.trainer;
  if (trainer === null) return null;
  const excluded = trainer.excluded ?? new Set<number>();
  const candidates: number[] = [];
  for (let ci = 0; ci < trainer.camMeta.length; ci++) {
    if (!excluded.has(ci)) candidates.push(ci);
  }
  return candidates[candidates.length >> 1] ?? null;
}

/** Draws and posts one look; a failure is ignored. */
function look<P>(s: SplatSessionLike, preview: RunPreview<P>): void {
  try {
    const trainer = s.trainer;
    const ci = lookCamera(s);
    if (trainer === null || ci === null) return;
    const picture = preview.take(trainer, ci);
    if (picture !== null) preview.post(picture);
  } catch {
    // A look that cannot be drawn or handed on is skipped.
  }
}

/** Sharpness at every training camera (mean) and at the test set. */
async function scoreOf(s: SplatSessionLike): Promise<WindowMetrics> {
  const trainer = s.trainer;
  if (trainer === null) throw new Error("The trainer has no model to score.");
  const excluded = trainer.excluded ?? new Set<number>();
  let sum = 0;
  let n = 0;
  for (let ci = 0; ci < trainer.camMeta.length; ci++) {
    if (excluded.has(ci)) continue;
    sum += await s.evalFramePsnr(ci);
    n++;
  }
  const held = await s.evalTestPsnr();
  return {
    atCameraDb: n > 0 ? sum / n : 0,
    heldOutDb: held === null ? null : held.psnr,
    photosUsed: n,
  };
}
