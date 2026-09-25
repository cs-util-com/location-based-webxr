import { describe, expect, it } from "vitest";

import { createParseQueue, QueueDrainedError } from "./parse-queue.js";

/** A task whose completion this test controls. */
function deferred(): {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("concurrency cap", () => {
  it("runs at most `concurrency` tasks at once", async () => {
    const queue = createParseQueue({ concurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const results = gates.map((gate, i) =>
      queue.run(() => {
        started.push(i);
        return gate.promise;
      }),
    );

    expect(started).toEqual([0, 1]); // the third waits — this is the anti-jank cap
    expect(queue.active).toBe(2);
    expect(queue.pending).toBe(1);

    gates[0]!.resolve("a");
    await results[0];
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve("b");
    gates[2]!.resolve("c");
    await Promise.all(results);
    expect(queue.active).toBe(0);
  });

  it("starts waiting tasks in FIFO order", async () => {
    const queue = createParseQueue({ concurrency: 1 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = gates.map((gate, i) =>
      queue.run(() => {
        started.push(i);
        return gate.promise;
      }),
    );

    gates[0]!.resolve("a");
    await results[0];
    gates[1]!.resolve("b");
    await results[1];
    gates[2]!.resolve("c");
    await results[2];
    expect(started).toEqual([0, 1, 2]);
  });
});

describe("results and failures", () => {
  it("resolves with the task's own value", async () => {
    const queue = createParseQueue({ concurrency: 2 });
    await expect(queue.run(() => Promise.resolve("parsed"))).resolves.toBe(
      "parsed",
    );
  });

  it("propagates a task rejection without stalling the queue", async () => {
    const queue = createParseQueue({ concurrency: 1 });
    await expect(
      queue.run(() => Promise.reject(new Error("corrupt glb"))),
    ).rejects.toThrow("corrupt glb");
    // A failed asset must not wedge the slot — the next knight still loads.
    await expect(queue.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(queue.active).toBe(0);
  });
});

describe("drain (teardown)", () => {
  it("rejects pending tasks and leaves running ones alone", async () => {
    const queue = createParseQueue({ concurrency: 1 });
    const running = deferred();
    const first = queue.run(() => running.promise);
    const queued = queue.run(() => Promise.resolve("never started"));

    queue.drain();
    await expect(queued).rejects.toBeInstanceOf(QueueDrainedError);
    expect(queue.pending).toBe(0);

    // The in-flight parse cannot be cancelled; the lifecycle's generation guard
    // is what makes its late result harmless.
    running.resolve("finished anyway");
    await expect(first).resolves.toBe("finished anyway");
  });

  it("is safe on an empty queue", () => {
    const queue = createParseQueue({ concurrency: 2 });
    expect(() => {
      queue.drain();
    }).not.toThrow();
  });
});
