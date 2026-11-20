/**
 * The practice trainer: a scripted stand-in behind the {@link TrainerAdapter}
 * interface, until the GPU trainer lands. It trains nothing. Each stretch
 * "trains" for a scripted time on the given timer, reports progress and
 * sharpening practice pictures, and ends with a scripted outcome: by
 * default stretch 3 comes out weak, stretch 5 not good enough and stretch 8
 * runs out of time, each better on a second try. The page uses it only
 * when asked for one (`trainer-choice.ts`) and says so on screen.
 *
 * @see fake-trainer.ts.md
 */

import { clampSharpness, drawPracticePrint } from "./practice-prints.js";
import type {
  GpuProbe,
  TrainerAdapter,
  TrainOutcome,
  TrainRequest,
  Verdict,
  WindowJudgement,
  WindowTrainResult,
} from "./trainer-adapter.js";

/** The timer the practice run counts on (the page passes the window's). */
interface PracticeTimer {
  now(): number;
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

/** How one practice attempt ends. Numbers are invented. */
interface PracticeEnding {
  readonly outcome: Exclude<TrainOutcome, "cancelled" | "failed">;
  readonly verdict: Verdict;
  /** How sharp the last picture gets, 0 to 1. */
  readonly sharpness: number;
  readonly ghost: boolean;
  readonly say: string;
  readonly reasons: readonly string[];
  readonly atCameraDb: number;
  readonly heldOutDb: number;
}

export type PracticeScript = (index: number, attempt: number) => PracticeEnding;

export interface PracticeOptions {
  readonly timer: PracticeTimer;
  /** Speed-up: 2 runs twice as fast. Anything not a positive number is 1. */
  readonly pace?: number;
  /** What the probe reports. */
  readonly gpu?: GpuProbe["kind"];
  readonly script?: PracticeScript;
  /** Draws a picture; null draws nothing (tests). */
  readonly picture?: (
    index: number,
    sharpness: number,
    ghost: boolean,
  ) => CanvasImageSource | null;
}

/** One first try at pace 1, ms; a retry gets its time scale times this. */
export const PRACTICE_STRETCH_MS = 20_000;
/** A new picture this often, ms at pace 1. */
const PRACTICE_PREVIEW_MS = 4_000;
/** No time estimate before this much of a stretch, ms at pace 1. */
const PRACTICE_MEASURE_MS = 3_000;
const TICK_MS = 250;

const GOOD: PracticeEnding = {
  outcome: "finished",
  verdict: "good",
  sharpness: 0.97,
  ghost: false,
  say: "Sharp from every photo.",
  reasons: [],
  atCameraDb: 29.6,
  heldOutDb: 23.4,
};

const BETTER: PracticeEnding = {
  ...GOOD,
  sharpness: 0.95,
  say: "Sharp now, after a second try.",
  atCameraDb: 28.3,
  heldOutDb: 22.6,
};

/** The default script: three stretches go wrong, each better again. */
export const DEFAULT_PRACTICE_SCRIPT: PracticeScript = (index, attempt) => {
  const slot = index % 8;
  if (slot === 2 && attempt === 1) {
    return {
      outcome: "finished",
      verdict: "weak",
      sharpness: 0.7,
      ghost: false,
      say: "A little soft between the photos.",
      reasons: ["photos far apart"],
      atCameraDb: 26.1,
      heldOutDb: 19.8,
    };
  }
  if (slot === 4 && attempt === 1) {
    return {
      outcome: "finished",
      verdict: "poor",
      sharpness: 0.3,
      ghost: true,
      say: "Stayed blurry. In the editor it would look smeared.",
      reasons: ["photos far apart", "many blurry photos"],
      atCameraDb: 22.4,
      heldOutDb: 17.1,
    };
  }
  if (slot === 4 && attempt === 2) {
    return {
      outcome: "finished",
      verdict: "weak",
      sharpness: 0.66,
      ghost: false,
      say: "Better after a second try, still a little soft.",
      reasons: ["photos far apart"],
      atCameraDb: 25.2,
      heldOutDb: 19.4,
    };
  }
  if (slot === 7 && attempt === 1) {
    return {
      outcome: "deadline",
      verdict: "weak",
      sharpness: 0.74,
      ghost: false,
      say: "Stopped before it was fully sharp.",
      reasons: ["ran out of time"],
      atCameraDb: 25.8,
      heldOutDb: 20.3,
    };
  }
  return attempt > 1 ? BETTER : GOOD;
};

/** A pace from a query value: a positive finite number, else 1. */
export function parsePace(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n > 0
    ? Math.min(1000, Math.max(0.05, n))
    : 1;
}

/** How sharp the picture is at a progress, ending at the attempt's end. */
export function sharpnessAt(end: number, progress: number): number {
  const p = clampSharpness(progress);
  return (clampSharpness(end) * (1 - Math.exp(-3 * p))) / (1 - Math.exp(-3));
}

/** Pictures on a fresh canvas each, for the page (a browser only). */
export function practicePictures(
  doc: Document,
  paper: () => string,
): NonNullable<PracticeOptions["picture"]> {
  return (index, sharpness, ghost) => {
    const canvas = doc.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    drawPracticePrint(canvas, index + 1, sharpness, ghost, paper());
    return canvas;
  };
}

export function createPracticeTrainer(
  options: PracticeOptions,
): TrainerAdapter {
  const { timer } = options;
  const pace = parsePace(String(options.pace ?? 1));
  const script = options.script ?? DEFAULT_PRACTICE_SCRIPT;
  const picture = options.picture ?? (() => null);
  const gpu = options.gpu ?? "ready";

  const endingOf = (r: TrainRequest): PracticeEnding =>
    script(r.window.index, r.attempt);

  function trainWindow(
    request: TrainRequest,
    events: Parameters<TrainerAdapter["trainWindow"]>[1],
    signal: AbortSignal,
  ): Promise<WindowTrainResult> {
    const ending = endingOf(request);
    const scale =
      Number.isFinite(request.timeScale) && request.timeScale > 0
        ? request.timeScale
        : 1;
    const totalMs = (PRACTICE_STRETCH_MS * scale) / pace;
    const previewMs = PRACTICE_PREVIEW_MS / pace;
    const measureMs = PRACTICE_MEASURE_MS / pace;
    const tickMs = Math.min(TICK_MS, totalMs / 20);
    const t0 = timer.now();
    let nextPreview = previewMs;
    let pending: number | null = null;

    return new Promise<WindowTrainResult>((resolve) => {
      const end = (result: WindowTrainResult): void => {
        if (pending !== null) timer.clear(pending);
        pending = null;
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void =>
        end({
          outcome: "cancelled",
          metrics: null,
          trainingS: (timer.now() - t0) / 1000,
          ply: null,
        });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);

      const tick = (): void => {
        pending = null;
        const elapsed = timer.now() - t0;
        const fraction = Math.min(1, elapsed / totalMs);
        while (elapsed >= nextPreview && nextPreview < totalMs) {
          const shown = picture(
            request.window.index,
            sharpnessAt(ending.sharpness, nextPreview / totalMs),
            false,
          );
          if (shown !== null) events.onPreview(shown);
          nextPreview += previewMs;
        }
        events.onProgress({
          fraction,
          secondsLeft:
            elapsed >= measureMs
              ? Math.max(0, (totalMs - elapsed) / 1000)
              : null,
          nextPreviewInS:
            nextPreview < totalMs
              ? Math.max(0, (nextPreview - elapsed) / 1000)
              : null,
        });
        if (fraction >= 1) {
          const last = picture(
            request.window.index,
            ending.sharpness,
            ending.ghost,
          );
          if (last !== null) events.onPreview(last);
          end({
            outcome: ending.outcome,
            metrics: {
              atCameraDb: ending.atCameraDb,
              heldOutDb: ending.heldOutDb,
              photosUsed: request.window.frames,
            },
            trainingS: elapsed / 1000,
            ply: null,
          });
          return;
        }
        pending = timer.set(tick, tickMs);
      };
      pending = timer.set(tick, tickMs);
    });
  }

  function judge(
    request: TrainRequest,
    result: WindowTrainResult,
  ): WindowJudgement {
    if (result.outcome === "gpu-lost") {
      return {
        verdict: "poor",
        reasons: ["the graphics card stopped"],
        say: "The graphics card stopped during training.",
      };
    }
    if (result.outcome === "failed") {
      return {
        verdict: "poor",
        reasons: ["the trainer stopped"],
        say: "Training stopped with an error.",
      };
    }
    const e = endingOf(request);
    return { verdict: e.verdict, reasons: e.reasons, say: e.say };
  }

  return {
    kind: "practice",
    probe: () =>
      Promise.resolve(
        gpu === "no-webgpu"
          ? { kind: "no-webgpu", detail: "practice run without WebGPU" }
          : { kind: gpu },
      ),
    trainWindow,
    judge,
  };
}
