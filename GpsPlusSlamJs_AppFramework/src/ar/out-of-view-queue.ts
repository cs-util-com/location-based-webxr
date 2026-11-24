/**
 * The out-of-view queue of a deferred anchor set: for each pending entry
 * in an out-of-view run, how many passes it may wait before its commit.
 *
 * The set traverses one entry per pass, round robin, out-of-view entries
 * first. The pointer only moves forward and stops after each pick, so
 * during one entry's run every other entry can be picked at most once
 * before it: its queue is the DISTINCT entries out of view during its run,
 * itself included. An entry that goes out, comes back into view (or
 * commits) and goes out again in the same run counts once; counting every
 * entry instead let a churning ring grow the queue without bound, so a
 * starved entry still looked within its queue.
 *
 * Pure bookkeeping on fields the caller's entries carry; no three.js.
 *
 * Sidecar: `out-of-view-queue.ts.md`.
 */

/** The fields an entry carries for the queue. */
export interface OutOfViewRunState {
  /** Consecutive passes its cached tests said out of view, while pending. */
  outFrames: number;
  /** Its queue in the current run (0 outside a run). */
  queued: number;
  /** The pass its current run began. */
  outSince: number;
  /** The last pass it was out of view, in any run (-Infinity: never). */
  lastOutPass: number;
}

/** The fields of an entry that was never out of view. */
export function freshOutOfViewRun(): OutOfViewRunState {
  return { outFrames: 0, queued: 0, outSince: 0, lastOutPass: -Infinity };
}

/**
 * One pass: `out` the entries out of view in it, `all` every entry of the
 * set (to find the runs that go on). An entry starting a run starts with
 * the entries out with it, itself included; an entry going out adds one to
 * every run in progress that it has not been out during already.
 */
export function advanceOutOfViewRuns<S extends OutOfViewRunState>(
  pass: number,
  out: readonly S[],
  all: Iterable<S>
): void {
  const entering = out.filter((s) => s.outFrames === 0);
  if (entering.length > 0) {
    for (const c of all) {
      if (c.outFrames === 0) continue;
      for (const x of entering) {
        if (x.lastOutPass < c.outSince) c.queued += 1;
      }
    }
  }
  for (const x of entering) {
    x.queued = out.length;
    x.outSince = pass;
  }
  for (const s of out) {
    s.outFrames += 1;
    s.lastOutPass = pass;
  }
}

/** The run ends (a commit, back in view, no longer pending). */
export function endOutOfViewRun(s: OutOfViewRunState): void {
  s.outFrames = 0;
  s.queued = 0;
}
