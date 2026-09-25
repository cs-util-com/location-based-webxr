/**
 * Bounded parse queue (plan A8).
 *
 * On a dense route several waypoints can cross the 25 m prefetch line in the
 * same update, and `GLTFLoader.parseAsync` runs on the main thread. Firing them
 * all at once re-introduces exactly the frame-rate stutter the PREFETCH zone
 * exists to prevent (TASK §2.5.3), so at most `concurrency` tasks run at a time
 * and the rest wait in FIFO order.
 *
 * `drain()` is the disposal path: queued-but-not-started tasks are dropped and
 * their promises rejected with a `QueueDrainedError`, which the caller treats as
 * "this waypoint simply never loaded". Already-running tasks are left to finish
 * — they cannot be cancelled, and the lifecycle's generation guard already makes
 * their late results harmless.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §4.4
 */

/** Thrown into pending tasks when the queue is drained during teardown. */
export class QueueDrainedError extends Error {
  constructor() {
    super("parse queue drained");
    this.name = "QueueDrainedError";
  }
}

export interface ParseQueueOptions {
  readonly concurrency: number;
}

export interface ParseQueue {
  /** Enqueue work; resolves/rejects with the task's own result. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently executing. */
  readonly active: number;
  /** Tasks waiting for a slot. */
  readonly pending: number;
  /** Drop everything not yet started (teardown). */
  drain(): void;
}

interface QueuedTask {
  readonly start: () => void;
  readonly abort: (error: Error) => void;
}

export function createParseQueue(options: ParseQueueOptions): ParseQueue {
  const limit = Math.max(1, options.concurrency);
  const waiting: QueuedTask[] = [];
  let active = 0;

  const pump = (): void => {
    while (active < limit && waiting.length > 0) {
      waiting.shift()!.start();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const queued: QueuedTask = {
          start: () => {
            active += 1;
            // The slot is freed BEFORE the caller's continuation runs. Chaining
            // this off `.finally()` instead would leave the next queued parse
            // unstarted for one extra microtask, so an awaiting caller could
            // observe a free slot that nobody had been given yet.
            const finish = (): void => {
              active -= 1;
              pump();
            };
            void task().then(
              (value) => {
                finish();
                resolve(value);
              },
              (error: unknown) => {
                finish();
                // Forward the task's own rejection reason verbatim. Wrapping it
                // in a fresh Error would erase the type callers branch on (e.g.
                // the framework's StructuralReadError / this module's StaleLoadError).
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject(error);
              },
            );
          },
          abort: reject,
        };
        waiting.push(queued);
        pump();
      });
    },

    get active(): number {
      return active;
    },

    get pending(): number {
      return waiting.length;
    },

    drain(): void {
      const dropped = waiting.splice(0, waiting.length);
      for (const task of dropped) task.abort(new QueueDrainedError());
    },
  };
}
