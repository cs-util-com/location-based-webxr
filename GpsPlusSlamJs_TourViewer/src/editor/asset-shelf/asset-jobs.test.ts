/**
 * Why these tests matter: every file on the shelf moves through one small
 * state machine - waiting, queued, running, then made smaller, kept as it
 * was (with the reason) or failed (with the reason). The shelf's progress
 * rings, its Retry and its "use the original" all read these phases, so a
 * transition that is allowed from the wrong phase (a late progress after
 * the job ended, a second start) would show a file as running forever or
 * run it twice. A crashed worker is retried once by itself and then stops.
 */
import { describe, expect, it } from "vitest";

import {
  IDLE_JOB,
  MAX_JOB_ATTEMPTS,
  jobFailed,
  jobKept,
  jobOptimized,
  jobProgress,
  jobQueued,
  jobRetried,
  jobStarted,
  originalUsed,
  type ShelfJob,
} from "./asset-jobs.js";

const running = jobStarted(jobQueued(IDLE_JOB));

describe("the shelf's job state machine", () => {
  it("queues, starts, reports progress and ends optimized", () => {
    const queued = jobQueued(IDLE_JOB);
    expect(queued.phase).toBe("queued");
    expect(running).toMatchObject({ phase: "running", attempts: 1 });
    const half = jobProgress(running, 0.5);
    expect(half.progress).toBe(0.5);
    expect(jobOptimized(half)).toMatchObject({
      phase: "optimized",
      progress: 1,
    });
  });

  // Why: a progress message can arrive after the job ended (the worker
  // posts it just before its result). It must not bring a ring back.
  it("ignores transitions from the wrong phase", () => {
    const done = jobOptimized(running);
    expect(jobProgress(done, 0.2)).toBe(done);
    expect(jobStarted(done)).toBe(done);
    expect(jobStarted(running)).toBe(running);
    expect(jobOptimized(IDLE_JOB)).toBe(IDLE_JOB);
    expect(jobKept(IDLE_JOB, "x")).toBe(IDLE_JOB);
    expect(jobFailed(IDLE_JOB, "x", { retryable: true })).toBe(IDLE_JOB);
    expect(jobQueued(running)).toBe(running);
  });

  it("keeps progress within 0..1 and never lets it go back", () => {
    const at = jobProgress(running, 0.6);
    expect(jobProgress(at, 0.3)).toBe(at);
    expect(jobProgress(running, 7).progress).toBe(1);
    expect(jobProgress(running, Number.NaN)).toBe(running);
    expect(jobProgress(running, -1)).toBe(running);
  });

  it("keeps the original with a reason, and fails with one", () => {
    expect(jobKept(running, "not smaller")).toMatchObject({
      phase: "kept",
      reason: "not smaller",
      retryable: false,
    });
    expect(jobFailed(running, "broken", { retryable: true })).toMatchObject({
      phase: "failed",
      reason: "broken",
      retryable: true,
    });
  });

  // Why: an out-of-memory crash shows as the worker's error event. One
  // more attempt is worth it (the next job may have freed memory); a
  // second crash stops, so a file that kills the worker cannot loop.
  it("retries a crashed job by itself until the attempts are spent", () => {
    let job: ShelfJob = running;
    for (let attempt = 1; attempt < MAX_JOB_ATTEMPTS; attempt++) {
      job = jobFailed(job, "crashed", { retryable: true, crashed: true });
      expect(job.phase).toBe("queued");
      job = jobStarted(job);
    }
    expect(job.attempts).toBe(MAX_JOB_ATTEMPTS);
    const stopped = jobFailed(job, "crashed", {
      retryable: true,
      crashed: true,
    });
    expect(stopped).toMatchObject({ phase: "failed", retryable: true });
  });

  it("retries only a retryable end, with fresh attempts", () => {
    const failed = jobFailed(running, "broken", { retryable: true });
    expect(jobRetried(failed)).toMatchObject({ phase: "queued", attempts: 0 });
    const final = jobFailed(running, "too large", { retryable: false });
    expect(jobRetried(final)).toBe(final);
    expect(jobRetried(jobKept(running, "not smaller"))).toMatchObject({
      phase: "kept",
    });
    expect(jobRetried(running)).toBe(running);
  });

  // Why: "use the original" undoes the swap; the author may still ask for
  // the smaller file again later, so that end is retryable.
  it("goes back to the original only from a smaller file", () => {
    const back = originalUsed(jobOptimized(running), "the original");
    expect(back).toMatchObject({
      phase: "kept",
      reason: "the original",
      retryable: true,
    });
    expect(jobRetried(back).phase).toBe("queued");
    expect(originalUsed(running, "x")).toBe(running);
  });
});
