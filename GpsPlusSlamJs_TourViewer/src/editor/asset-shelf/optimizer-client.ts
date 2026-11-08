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
  readonly resolve: (outcome: OptimizeOutcome) => void;
  readonly reject: (error: unknown) => void;
  readonly control: OptimizeControl;
  readonly onAbort: () => void;
}

function aborted(): DOMException {
  return new DOMException("the optimization was stopped", "AbortError");
}

/** `data` as an answer of the protocol, or null for anything else. */
function answerOf(data: unknown): OptimizerOutbound | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number") return null;
  switch (m.type) {
    case "progress":
      return typeof m.fraction === "number"
        ? (data as OptimizerOutbound)
        : null;
    case "done":
      return m.blob instanceof Blob && typeof m.extension === "string"
        ? (data as OptimizerOutbound)
        : null;
    case "kept":
    case "failed":
      return typeof m.reason === "string" ? (data as OptimizerOutbound) : null;
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
    const answer = answerOf(event.data);
    if (answer === null) return;
    if (answer.type === "progress") {
      pending.get(answer.job)?.control.progress(answer.fraction);
      return;
    }
    const run = settle(answer.job);
    if (run === undefined) return;
    if (answer.type === "failed") {
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
        pending.set(job, { resolve, reject, control, onAbort });
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
