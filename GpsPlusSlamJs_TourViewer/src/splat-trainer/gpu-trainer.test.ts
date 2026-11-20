import { describe, expect, it } from "vitest";

import { buildSyntheticRecording } from "../test-support/synthetic-recording.js";
import {
  createGpuTrainer,
  judgeGpuRun,
  type WorkerLike,
} from "./gpu-trainer.js";
import { readSplatInputs } from "./recording-reader.js";
import type {
  TrainProgress,
  TrainRequest,
  WindowTrainResult,
} from "./trainer-adapter.js";
import { TRAINER_DEFAULTS } from "./trainer-defaults.js";
import { windowPlanner } from "./window-plan.js";
import type { FromWorker, ToWorker } from "./worker-train.js";

/**
 * Why these tests matter: the GPU adapter is the page's only handle on a
 * worker that holds the graphics card. A cancel that leaves the worker
 * running keeps the card busy behind the creator's back, a lost device or
 * a crashed worker must end the stretch in words, and a run that ran out
 * of time must never be judged good.
 */

/** A worker the test drives by hand; it records what it was sent. */
class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((event: { readonly data: FromWorker }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: FromWorker): void {
    this.onmessage?.({ data });
  }
}

/** A timer the test fires by hand. */
function manualTimer() {
  let t = 0;
  const due: { fn: () => void; at: number; id: number }[] = [];
  let next = 1;
  return {
    now: () => t,
    set: (fn: () => void, ms: number) => {
      due.push({ fn, at: t + ms, id: next });
      return next++;
    },
    clear: (id: unknown) => {
      const i = due.findIndex((d) => d.id === id);
      if (i >= 0) due.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const d of [...due]) {
        if (d.at <= t) {
          due.splice(due.indexOf(d), 1);
          d.fn();
        }
      }
    },
    pending: () => due.length,
  };
}

async function request(): Promise<TrainRequest> {
  const rec = await buildSyntheticRecording();
  const read = await readSplatInputs(rec.file);
  if (read.kind !== "read") throw new Error(read.reason);
  const planned = windowPlanner()(read.inputs);
  const first = planned[0];
  if (first === undefined) throw new Error("no window");
  return {
    window: first,
    attempt: 1,
    timeScale: 1,
    inputs: read.inputs,
    recording: rec.file,
  };
}

function setup(over: { readPhotos?: () => Promise<Blob[]> } = {}) {
  const worker = new FakeWorker();
  const timer = manualTimer();
  const progress: TrainProgress[] = [];
  let reads: readonly string[] = [];
  const trainer = createGpuTrainer({
    gpu: null,
    readPhotos:
      over.readPhotos ??
      ((_rec, entries) => {
        reads = entries;
        return Promise.resolve(entries.map(() => new Blob(["jpg"])));
      }),
    spawn: () => worker,
    timer,
    cancelGraceMs: 1000,
  });
  const previews: unknown[] = [];
  const events = {
    onProgress: (p: TrainProgress) => progress.push(p),
    onPreview: (p: CanvasImageSource) => previews.push(p),
  };
  return {
    worker,
    timer,
    progress,
    previews,
    trainer,
    events,
    reads: () => reads,
  };
}

/** Lets the adapter reach the point where it has posted the job. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const finished = (over: Partial<WindowTrainResult> = {}): FromWorker => ({
  type: "result",
  result: {
    outcome: "finished",
    metrics: { atCameraDb: 31, heldOutDb: 22, photosUsed: 10 },
    trainingS: 12,
    ply: new Blob(["ply"]),
    ...over,
  },
});

describe("createGpuTrainer", () => {
  it("is the gpu kind and probes the given card", async () => {
    const { trainer } = setup();
    expect(trainer.kind).toBe("gpu");
    await expect(trainer.probe()).resolves.toEqual({
      kind: "no-webgpu",
      detail: "this browser has no WebGPU",
    });
  });

  // Why: the worker gets the window's photos in the job's order, its
  // progress reaches the page without a preview promise, and its result
  // comes back unchanged; the worker is ended after every window.
  it("trains a window in the worker and passes its result on", async () => {
    const s = setup();
    const req = await request();
    const run = s.trainer.trainWindow(
      req,
      s.events,
      new AbortController().signal,
    );
    await settle();
    const msg = s.worker.sent[0];
    if (msg?.type !== "train") throw new Error("no train message");
    expect(s.reads()).toEqual(msg.job.photos.map((p) => p.entry));
    expect(msg.photos).toHaveLength(msg.job.photos.length);
    s.worker.reply({
      type: "progress",
      progress: {
        stage: "training",
        fraction: 0.5,
        secondsLeft: 30,
        nextPreviewInS: 12,
      },
    });
    s.worker.reply(finished());
    const r = await run;
    expect(s.progress).toEqual([
      {
        stage: "loading",
        fraction: 0,
        secondsLeft: null,
        nextPreviewInS: null,
      },
      { stage: "training", fraction: 0.5, secondsLeft: 30, nextPreviewInS: 12 },
    ]);
    expect(r.outcome).toBe("finished");
    expect(r.metrics?.heldOutDb).toBe(22);
    expect(s.worker.terminated).toBe(true);
  });

  // Why: a cancel must reach the worker, and a worker that answers ends
  // the window as cancelled without its splat.
  it("asks the worker to stop on cancel and ends as cancelled", async () => {
    const s = setup();
    const ctrl = new AbortController();
    const run = s.trainer.trainWindow(await request(), s.events, ctrl.signal);
    await settle();
    ctrl.abort();
    expect(s.worker.sent.at(-1)).toEqual({ type: "cancel" });
    s.worker.reply(finished());
    const r = await run;
    expect(r).toMatchObject({ outcome: "cancelled", ply: null });
    expect(s.worker.terminated).toBe(true);
    expect(s.timer.pending()).toBe(0);
  });

  // Why: a worker stuck in a long GPU step may never answer; the page must
  // not wait on it, and ending it frees the card.
  it("ends a worker that does not answer a cancel in time", async () => {
    const s = setup();
    const ctrl = new AbortController();
    const run = s.trainer.trainWindow(await request(), s.events, ctrl.signal);
    await settle();
    ctrl.abort();
    s.timer.advance(999);
    expect(s.worker.terminated).toBe(false);
    s.timer.advance(1);
    const r = await run;
    expect(r.outcome).toBe("cancelled");
    expect(s.worker.terminated).toBe(true);
  });

  // Why: a stop before the photos are read must not start a worker.
  it("starts no worker when cancelled before it begins", async () => {
    const s = setup();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await s.trainer.trainWindow(
      await request(),
      s.events,
      ctrl.signal,
    );
    expect(r.outcome).toBe("cancelled");
    expect(s.worker.sent).toEqual([]);
  });

  // Why: a lost graphics card and a deadline come from the worker and
  // must reach the page as they are.
  it("passes a lost device and a deadline on", async () => {
    for (const outcome of ["gpu-lost", "deadline"] as const) {
      const s = setup();
      const run = s.trainer.trainWindow(
        await request(),
        s.events,
        new AbortController().signal,
      );
      await settle();
      s.worker.reply(finished({ outcome }));
      expect((await run).outcome).toBe(outcome);
    }
  });

  // Why: a refused library comes back from the worker as a failed result;
  // a worker that crashes outright must fail the window the same way.
  it("ends as failed when the library is refused or the worker crashes", async () => {
    const a = setup();
    const runA = a.trainer.trainWindow(
      await request(),
      a.events,
      new AbortController().signal,
    );
    await settle();
    a.worker.reply(finished({ outcome: "failed", metrics: null, ply: null }));
    expect((await runA).outcome).toBe("failed");

    const b = setup();
    const runB = b.trainer.trainWindow(
      await request(),
      b.events,
      new AbortController().signal,
    );
    await settle();
    b.worker.onerror?.(new Error("worker script failed"));
    const r = await runB;
    expect(r).toMatchObject({ outcome: "failed", ply: null });
    expect(b.worker.terminated).toBe(true);
  });

  // Why: photos that cannot be read fail the window before any worker.
  it("ends as failed when the photos cannot be read", async () => {
    const s = setup({ readPhotos: () => Promise.reject(new Error("bad zip")) });
    const r = await s.trainer.trainWindow(
      await request(),
      s.events,
      new AbortController().signal,
    );
    expect(r.outcome).toBe("failed");
    expect(s.worker.sent).toEqual([]);
  });
});

describe("judgeGpuRun", () => {
  const m = (heldOutDb: number | null) => ({
    atCameraDb: 30,
    heldOutDb,
    photosUsed: 10,
  });
  const run = (
    outcome: WindowTrainResult["outcome"],
    heldOutDb: number | null,
  ): WindowTrainResult => ({
    outcome,
    metrics: m(heldOutDb),
    trainingS: 1,
    ply: null,
  });

  // Why: the thresholds decide the creator's next step; a run out of time
  // must never read as good, and a lost card or a failure as anything but
  // poor.
  it("reads the held-out sharpness against the thresholds", () => {
    const t = TRAINER_DEFAULTS;
    expect(judgeGpuRun(run("finished", t.goodHeldOutDb), t).verdict).toBe(
      "good",
    );
    expect(judgeGpuRun(run("deadline", t.goodHeldOutDb + 5), t)).toMatchObject({
      verdict: "weak",
      reasons: ["ran out of time"],
    });
    expect(judgeGpuRun(run("finished", t.weakHeldOutDb), t).verdict).toBe(
      "weak",
    );
    expect(judgeGpuRun(run("finished", t.weakHeldOutDb - 0.1), t).verdict).toBe(
      "poor",
    );
    expect(judgeGpuRun(run("finished", null), t).verdict).toBe("weak");
    expect(judgeGpuRun(run("gpu-lost", 30), t).verdict).toBe("poor");
    expect(
      judgeGpuRun({ ...run("failed", null), metrics: null }, t).verdict,
    ).toBe("poor");
  });
});

describe("createGpuTrainer: stages and looks", () => {
  // Why: reading a stretch's photos from the zip comes before the worker;
  // the page hears "loading" at once, not after the photos are read.
  it("says it is loading before it reads the photos", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup({
      readPhotos: () => held.then(() => [] as Blob[]),
    });
    const run = s.trainer.trainWindow(
      await request(),
      s.events,
      new AbortController().signal,
    );
    await settle();
    expect(s.progress.map((p) => p.stage)).toEqual(["loading"]);
    release();
    await settle();
    s.worker.reply(finished());
    await run;
  });

  // Why: the worker's looks reach the page as they are; a look that comes
  // after the page stopped the stretch is closed, not shown, so its
  // pixels are freed.
  it("hands the worker's looks to the page, and closes a late one", async () => {
    const s = setup();
    const ctrl = new AbortController();
    const run = s.trainer.trainWindow(await request(), s.events, ctrl.signal);
    await settle();
    const look = { close: () => (look.closed = true), closed: false };
    s.worker.reply({ type: "preview", picture: look as never });
    expect(s.previews).toEqual([look]);
    ctrl.abort();
    const late = { close: () => (late.closed = true), closed: false };
    s.worker.reply({ type: "preview", picture: late as never });
    expect(s.previews).toEqual([look]);
    expect(late.closed).toBe(true);
    s.worker.reply(finished());
    await run;
  });
});
