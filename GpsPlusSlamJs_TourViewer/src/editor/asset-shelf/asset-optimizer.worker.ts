/**
 * The asset optimizer's module Worker: runs the heavy part of an
 * optimization off the page (`optimizer-client.ts` is its page side,
 * `optimizer-protocol.ts` the messages). Each kind's step is a row of
 * `WORKER_STEPS`: pictures (`picture-step.ts`), sounds (`sound-step.ts`)
 * and 3D models (`model-step.ts`, whose textures go through the picture
 * device); a kind without a step answers "failed" with words.
 * The device seam: not unit-tested (it needs a real Worker); the steps'
 * decisions are, and the e2e runs this file.
 *
 * @see asset-optimizer.worker.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  inboundOf,
  type OptimizerInbound,
  type OptimizerOutbound,
  type WorkerStepAnswer,
  type WorkerStepControl,
} from "./optimizer-protocol.js";
import type { OptimizerSettings } from "./optimizer-settings.js";
import { optimizeModel } from "./model-step.js";
import { optimizePicture, PICTURE_DEVICE } from "./picture-step.js";
import { optimizeSound, SOUND_DEVICE } from "./sound-step.js";

/** One kind's step: the answer it posts, without the job id. */
type WorkerStep = (
  payload: unknown,
  settings: OptimizerSettings,
  control: WorkerStepControl,
) => Promise<WorkerStepAnswer>;

const WORKER_STEPS: Partial<Record<TourAssetKind, WorkerStep>> = {
  image: (payload, settings, control) =>
    optimizePicture(payload, settings, control, PICTURE_DEVICE),
  audio: (payload, settings, control) =>
    optimizeSound(payload, settings, control, SOUND_DEVICE),
  model: (payload, settings, control) =>
    optimizeModel(payload, settings, control, PICTURE_DEVICE),
};

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

// What arrives is checked first: anything else is ignored (`inboundOf`).
ctx.addEventListener("message", (event) => {
  const message = inboundOf(event.data);
  if (message === null) return;
  if (message.type === "cancel") {
    running.get(message.job)?.abort();
    return;
  }
  if (message.type === "run") void run(message);
});
