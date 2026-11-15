/**
 * Why these tests matter: the optimizer's Worker runs the heavy part of a
 * job off the page, so a page that hangs on it (a lost answer, a dead
 * Worker) would show a file as being made smaller forever. The client
 * correlates answers by job, forwards progress, cancels on abort, turns a
 * crash into `OptimizerCrashed` for every run it held, and starts a fresh
 * Worker for the next run. The Worker is spawned only when a run needs it.
 */
import { describe, expect, it, vi } from "vitest";

import { OptimizerCrashed } from "./asset-optimizers.js";
import {
  createOptimizerHost,
  OPTIMIZER_SILENCE_MS,
  type OptimizerPage,
  type OptimizerWorker,
} from "./optimizer-client.js";
import type {
  OptimizerInbound,
  OptimizerOutbound,
} from "./optimizer-protocol.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";

interface FakeWorker extends OptimizerWorker {
  readonly posted: OptimizerInbound[];
  terminated: boolean;
  answer(message: OptimizerOutbound): void;
  crash(): void;
}

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.posted.push(message);
    },
    terminate() {
      worker.terminated = true;
    },
    answer(message) {
      worker.onmessage?.({ data: message } as MessageEvent);
    },
    crash() {
      worker.onerror?.(new Event("error"));
    },
  };
  return worker;
}

function control(signal = new AbortController().signal) {
  return { signal, progress: vi.fn() };
}

describe("the optimizer's Worker client", () => {
  it("spawns the Worker on the first run only, and answers each run by its job", async () => {
    const workers: FakeWorker[] = [];
    const host = createOptimizerHost(() => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    });
    expect(workers).toHaveLength(0);
    const a = control();
    const first = host.run("image", "a", OPTIMIZER_SETTINGS, a);
    const second = host.run("image", "b", OPTIMIZER_SETTINGS, control());
    expect(workers).toHaveLength(1);
    const [w] = workers;
    const jobs = w!.posted.map((m) => m.job);
    expect(new Set(jobs).size).toBe(2);
    w!.answer({ type: "progress", job: jobs[0]!, fraction: 0.4 });
    expect(a.progress).toHaveBeenCalledWith(0.4);
    const blob = new Blob(["s"]);
    w!.answer({ type: "kept", job: jobs[1]!, reason: "not smaller" });
    w!.answer({
      type: "done",
      job: jobs[0]!,
      blob,
      extension: "webp",
      width: 2,
      height: 1,
    });
    await expect(first).resolves.toEqual({
      kind: "optimized",
      blob,
      extension: "webp",
      width: 2,
      height: 1,
    });
    await expect(second).resolves.toEqual({
      kind: "kept",
      reason: "not smaller",
    });
  });

  it("rejects a failed run with the worker's words", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const run = host.run("audio", 1, OPTIMIZER_SETTINGS, control());
    w.answer({ type: "failed", job: w.posted[0]!.job, reason: "no codec" });
    await expect(run).rejects.toThrow("no codec");
  });

  // Why: the asset left the tour, or the tour closed - the Worker must stop
  // spending the phone's battery on it, and the page must not wait.
  it("cancels on abort: tells the worker and rejects with an AbortError", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const stop = new AbortController();
    const run = host.run("image", 1, OPTIMIZER_SETTINGS, control(stop.signal));
    stop.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(w.posted.at(-1)).toEqual({ type: "cancel", job: w.posted[0]!.job });
    const late = new AbortController();
    late.abort();
    await expect(
      host.run("image", 1, OPTIMIZER_SETTINGS, control(late.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("turns a crash into OptimizerCrashed for every run, then starts a fresh Worker", async () => {
    const workers: FakeWorker[] = [];
    const host = createOptimizerHost(() => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    });
    const a = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    const b = host.run("image", 2, OPTIMIZER_SETTINGS, control());
    workers[0]!.crash();
    await expect(a).rejects.toBeInstanceOf(OptimizerCrashed);
    await expect(b).rejects.toBeInstanceOf(OptimizerCrashed);
    expect(workers[0]!.terminated).toBe(true);
    const c = host.run("image", 3, OPTIMIZER_SETTINGS, control());
    expect(workers).toHaveLength(2);
    workers[1]!.answer({
      type: "kept",
      job: workers[1]!.posted[0]!.job,
      reason: "r",
    });
    await expect(c).resolves.toEqual({ kind: "kept", reason: "r" });
  });

  // Why: a Worker killed for running out of memory does not reliably fire
  // its error event in Chrome, so without a watchdog the run never
  // settles and its card shows "in progress" until the author stops it.
  // A Worker that sends nothing for OPTIMIZER_SILENCE_MS is treated as a
  // crash; one that keeps sending progress is never cut off, however long
  // its run.
  it("treats a Worker silent for OPTIMIZER_SILENCE_MS as crashed, and progress keeps it alive", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const host = createOptimizerHost(() => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      });
      const run = host.run("model", 1, OPTIMIZER_SETTINGS, control());
      const outcome = run.then(
        () => "settled",
        (err: unknown) => err,
      );
      const job = workers[0]!.posted[0]!.job;
      // a long run that reports progress is not cut off
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(OPTIMIZER_SILENCE_MS - 1);
        workers[0]!.answer({ type: "progress", job, fraction: i / 3 });
      }
      expect(workers[0]!.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(OPTIMIZER_SILENCE_MS);
      const err = await outcome;
      expect(err).toBeInstanceOf(OptimizerCrashed);
      expect((err as Error).message).toMatch(/stopped answering/);
      expect(workers[0]!.terminated).toBe(true);
      // the next run gets a fresh Worker, and a settled run leaves no
      // watchdog behind
      const next = host.run("image", 2, OPTIMIZER_SETTINGS, control());
      expect(workers).toHaveLength(2);
      workers[1]!.answer({
        type: "kept",
        job: workers[1]!.posted[0]!.job,
        reason: "r",
      });
      await expect(next).resolves.toEqual({ kind: "kept", reason: "r" });
      await vi.advanceTimersByTimeAsync(2 * OPTIMIZER_SILENCE_MS);
      expect(workers[1]!.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Why: a new run is no sign that the Worker lives. Were it to restart
  // the wait, a Worker that died without a word would be kept "alive" by
  // every file the author adds, and no card would ever leave "in progress".
  it("does not restart a silent Worker's wait for a new run", async () => {
    vi.useFakeTimers();
    try {
      const w = fakeWorker();
      const host = createOptimizerHost(() => w, null);
      const first = host
        .run("image", 1, OPTIMIZER_SETTINGS, control())
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(OPTIMIZER_SILENCE_MS - 10);
      const second = host
        .run("image", 2, OPTIMIZER_SETTINGS, control())
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(10);
      expect(await first).toBeInstanceOf(OptimizerCrashed);
      expect(await second).toBeInstanceOf(OptimizerCrashed);
      expect(w.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Why: a payload the browser cannot copy (a DataCloneError) throws from
  // postMessage. The run must reject with that error at once and leave no
  // pending run behind: a phantom one would never be answered, and the
  // watchdog would then kill a healthy Worker for it.
  it("rejects a run whose message cannot be posted, and keeps no phantom run", async () => {
    vi.useFakeTimers();
    try {
      const w = fakeWorker();
      let refuse = true;
      const post = w.postMessage.bind(w);
      w.postMessage = (message, transfer) => {
        if (refuse && message.type === "run") {
          throw new DOMException("cannot be cloned", "DataCloneError");
        }
        post(message, transfer);
      };
      const host = createOptimizerHost(() => w, null);
      await expect(
        host.run("image", 1, OPTIMIZER_SETTINGS, control()),
      ).rejects.toMatchObject({ name: "DataCloneError" });
      await vi.advanceTimersByTimeAsync(2 * OPTIMIZER_SILENCE_MS);
      expect(w.terminated).toBe(false);
      refuse = false;
      const next = host.run("image", 2, OPTIMIZER_SETTINGS, control());
      w.answer({ type: "kept", job: w.posted.at(-1)!.job, reason: "r" });
      await expect(next).resolves.toEqual({ kind: "kept", reason: "r" });
    } finally {
      vi.useRealTimers();
    }
  });

  // Why: a browser throttles and freezes a background tab's timers, and on
  // resume a timer that came due while frozen can fire before the Worker's
  // queued progress is read, killing a healthy run. The wait therefore
  // pauses while the page is hidden and starts afresh when it is shown.
  it("pauses the wait while the page is hidden and restarts it when shown", async () => {
    vi.useFakeTimers();
    try {
      class Page extends EventTarget implements OptimizerPage {
        visibilityState: DocumentVisibilityState = "visible";
      }
      const page = new Page();
      const w = fakeWorker();
      const host = createOptimizerHost(() => w, page);
      const run = host
        .run("model", 1, OPTIMIZER_SETTINGS, control())
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(OPTIMIZER_SILENCE_MS - 10);
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(3 * OPTIMIZER_SILENCE_MS);
      expect(w.terminated).toBe(false);
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(OPTIMIZER_SILENCE_MS - 10);
      expect(w.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(await run).toBeInstanceOf(OptimizerCrashed);
      expect(w.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close stops every run and the Worker; a spawn that throws rejects the run", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const run = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    host.close();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(w.terminated).toBe(true);
    const broken = createOptimizerHost(() => {
      throw new Error("no workers here");
    });
    await expect(
      broken.run("image", 1, OPTIMIZER_SETTINGS, control()),
    ).rejects.toThrow("no workers here");
  });

  it("ignores an answer for no run it holds, and one of no known shape", () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    void host.run("image", 1, OPTIMIZER_SETTINGS, control());
    expect(() => {
      w.answer({ type: "kept", job: 999, reason: "x" });
      w.onmessage?.({ data: null } as MessageEvent);
      w.onmessage?.({ data: { type: "nonsense", job: 1 } } as MessageEvent);
    }).not.toThrow();
  });

  // Why: the Worker is code the page does not trust field by field. A
  // smaller file whose extension the tour would refuse for the kind, or an
  // image size that is no positive whole number, would make every later
  // save fail; the run fails with words instead (Retry), and never hangs.
  it.each([
    ["an extension of another kind", { extension: "opus" }],
    ["an extension the tour does not take", { extension: "exe" }],
    ["no extension", { extension: 4 }],
    ["a width of 0", { extension: "webp", width: 0, height: 3 }],
    ["a fractional height", { extension: "webp", width: 2, height: 1.5 }],
    ["no blob", { extension: "webp", blob: "bytes" }],
  ])("rejects a smaller file with %s", async (_what, fields) => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const run = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    const job = w.posted[0]!.job;
    w.onmessage?.({
      data: { type: "done", job, blob: new Blob(["s"]), ...fields },
    } as MessageEvent);
    await expect(run).rejects.toThrow(
      "the optimizer answered with a file the tour cannot take",
    );
  });

  it("rejects a kept or failed answer without words", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const kept = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    const failed = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    const [a, b] = w.posted.map((m) => m.job);
    w.onmessage?.({ data: { type: "kept", job: a } } as MessageEvent);
    w.onmessage?.({
      data: { type: "failed", job: b, reason: 3 },
    } as MessageEvent);
    await expect(kept).rejects.toThrow("the optimizer answered with");
    await expect(failed).rejects.toThrow("the optimizer answered with");
  });

  it("takes an image size that is whole and positive, and an audio file of its kind", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const image = host.run("image", 1, OPTIMIZER_SETTINGS, control());
    const audio = host.run("audio", 1, OPTIMIZER_SETTINGS, control());
    const [a, b] = w.posted.map((m) => m.job);
    const blob = new Blob(["s"]);
    w.answer({
      type: "done",
      job: a!,
      blob,
      extension: "webp",
      width: 1600,
      height: 1200,
    });
    w.answer({ type: "done", job: b!, blob, extension: "opus" });
    await expect(image).resolves.toMatchObject({ width: 1600, height: 1200 });
    await expect(audio).resolves.toMatchObject({ extension: "opus" });
  });

  // Why: a model's report is what the shelf shows about its passes; it is
  // advisory, so one that does not read is dropped and the checked file
  // still lands (a run never fails on words about it).
  it("carries a model's report through, and drops one that does not read", async () => {
    const w = fakeWorker();
    const host = createOptimizerHost(() => w);
    const good = host.run("model", 1, OPTIMIZER_SETTINGS, control());
    const bad = host.run("model", 1, OPTIMIZER_SETTINGS, control());
    const badLod = host.run("model", 1, OPTIMIZER_SETTINGS, control());
    const [a, b, c] = w.posted.map((m) => m.job);
    const blob = new Blob(["s"]);
    const model = {
      textures: {
        changed: 1,
        kept: 0,
        bytesBefore: 9,
        bytesAfter: 4,
        largestSide: 8,
      },
      quantize: {
        positions: 1,
        normals: 0,
        tangents: 0,
        texcoords: 0,
        indices: 1,
        positionError: 0,
        normalErrorDeg: 0,
        texcoordError: 0,
      },
      lod: {
        skipped: null,
        primitives: 1,
        trianglesBefore: 9000,
        trianglesAfter: 3000,
        deviation: 0.002,
        size: 1.5,
        automatic: true,
        choices: [{ share: 1, triangles: 9000, deviation: 0 }],
      },
    };
    w.answer({ type: "done", job: a!, blob, extension: "glb", model });
    // a level-of-detail report whose slider stop does not read
    w.onmessage?.({
      data: {
        type: "done",
        job: c,
        blob,
        extension: "glb",
        model: {
          ...model,
          lod: { ...model.lod, choices: [{ share: 1, triangles: "many" }] },
        },
      },
    } as MessageEvent);
    w.onmessage?.({
      data: { type: "done", job: b, blob, extension: "glb", model: 3 },
    } as MessageEvent);
    await expect(good).resolves.toEqual({
      kind: "optimized",
      blob,
      extension: "glb",
      model,
    });
    await expect(bad).resolves.toEqual({
      kind: "optimized",
      blob,
      extension: "glb",
    });
    await expect(badLod).resolves.toEqual({
      kind: "optimized",
      blob,
      extension: "glb",
    });
  });
});
