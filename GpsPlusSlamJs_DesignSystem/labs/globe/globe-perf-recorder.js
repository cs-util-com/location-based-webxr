/**
 * The frame-hitch recorder's per-frame core (globe zoom frame-hitch plan
 * 2026-10-03-2017 §4.1, PERF-1): frame intervals, the events marked in each
 * frame, the count-only factors per run and the idle calibration's
 * intervals. The whole-run statistics, the attribution and the export are
 * the framework's (`createFrameRun` and its siblings, PERF-0), injected as
 * `createRun`. Dependency-free, so it runs under `node --test`.
 *
 * @see globe-perf-recorder.js.md
 */

/**
 * @param {{ createRun: () => { endFrame(intervalMs: number, events?: string[]): void,
 *   summary(): unknown } }} deps
 */
export function createPerfRecorder({ createRun }) {
  /** The current frame's start and its events (kind -> count). */
  let frameStart = null;
  let frameEnd = null;
  let events = new Map();
  let samples = new Map();
  /** The run in progress, or null. */
  let run = null;
  /** Idle intervals for the refresh calibration, or null. */
  let idle = null;

  const closeFrame = (startMs) => {
    if (frameStart === null) return;
    const interval = startMs - frameStart;
    if (idle) idle.push(interval);
    if (run && run.open) {
      run.frame.endFrame(interval, [...events.keys()]);
      run.frames += 1;
      if (frameEnd !== null) run.insideMs += frameEnd - frameStart;
      for (const [kind, n] of events) {
        const c = run.counts[kind] ?? { total: 0, maxPerFrame: 0, frames: 0 };
        c.total += n;
        c.maxPerFrame = Math.max(c.maxPerFrame, n);
        c.frames += 1;
        run.counts[kind] = c;
      }
      for (const [kind, values] of samples) {
        (run.samples[kind] ??= []).push(...values);
      }
    }
  };

  return {
    /** A frame begins: closes the one before (its interval ends here). */
    frameStart(nowMs) {
      closeFrame(nowMs);
      if (run && !run.open) run.open = true;
      frameStart = nowMs;
      frameEnd = null;
      events = new Map();
      samples = new Map();
    },
    /** The lab's own work for this frame is done (the rest is the gap). */
    frameEnd(nowMs) {
      frameEnd = nowMs;
    },
    /** An event in the current frame; `n` times (a positive integer). */
    mark(kind, n = 1) {
      if (typeof kind !== "string" || kind === "") {
        throw new RangeError("an event needs a kind");
      }
      if (!(Number.isInteger(n) && n > 0)) {
        throw new RangeError(
          `an event count must be a positive integer, got ${n}`,
        );
      }
      events.set(kind, (events.get(kind) ?? 0) + n);
    },
    /** A number taken in the current frame (a count walked on its own frame). */
    sample(kind, value) {
      const list = samples.get(kind) ?? [];
      list.push(value);
      samples.set(kind, list);
    },
    /** Starts a run: its first frame begins at the next `frameStart`. */
    startRun(label) {
      run = {
        label,
        frame: createRun(),
        open: false,
        frames: 0,
        insideMs: 0,
        counts: {},
        samples: {},
      };
    },
    /** Ends the run (at the start of the frame after its last). */
    stopRun() {
      const r = run;
      run = null;
      if (!r) return null;
      return {
        label: r.label,
        summary: r.frame.summary(),
        counts: r.counts,
        samples: r.samples,
        work: { insideMs: r.insideMs, frames: r.frames },
      };
    },
    running: () => run !== null,
    /** Starts collecting idle intervals (the refresh calibration). */
    startIdle() {
      idle = [];
    },
    stopIdle() {
      const out = idle ?? [];
      idle = null;
      return out;
    },
  };
}
