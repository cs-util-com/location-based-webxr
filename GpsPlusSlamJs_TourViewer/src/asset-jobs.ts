/**
 * One file's optimization job on the editor's asset shelf, as a pure state
 * machine: idle (an opened tour's file, optimized only when asked), queued,
 * running with its progress, then optimized, kept as it was (with the
 * reason, in plain words) or failed (with the reason). Every transition
 * from a phase it does not apply to returns the job unchanged, so a late
 * message never moves a finished job. Plain data: the shelf slice stores
 * it (`asset-shelf-slice.ts`).
 *
 * @see asset-jobs.ts.md
 */

/** Where a job stands. */
export type ShelfPhase =
  "idle" | "queued" | "running" | "optimized" | "kept" | "failed";

export interface ShelfJob {
  readonly phase: ShelfPhase;
  /** 0..1 while running; 1 once optimized. */
  readonly progress: number;
  /** Why the original was kept, or why the job failed. */
  readonly reason?: string;
  /** Whether the shelf may offer Retry for this end. */
  readonly retryable: boolean;
  /** Starts since the last queueing by the author: a crashed worker's job
   *  is queued again by itself until `MAX_JOB_ATTEMPTS`. */
  readonly attempts: number;
}

/** A crashed worker's job is tried this often in all, then it stops. */
export const MAX_JOB_ATTEMPTS = 2;

export const IDLE_JOB: ShelfJob = {
  phase: "idle",
  progress: 0,
  retryable: false,
  attempts: 0,
};

/** Waiting for a slot. From idle only (a running or queued job stays). */
export function jobQueued(job: ShelfJob): ShelfJob {
  if (job.phase !== "idle") return job;
  return { phase: "queued", progress: 0, retryable: false, attempts: 0 };
}

export function jobStarted(job: ShelfJob): ShelfJob {
  if (job.phase !== "queued") return job;
  return {
    phase: "running",
    progress: 0,
    retryable: false,
    attempts: job.attempts + 1,
  };
}

/** A running job's progress, clamped to 1; one that would go back, or is
 *  no number of 0 or more, is ignored. */
export function jobProgress(job: ShelfJob, fraction: number): ShelfJob {
  if (job.phase !== "running" || !(fraction >= 0)) return job;
  const progress = Math.min(1, fraction);
  return progress <= job.progress ? job : { ...job, progress };
}

export function jobOptimized(job: ShelfJob): ShelfJob {
  if (job.phase !== "running") return job;
  return { ...job, phase: "optimized", progress: 1, retryable: false };
}

/** The original stays (the result was not smaller, the kind has no
 *  optimizer yet): not retryable, since a second run would say the same. */
export function jobKept(job: ShelfJob, reason: string): ShelfJob {
  if (job.phase !== "running") return job;
  return { ...job, phase: "kept", reason, retryable: false };
}

/** A running job failed. `crashed` (the worker died under it): queued
 *  again by itself while attempts remain. */
export function jobFailed(
  job: ShelfJob,
  reason: string,
  how: { readonly retryable: boolean; readonly crashed?: boolean },
): ShelfJob {
  if (job.phase !== "running") return job;
  if (how.crashed === true && job.attempts < MAX_JOB_ATTEMPTS) {
    return {
      phase: "queued",
      progress: 0,
      retryable: false,
      attempts: job.attempts,
    };
  }
  return { ...job, phase: "failed", reason, retryable: how.retryable };
}

/** The author's Retry: a retryable end is queued again, with fresh
 *  attempts. */
export function jobRetried(job: ShelfJob): ShelfJob {
  if ((job.phase !== "failed" && job.phase !== "kept") || !job.retryable) {
    return job;
  }
  return { phase: "queued", progress: 0, retryable: false, attempts: 0 };
}

/** "Use the original": a smaller file's job ends as kept, retryable, so
 *  the author can ask for the smaller file again. */
export function originalUsed(job: ShelfJob, reason: string): ShelfJob {
  if (job.phase !== "optimized") return job;
  return { ...job, phase: "kept", reason, retryable: true };
}
