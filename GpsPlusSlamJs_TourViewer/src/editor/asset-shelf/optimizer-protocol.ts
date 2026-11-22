/**
 * The messages between the page and the asset optimizer's module Worker
 * (`asset-optimizer.worker.ts`), in a module of their own (no DOM, no
 * `new Worker`) so the worker, its client (`optimizer-client.ts`) and the
 * tests share one shape - and the Worker's check of what it receives
 * (`inboundOf`).
 *
 * @see optimizer-protocol.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { ModelReport } from "./model-step.js";
import type { OptimizerSettings } from "./optimizer-settings.js";

/** page to worker: optimize `payload` (a file's bytes, or what the page
 *  decoded from them) as `kind`. */
interface RunMessage {
  readonly type: "run";
  /** Correlation id, echoed by every answer. */
  readonly job: number;
  readonly kind: TourAssetKind;
  readonly payload: unknown;
  readonly settings: OptimizerSettings;
}

/** page to worker: stop job `job` (its asset left, the tour closed). */
interface CancelMessage {
  readonly type: "cancel";
  readonly job: number;
}

export type OptimizerInbound = RunMessage | CancelMessage;

/** Every asset kind, so a run of another kind is refused. */
const KINDS: Readonly<Record<TourAssetKind, true>> = {
  image: true,
  audio: true,
  video: true,
  model: true,
};

/** `data` as a message the Worker takes, or null for anything else (a
 *  non-object, an unknown type, a job that is no whole number, a run of no
 *  known kind or without settings): the Worker ignores those. */
export function inboundOf(data: unknown): OptimizerInbound | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number" || !Number.isSafeInteger(m.job)) return null;
  if (m.type === "cancel") return { type: "cancel", job: m.job };
  if (
    m.type !== "run" ||
    typeof m.kind !== "string" ||
    !Object.hasOwn(KINDS, m.kind) ||
    typeof m.settings !== "object" ||
    m.settings === null
  ) {
    return null;
  }
  return data as RunMessage;
}

interface ProgressMessage {
  readonly type: "progress";
  readonly job: number;
  /** 0..1. */
  readonly fraction: number;
}

/** What a conversion into a tour model left out (`notes`, in words) and
 *  which of the given files the model carries (`used`, by path). */
export interface ConversionReport {
  readonly notes: readonly string[];
  readonly used: readonly string[];
}

/** The smaller file, its extension, an image's new size, what a model's
 *  passes did, and what a conversion left out. */
interface DoneMessage {
  readonly type: "done";
  readonly job: number;
  readonly blob: Blob;
  readonly extension: string;
  readonly width?: number;
  readonly height?: number;
  readonly model?: ModelReport;
  readonly conversion?: ConversionReport;
}

/** The original stays, for `reason` (plain words). */
interface KeptMessage {
  readonly type: "kept";
  readonly job: number;
  readonly reason: string;
}

interface FailedMessage {
  readonly type: "failed";
  readonly job: number;
  readonly reason: string;
}

export type OptimizerOutbound =
  ProgressMessage | DoneMessage | KeptMessage | FailedMessage;

/** What one kind's step in the Worker answers, without the job id: the
 *  smaller file, or the original kept with words. A failure is a throw. */
export type WorkerStepAnswer =
  Omit<DoneMessage, "job"> | Omit<KeptMessage, "job">;

/** How a Worker step is told to stop and reports how far it is. */
export interface WorkerStepControl {
  readonly signal: AbortSignal;
  /** 0..1. */
  readonly progress: (fraction: number) => void;
}

/** What a step throws once its run was stopped. */
export function stoppedError(): DOMException {
  return new DOMException("the optimization was stopped", "AbortError");
}

/** One kind's step in a Worker: the answer it posts, without the job id. */
export type WorkerStep = (
  payload: unknown,
  settings: OptimizerSettings,
  control: WorkerStepControl,
) => Promise<WorkerStepAnswer>;

/** The part of a Worker's global scope the loop uses, so a test can fake
 *  it. */
export interface WorkerScope {
  postMessage(message: OptimizerOutbound): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
}

/**
 * The Worker side of the protocol: runs each `run` through its kind's step
 * and posts the answer with the job id, forwards progress, stops a run on
 * `cancel` (posting nothing for it afterwards: the page settled it), posts
 * a throw as `failed` with its words, answers a kind without a step in
 * words, and ignores whatever is no message of the protocol.
 */
export function serveSteps(
  scope: WorkerScope,
  steps: Partial<Record<TourAssetKind, WorkerStep>>,
): void {
  const running = new Map<number, AbortController>();
  async function run(message: RunMessage): Promise<void> {
    const { job } = message;
    const step = steps[message.kind];
    if (step === undefined) {
      scope.postMessage({
        type: "failed",
        job,
        reason: `This kind of file cannot be made smaller yet (${message.kind}).`,
      });
      return;
    }
    const stop = new AbortController();
    running.set(job, stop);
    try {
      const answer = await step(message.payload, message.settings, {
        signal: stop.signal,
        progress: (fraction) => {
          scope.postMessage({ type: "progress", job, fraction });
        },
      });
      if (!stop.signal.aborted) scope.postMessage({ ...answer, job });
    } catch (err) {
      if (!stop.signal.aborted) {
        scope.postMessage({
          type: "failed",
          job,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      running.delete(job);
    }
  }
  scope.addEventListener("message", (event) => {
    const message = inboundOf(event.data);
    if (message === null) return;
    if (message.type === "cancel") {
      running.get(message.job)?.abort();
      return;
    }
    void run(message);
  });
}
