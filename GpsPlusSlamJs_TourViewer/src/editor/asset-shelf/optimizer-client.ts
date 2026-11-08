/**
 * The page's side of the asset optimizer's module Worker: an
 * `OptimizerHost` that spawns the Worker on the first run that needs it,
 * correlates answers by job, forwards progress, cancels on abort, and
 * after a crash rejects every run it held with `OptimizerCrashed` and
 * spawns a fresh Worker for the next one. The transport logic
 * (`createOptimizerHost`) is tested with a fake Worker; the device seam
 * (`spawnOptimizerWorker`) only constructs the real one.
 *
 * @see optimizer-client.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourMediaTypeOf } from "gps-plus-slam-app-framework/ar/tour-media";

import {
  OptimizerCrashed,
  type OptimizeControl,
  type OptimizeOutcome,
  type OptimizerHost,
} from "./asset-optimizers.js";
import type {
  OptimizerInbound,
  OptimizerOutbound,
} from "./optimizer-protocol.js";

/** The part of a `Worker` the client uses, so a test can fake it. */
export interface OptimizerWorker {
  postMessage(message: OptimizerInbound): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface Pending {
  /** The kind the run was asked for: a smaller file must be of it. */
  readonly kind: TourAssetKind;
  readonly resolve: (outcome: OptimizeOutcome) => void;
  readonly reject: (error: unknown) => void;
  readonly control: OptimizeControl;
  readonly onAbort: () => void;
}

function aborted(): DOMException {
  return new DOMException("the optimization was stopped", "AbortError");
}

/** Said when the Worker's smaller file is not one the tour takes for the
 *  run's kind (no Blob, an extension of another kind or none the format
 *  allows, an image size that is no positive whole number). */
const BAD_FILE = "the optimizer answered with a file the tour cannot take";
/** Said when the Worker kept or failed a run without words. */
const NO_REASON = "the optimizer answered with no reason";

/** An answer of a known type whose fields do not read: its run fails. */
interface Malformed {
  readonly type: "malformed";
  readonly job: number;
  readonly reason: string;
}

function isPixelCount(n: unknown): boolean {
  return n === undefined || (Number.isSafeInteger(n) && (n as number) > 0);
}

/** `data` as an answer of the protocol for a run of `kindOf(job)`; one of
 *  a known type whose fields do not read is `Malformed`; null for
 *  anything else (no job number, an unknown type, a progress that is no
 *  number). */
function answerOf(
  data: unknown,
  kindOf: (job: number) => TourAssetKind | undefined,
): OptimizerOutbound | Malformed | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number") return null;
  const job = m.job;
  switch (m.type) {
    case "progress":
      return typeof m.fraction === "number"
        ? (data as OptimizerOutbound)
        : null;
    case "done": {
      const kind = kindOf(job);
      const fits =
        m.blob instanceof Blob &&
        typeof m.extension === "string" &&
        kind !== undefined &&
        tourMediaTypeOf(m.extension)?.kind === kind &&
        isPixelCount(m.width) &&
        isPixelCount(m.height);
      return fits
        ? (data as OptimizerOutbound)
        : { type: "malformed", job, reason: BAD_FILE };
    }
    case "kept":
    case "failed":
      return typeof m.reason === "string"
        ? (data as OptimizerOutbound)
        : { type: "malformed", job, reason: NO_REASON };
    default:
      return null;
  }
}

export function createOptimizerHost(
  spawn: () => OptimizerWorker,
): OptimizerHost {
  let worker: OptimizerWorker | null = null;
  const pending = new Map<number, Pending>();
  let seq = 0;

  function settle(job: number): Pending | undefined {
    const run = pending.get(job);
    if (run === undefined) return undefined;
    pending.delete(job);
    run.control.signal.removeEventListener("abort", run.onAbort);
    return run;
  }

  /** Every run rejects with `error`; the Worker goes. */
  function dropAll(error: () => unknown): void {
    const dead = worker;
    worker = null;
    for (const job of [...pending.keys()]) settle(job)?.reject(error());
    dead?.terminate();
  }

  function onAnswer(event: MessageEvent): void {
    const answer = answerOf(event.data, (job) => pending.get(job)?.kind);
    if (answer === null) return;
    if (answer.type === "progress") {
      pending.get(answer.job)?.control.progress(answer.fraction);
      return;
    }
    const run = settle(answer.job);
    if (run === undefined) return;
    if (answer.type === "failed" || answer.type === "malformed") {
      run.reject(new Error(answer.reason));
    } else if (answer.type === "kept") {
      run.resolve({ kind: "kept", reason: answer.reason });
    } else {
      run.resolve({
        kind: "optimized",
        blob: answer.blob,
        extension: answer.extension,
        ...(answer.width === undefined ? {} : { width: answer.width }),
        ...(answer.height === undefined ? {} : { height: answer.height }),
      });
    }
  }

  function live(): OptimizerWorker {
    if (worker !== null) return worker;
    const spawned = spawn();
    spawned.onmessage = onAnswer;
    spawned.onerror = () => {
      if (worker === spawned) dropAll(() => new OptimizerCrashed());
    };
    worker = spawned;
    return spawned;
  }

  return {
    run(kind, payload, settings, control) {
      if (control.signal.aborted) return Promise.reject(aborted());
      return new Promise<OptimizeOutcome>((resolve, reject) => {
        const job = ++seq;
        let target: OptimizerWorker;
        try {
          target = live();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const onAbort = () => {
          if (settle(job) === undefined) return;
          target.postMessage({ type: "cancel", job });
          reject(aborted());
        };
        pending.set(job, { kind, resolve, reject, control, onAbort });
        control.signal.addEventListener("abort", onAbort, { once: true });
        target.postMessage({ type: "run", job, kind, payload, settings });
      });
    },
    close() {
      dropAll(aborted);
    },
  };
}

/** The device seam: the real module Worker (not unit-tested). */
export function spawnOptimizerWorker(): OptimizerWorker {
  return new Worker(new URL("./asset-optimizer.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as OptimizerWorker;
}
