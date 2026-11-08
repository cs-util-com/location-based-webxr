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
});
