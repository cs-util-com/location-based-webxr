/**
 * The seam between the splat trainer page and whatever trains a stretch:
 * the page asks a {@link TrainerAdapter} to probe the graphics card, to
 * train one stretch (reporting progress and preview pictures while it
 * runs, stoppable through an AbortSignal) and to judge the result. The
 * GPU trainer (`gpu-trainer.ts`) implements it on request; otherwise the
 * page runs either the {@link createUnavailableTrainer} (production: it
 * probes the real card but cannot train) or the scripted practice trainer
 * (`fake-trainer.ts`, only on request).
 *
 * @see trainer-adapter.ts.md
 */

import type { SplatInputs } from "./recording-reader.js";
import type { PlannedWindow } from "./window-plan.js";

/** What the probe found. `integrated` trains, but slowly. */
export type GpuProbe =
  | { readonly kind: "ready" }
  | { readonly kind: "integrated" }
  | { readonly kind: "no-webgpu"; readonly detail: string };

export interface TrainRequest {
  readonly window: PlannedWindow;
  /** 1 for the first try, 2 and up for "train again". */
  readonly attempt: number;
  /** How much more time than a first try this attempt gets (2 = twice). */
  readonly timeScale: number;
  readonly inputs: SplatInputs;
  /** The recording file the inputs were read from (its photos). */
  readonly recording: Blob;
}

export interface TrainProgress {
  /** 0 to 1. */
  readonly fraction: number;
  /** Seconds this stretch still needs, or null while not yet measured. */
  readonly secondsLeft: number | null;
  /** Seconds until the next preview picture, or null when unknown. */
  readonly nextPreviewInS: number | null;
}

interface TrainEvents {
  onProgress(progress: TrainProgress): void;
  /** A newer look of the stretch, drawn to be shown as it is. */
  onPreview(picture: CanvasImageSource): void;
}

/**
 * How a training run ended. `failed` is a trainer that threw; `cancelled`
 * is the page's own stop and is never judged.
 */
export type TrainOutcome =
  "finished" | "deadline" | "gpu-lost" | "failed" | "cancelled";

/** The measurements a judge reads; null when the run produced none. */
export interface WindowMetrics {
  /** Sharpness at the training photos, dB. */
  readonly atCameraDb: number;
  /** Sharpness at the photos held out of training, dB, or null. */
  readonly heldOutDb: number | null;
  readonly photosUsed: number;
}

export interface WindowTrainResult {
  readonly outcome: TrainOutcome;
  readonly metrics: WindowMetrics | null;
  /** Wall time the run took, seconds. */
  readonly trainingS: number;
  /** The trained splat, or null when there is none (practice, failure). */
  readonly ply: Blob | null;
}

export type Verdict = "good" | "weak" | "poor";

export interface WindowJudgement {
  readonly verdict: Verdict;
  /** Short reasons, shown as tags on the print. Empty for a good one. */
  readonly reasons: readonly string[];
  /** One sentence for the print's caption. */
  readonly say: string;
}

export interface TrainerAdapter {
  /** `practice` is the scripted stand-in; the page says so visibly.
   *  `gpu` trains for real (`gpu-trainer.ts`). */
  readonly kind: "practice" | "unavailable" | "gpu";
  probe(): Promise<GpuProbe>;
  /** Resolves with outcome `cancelled` (never rejects) when aborted. */
  trainWindow(
    request: TrainRequest,
    events: TrainEvents,
    signal: AbortSignal,
  ): Promise<WindowTrainResult>;
  judge(request: TrainRequest, result: WindowTrainResult): WindowJudgement;
}

/** The parts of `navigator.gpu` and its adapter the probe reads. */
export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: "high-performance" | "low-power";
  }): Promise<GpuAdapterLike | null>;
}

export interface GpuAdapterLike {
  readonly isFallbackAdapter?: boolean;
  readonly info?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly description?: string;
    readonly isFallbackAdapter?: boolean;
  };
}

const BUILT_IN = /\b(integrated|uhd|iris)\b/i;
/** Intel's graphics-card families (Arc: Xe-HPG, Xe2-HPG); every other
 *  Intel architecture is built into the processor. */
const INTEL_CARD = /\bxe\d*-hpg\b/i;

/**
 * Asks the browser for its fastest graphics adapter. No WebGPU, a refused
 * request, no adapter or a software fallback adapter all mean the page
 * cannot train; an Intel adapter that is not one of Intel's graphics
 * cards, or one that describes itself as built-in graphics, trains slowly
 * (`adapter.info` may say too little to be sure, so the page words this
 * as likely, not certain). Never throws.
 */
export async function probeWebGpu(
  gpu: GpuLike | undefined | null,
): Promise<GpuProbe> {
  if (
    gpu === undefined ||
    gpu === null ||
    typeof gpu.requestAdapter !== "function"
  ) {
    return { kind: "no-webgpu", detail: "this browser has no WebGPU" };
  }
  let adapter: GpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    return {
      kind: "no-webgpu",
      detail: "the browser refused a graphics adapter",
    };
  }
  if (adapter === null || typeof adapter !== "object") {
    return { kind: "no-webgpu", detail: "no graphics adapter is available" };
  }
  if (
    adapter.isFallbackAdapter === true ||
    adapter.info?.isFallbackAdapter === true
  ) {
    return {
      kind: "no-webgpu",
      detail: "only a software adapter is available",
    };
  }
  const info = adapter.info ?? {};
  const vendor = String(info.vendor ?? "").toLowerCase();
  const text = `${info.architecture ?? ""} ${info.description ?? ""}`;
  const intelBuiltIn =
    vendor === "intel" && !INTEL_CARD.test(String(info.architecture ?? ""));
  return intelBuiltIn || BUILT_IN.test(text)
    ? { kind: "integrated" }
    : { kind: "ready" };
}

/**
 * Production's trainer until the GPU trainer lands: it probes the real
 * card, so the page can say what this computer has, but it trains nothing.
 * The page never offers a start with it; a call anyway rejects.
 */
export function createUnavailableTrainer(
  gpu: GpuLike | undefined | null,
): TrainerAdapter {
  return {
    kind: "unavailable",
    probe: () => probeWebGpu(gpu),
    trainWindow: () =>
      Promise.reject(new Error("The splat trainer is not available yet.")),
    judge: () => {
      throw new Error("The splat trainer is not available yet.");
    },
  };
}
