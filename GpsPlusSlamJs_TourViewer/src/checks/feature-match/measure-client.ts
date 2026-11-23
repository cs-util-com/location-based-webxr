/**
 * The page's side of the feature-match measuring worker: `measure` sends
 * one pair, forwards its progress lines and resolves with its results.
 * One FIFO, one pair in the worker at a time: every queued pair is
 * measured, none replaces another. After a crash every held request
 * rejects with `WorkerCrashed` and the next call spawns a fresh worker.
 * Tested with a fake worker; the page constructs the real one with
 * `new Worker(new URL("./feature-match-measure.worker.ts", import.meta.url), { type: "module" })`.
 *
 * @see measure-client.ts.md
 */
import {
  answerOf,
  type MeasureDone,
  type MeasureJob,
  type MeasureRequest,
} from "./measure-protocol";

/** The part of a `Worker` the client uses, so a test can fake it. */
export interface MeasureWorker {
  postMessage(message: MeasureRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

/** The worker stopped (out of memory, a crash) while it held the request. */
export class WorkerCrashed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerCrashed";
  }
}

/** The worker could not measure the pair (a PNG it could not decode). */
export class MeasureFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasureFailed";
  }
}

export interface MeasureClient {
  measure(
    job: MeasureJob,
    onLine?: (line: string) => void,
  ): Promise<MeasureDone>;
  /** Rejects every held request and ends the worker. */
  close(): void;
}

interface Held {
  readonly job: MeasureJob;
  readonly onLine: (line: string) => void;
  readonly resolve: (done: MeasureDone) => void;
  readonly reject: (error: unknown) => void;
}

export function createMeasureClient(spawn: () => MeasureWorker): MeasureClient {
  let worker: MeasureWorker | null = null;
  let running: { readonly id: number; readonly held: Held } | null = null;
  const waiting: Held[] = [];
  let seq = 0;

  function dropAll(error: () => unknown): void {
    const dead = worker;
    worker = null;
    const held = [running?.held, ...waiting.splice(0)];
    running = null;
    for (const h of held) {
      h?.reject(error());
    }
    dead?.terminate();
  }

  function onAnswer(event: MessageEvent): void {
    const answer = answerOf(event.data);
    if (answer === null || running === null || answer.job !== running.id) {
      return;
    }
    const { held } = running;
    if (answer.type === "progress") {
      held.onLine(answer.line);
      return;
    }
    running = null;
    if (answer.type === "done") {
      const { results, frames, settings, measureMs } = answer;
      held.resolve({ results, frames, settings, measureMs });
    } else {
      held.reject(new MeasureFailed(answer.message));
    }
    startNext();
  }

  function live(): MeasureWorker {
    if (worker !== null) {
      return worker;
    }
    const spawned = spawn();
    spawned.onmessage = onAnswer;
    spawned.onerror = () => {
      if (worker === spawned) {
        dropAll(
          () => new WorkerCrashed("the measuring worker stopped unexpectedly"),
        );
      }
    };
    worker = spawned;
    return spawned;
  }

  function startNext(): void {
    if (running !== null) {
      return;
    }
    const held = waiting.shift();
    if (!held) {
      return;
    }
    let target: MeasureWorker;
    try {
      target = live();
    } catch (e) {
      held.reject(e instanceof Error ? e : new Error(String(e)));
      startNext();
      return;
    }
    const id = ++seq;
    running = { id, held };
    target.postMessage({ type: "measure", job: id, ...held.job });
  }

  return {
    measure(job, onLine = () => undefined) {
      return new Promise<MeasureDone>((resolve, reject) => {
        waiting.push({ job, onLine, resolve, reject });
        startNext();
      });
    },
    close() {
      dropAll(() => new DOMException("the page closed", "AbortError"));
    },
  };
}
