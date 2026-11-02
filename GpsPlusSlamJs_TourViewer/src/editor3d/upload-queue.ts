/**
 * The staged first uploads of the editor on the globe (the full-globe
 * editor plan, staged uploads): a per-frame queue of jobs, one per key, run
 * at most `perFrame` a frame in the order they were asked for, each frame's
 * time on them measured. The page queues a station's first drawing (its
 * materials compiled, its textures uploaded) and shows it only once its job
 * ran, so a tour of many stations is drawn over several frames instead of
 * in one long first frame.
 *
 * Pure (no WebGL): the jobs are the page's.
 *
 * @see upload-queue.ts.md
 */

/** The page's choice: the sweep in the tests shows the trade. */
export const UPLOADS = Object.freeze({
  /** First uploads a frame. Declared, not measured on a phone. */
  perFrame: 4,
});

/** What one step did: the jobs run and the time they took (ms). */
export interface UploadStep {
  readonly ran: number;
  readonly ms: number;
}

/**
 * A queue running at most `perFrame` jobs per `step`. A key asked again
 * keeps its place with its newest job; `drop` forgets one. A job that
 * throws counts as run (a lost context must not wedge the queue).
 * RangeError for a `perFrame` that is not a whole number of at least one.
 */
export function createUploadQueue(options: {
  readonly perFrame: number;
  /** The clock (ms); `performance.now` by default. */
  readonly now?: () => number;
}) {
  const { perFrame } = options;
  if (!Number.isInteger(perFrame) || perFrame < 1) {
    throw new RangeError(
      `perFrame must be a whole number >= 1, got ${String(perFrame)}`,
    );
  }
  const now = options.now ?? (() => performance.now());
  const jobs = new Map<string, () => void>();
  let ran = 0;
  let worstFrameMs = 0;
  return {
    add(key: string, job: () => void): void {
      jobs.set(key, job);
    },
    drop(key: string): void {
      jobs.delete(key);
    },
    has: (key: string): boolean => jobs.has(key),
    pending: (): number => jobs.size,
    /** Each frame, before the drawing. */
    step(): UploadStep {
      const start = now();
      let count = 0;
      for (const [key, job] of jobs) {
        if (count === perFrame) break;
        jobs.delete(key);
        count++;
        try {
          job();
        } catch {
          // Counted as run: the next frame goes on with the rest.
        }
      }
      ran += count;
      const ms = now() - start;
      worstFrameMs = Math.max(worstFrameMs, ms);
      return { ran: count, ms };
    },
    /** For the page's checks: what waits, what ran, the worst frame. */
    stats: () => ({ pending: jobs.size, ran, worstFrameMs }),
  };
}
