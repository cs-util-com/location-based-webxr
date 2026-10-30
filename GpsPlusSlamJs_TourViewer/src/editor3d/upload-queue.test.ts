/**
 * Why these tests matter: a tour of many stations opened on the globe
 * would otherwise compile and upload every station's drawing in the first
 * frame, one long hitch. The queue spreads those first uploads over frames,
 * at most `perFrame` a frame, in the order they were asked for, and
 * measures what each frame spent on them; the page reads that measure. The
 * sweep of `perFrame` (1, 4, 16) shows the trade the page's choice makes:
 * a cheaper worst frame against more frames until everything is drawn.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { UPLOADS, createUploadQueue } from "./upload-queue.js";

/** A fake clock the jobs advance: each job costs `costMs`. */
function clocked(costMs: number) {
  let t = 0;
  return {
    now: () => t,
    job: (log: string[], key: string) => () => {
      t += costMs;
      log.push(key);
    },
  };
}

describe("createUploadQueue", () => {
  it("runs at most perFrame jobs a step, first asked first run", () => {
    const clock = clocked(2);
    const log: string[] = [];
    const queue = createUploadQueue({ perFrame: 2, now: clock.now });
    for (const key of ["bench", "lamp", "tree"]) {
      queue.add(key, clock.job(log, key));
    }
    expect(queue.pending()).toBe(3);
    expect(queue.has("lamp")).toBe(true);
    expect(queue.step()).toEqual({ ran: 2, ms: 4 });
    expect(log).toEqual(["bench", "lamp"]);
    expect(queue.has("lamp")).toBe(false);
    expect(queue.step()).toEqual({ ran: 1, ms: 2 });
    expect(queue.step()).toEqual({ ran: 0, ms: 0 });
    expect(queue.stats()).toEqual({ pending: 0, ran: 3, worstFrameMs: 4 });
  });

  it("keeps one job per key (the latest), and drops a job asked away", () => {
    const clock = clocked(1);
    const log: string[] = [];
    const queue = createUploadQueue({ perFrame: 4, now: clock.now });
    queue.add("bench", clock.job(log, "bench-old"));
    queue.add("lamp", clock.job(log, "lamp"));
    queue.add("bench", clock.job(log, "bench-new"));
    queue.add("tree", clock.job(log, "tree"));
    queue.drop("lamp");
    queue.drop("never-asked");
    queue.step();
    // The re-asked key keeps its place in the line, with its new job.
    expect(log).toEqual(["bench-new", "tree"]);
  });

  it("goes on after a job that throws, and counts it as run", () => {
    const log: string[] = [];
    const queue = createUploadQueue({ perFrame: 4, now: () => 0 });
    queue.add("bench", () => {
      throw new Error("the context was lost");
    });
    queue.add("lamp", () => log.push("lamp"));
    expect(queue.step().ran).toBe(2);
    expect(log).toEqual(["lamp"]);
  });

  it("refuses a perFrame that is not a whole number of at least one", () => {
    for (const perFrame of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createUploadQueue({ perFrame }), String(perFrame)).toThrow(
        RangeError,
      );
    }
    expect(UPLOADS.perFrame).toBeGreaterThanOrEqual(1);
  });

  // The sweep the plan asks for: 40 stations' first uploads at 3 ms each
  // (a declared cost, not a measurement; the page measures its own in
  // `stats().worstFrameMs`). The worst frame grows with perFrame and the
  // frames to draw everything shrink; the page's default sits between.
  it("sweeps perFrame 1, 4, 16: the worst frame against the frames to finish", () => {
    const report: Record<number, { worstFrameMs: number; frames: number }> = {};
    for (const perFrame of [1, 4, 16]) {
      const clock = clocked(3);
      const log: string[] = [];
      const queue = createUploadQueue({ perFrame, now: clock.now });
      for (let i = 0; i < 40; i++) queue.add(`s${i}`, clock.job(log, `s${i}`));
      let frames = 0;
      while (queue.pending() > 0) {
        queue.step();
        frames++;
      }
      report[perFrame] = { worstFrameMs: queue.stats().worstFrameMs, frames };
    }
    expect(report).toEqual({
      1: { worstFrameMs: 3, frames: 40 },
      4: { worstFrameMs: 12, frames: 10 },
      16: { worstFrameMs: 48, frames: 3 },
    });
  });

  it("property: every job runs exactly once, in order, perFrame at most a step", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 80 }),
        (perFrame, keys) => {
          const log: string[] = [];
          const queue = createUploadQueue({ perFrame, now: () => 0 });
          for (const k of keys) queue.add(`k${k}`, () => log.push(`k${k}`));
          const distinct = [...new Set(keys.map((k) => `k${k}`))];
          while (queue.pending() > 0) {
            expect(queue.step().ran).toBeLessThanOrEqual(perFrame);
          }
          expect(log).toEqual(distinct);
        },
      ),
    );
  });
});
