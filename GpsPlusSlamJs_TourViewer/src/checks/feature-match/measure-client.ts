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

/**
 * How long one pair may stay in the worker before it counts as a crash.
 * The first pair also downloads the models (about 66 MB with the default
 * methods), so this must outlast that download on a slow phone line:
 * 10 min covers about 0.9 Mbit/s. See the sidecar for 5 and 20 min.
 */
export const MEASURE_TIMEOUT_MS = 10 * 60_000;

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
  let running: {
    readonly id: number;
    readonly held: Held;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const waiting: Held[] = [];
  let seq = 0;

  /** Ends the running pair and its timer; returns what it held. */
  function endRunning(): Held | undefined {
    const r = running;
    running = null;
    if (r !== null) {
      clearTimeout(r.timer);
    }
    return r?.held;
  }

  function dropAll(error: () => unknown): void {
    const dead = worker;
    worker = null;
    const held = [endRunning(), ...waiting.splice(0)];
    for (const h of held) {
      h?.reject(error());
    }
    dead?.terminate();
  }

  function onAnswer(event: MessageEvent): void {
    if (running === null) {
      return;
    }
    const answer = answerOf(event.data);
    if (answer === null) {
      // A malformed message naming the running pair fails it, or the
      // queue would wait for an answer that never comes.
      const job = (event.data as { job?: unknown } | null)?.job;
      if (job === running.id) {
        endRunning()?.reject(new MeasureFailed("malformed answer"));
        startNext();
      }
      return;
    }
    if (answer.job !== running.id) {
      return;
    }
    if (answer.type === "progress") {
      running.held.onLine(answer.line);
      return;
    }
    const held = endRunning()!;
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
    spawned.onerror = (event) => {
      // Handled here: the page's error log need not report it again.
      event.preventDefault();
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
    // A worker that never answers (a hung GPU call, a lost message) would
    // stall the queue for good: after the timeout it counts as a crash.
    const timer = setTimeout(() => {
      if (running?.id === id) {
        dropAll(() => new WorkerCrashed("timed out"));
      }
    }, MEASURE_TIMEOUT_MS);
    running = { id, held, timer };
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
