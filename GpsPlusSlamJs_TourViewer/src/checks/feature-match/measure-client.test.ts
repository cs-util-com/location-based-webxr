import { describe, expect, it } from "vitest";

import {
  createMeasureClient,
  MeasureFailed,
  WorkerCrashed,
  type MeasureWorker,
} from "./measure-client";
import type { MeasureJob, MeasureRequest } from "./measure-protocol";

class FakeWorker implements MeasureWorker {
  sent: MeasureRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  postMessage(message: MeasureRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash(): void {
    this.onerror?.(new Event("error"));
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createMeasureClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers };
}

const job = (pair: string): MeasureJob => ({
  a: new Blob(["a"]),
  b: new Blob(["b"]),
  turn: null,
  methods: { sift: true, aliked: false, siftLightGlue: false },
  sizes: [640],
  pair,
});
const size = { width: 4, height: 2 };
const done = (jobId: number, measureMs = 7) => ({
  type: "done",
  job: jobId,
  results: [],
  frames: { a: size, b: size },
  settings: "runs: 1",
  measureMs,
});

// Why these tests matter: the queue hands pairs to one worker one at a
// time; a pair must never be dropped or replaced by the next, an answer
// for another job must not resolve the wrong pair, and a crashed worker
// must not leave the queue waiting for ever.
describe("createMeasureClient", () => {
  it("sends one pair at a time in order and forwards its progress", async () => {
    const { client, workers } = setup();
    const lines: string[] = [];
    const first = client.measure(job("1a"), (l) => lines.push(l));
    const second = client.measure(job("1b"));
    expect(workers).toHaveLength(1);
    const w = workers[0]!;
    expect(w.sent.map((r) => [r.type, r.job, r.pair])).toEqual([
      ["measure", 1, "1a"],
    ]);
    w.answer({ type: "progress", job: 1, line: "SIFT: loading" });
    w.answer(done(1, 11));
    await expect(first).resolves.toEqual({
      results: [],
      frames: { a: size, b: size },
      settings: "runs: 1",
      measureMs: 11,
    });
    expect(lines).toEqual(["SIFT: loading"]);
    expect(w.sent.map((r) => r.pair)).toEqual(["1a", "1b"]);
    w.answer(done(2));
    await expect(second).resolves.toMatchObject({ measureMs: 7 });
  });

  it("ignores malformed answers and answers for another job", async () => {
    const { client, workers } = setup();
    const p = client.measure(job("1a"));
    const w = workers[0]!;
    w.answer({ type: "done", job: 1 });
    w.answer(done(9));
    w.answer("noise");
    w.answer(done(1, 3));
    await expect(p).resolves.toMatchObject({ measureMs: 3 });
  });

  it("rejects a failed pair and goes on with the next", async () => {
    const { client, workers } = setup();
    const p = client.measure(job("1a"));
    const q = client.measure(job("1b"));
    const w = workers[0]!;
    w.answer({ type: "failed", job: 1, message: "A: cannot decode" });
    await expect(p).rejects.toThrow(MeasureFailed);
    w.answer(done(2));
    await expect(q).resolves.toMatchObject({ measureMs: 7 });
  });

  it("rejects every held pair on a crash and spawns a fresh worker after", async () => {
    const { client, workers } = setup();
    const p = client.measure(job("1a"));
    const q = client.measure(job("1b"));
    workers[0]!.crash();
    await expect(p).rejects.toThrow(WorkerCrashed);
    await expect(q).rejects.toThrow(WorkerCrashed);
    expect(workers[0]!.terminated).toBe(true);
    const r = client.measure(job("1c"));
    expect(workers).toHaveLength(2);
    // Job ids go on counting: the pair that only waited was never sent.
    expect(workers[1]!.sent.map((s) => s.job)).toEqual([2]);
    workers[1]!.answer(done(2));
    await expect(r).resolves.toMatchObject({ measureMs: 7 });
  });

  it("rejects a pair when the worker cannot be spawned, and the next tries again", async () => {
    let fail = true;
    const workers: FakeWorker[] = [];
    const client = createMeasureClient(() => {
      if (fail) {
        throw new Error("no workers here");
      }
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    await expect(client.measure(job("1a"))).rejects.toThrow("no workers here");
    fail = false;
    const p = client.measure(job("1b"));
    workers[0]!.answer(done(1));
    await expect(p).resolves.toMatchObject({ measureMs: 7 });
  });

  it("rejects the held pairs and ends the worker on close", async () => {
    const { client, workers } = setup();
    const p = client.measure(job("1a"));
    client.close();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(true);
  });
});
