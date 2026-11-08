/**
 * The asset optimizer's module Worker: runs the heavy part of an
 * optimization off the page (`optimizer-client.ts` is its page side,
 * `optimizer-protocol.ts` the messages). Each kind's step is a row of
 * `WORKER_STEPS`; this build has none, so every run answers "failed" with
 * words - no row of the page's table (`ASSET_OPTIMIZERS`) calls it yet.
 * The device seam: not unit-tested (it needs a real Worker).
 *
 * @see asset-optimizer.worker.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type {
  OptimizerInbound,
  OptimizerOutbound,
} from "./optimizer-protocol.js";
import type { OptimizerSettings } from "./optimizer-settings.js";

/** One kind's step: the answer it posts, without the job id. */
type WorkerStep = (
  payload: unknown,
  settings: OptimizerSettings,
  control: {
    readonly signal: AbortSignal;
    readonly progress: (fraction: number) => void;
  },
) => Promise<
  | {
      readonly type: "done";
      readonly blob: Blob;
      readonly extension: string;
      readonly width?: number;
      readonly height?: number;
    }
  | { readonly type: "kept"; readonly reason: string }
>;

const WORKER_STEPS: Partial<Record<TourAssetKind, WorkerStep>> = {};

// `self` is typed as `Window` under the app's DOM lib (no webworker lib).
const ctx = self as unknown as {
  postMessage: (message: OptimizerOutbound) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
};

const running = new Map<number, AbortController>();

async function run(
  message: Extract<OptimizerInbound, { type: "run" }>,
): Promise<void> {
  const { job } = message;
  const step = WORKER_STEPS[message.kind];
  if (step === undefined) {
    ctx.postMessage({
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
        ctx.postMessage({ type: "progress", job, fraction });
      },
    });
    if (!stop.signal.aborted) ctx.postMessage({ ...answer, job });
  } catch (err) {
    if (!stop.signal.aborted) {
      ctx.postMessage({
        type: "failed",
        job,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    running.delete(job);
  }
}

ctx.addEventListener("message", (event) => {
  const message = event.data as OptimizerInbound;
  if (message.type === "cancel") {
    running.get(message.job)?.abort();
    return;
  }
  if (message.type === "run") void run(message);
});
