/**
 * Why these tests matter (authoring plan 2026-09-28-0953, M4 review #7):
 * the draft's writes to one object's files were fire-and-forget, so a
 * placement's slow write could land after the delete issued a moment
 * later and bring the object back on the next open. The chain is what
 * makes "call order" and "landing order" the same per key - so these pin
 * the order, that a failed task does not stall or reorder the rest, that
 * different keys do not wait for each other, and that drained keys go.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createKeyedChain } from "./keyed-chain.js";

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("createKeyedChain", () => {
  it("starts a key's second task only after its slow first task settled", async () => {
    const chain = createKeyedChain();
    const slow = deferred<string>();
    const log: string[] = [];
    const first = chain.run("k", async () => {
      log.push("first started");
      const value = await slow.promise;
      log.push("first landed");
      return value;
    });
    const second = chain.run("k", () => {
      log.push("second started");
      return Promise.resolve("b");
    });
    await flush();
    expect(log).toEqual(["first started"]);
    slow.resolve("a");
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(log).toEqual(["first started", "first landed", "second started"]);
  });

  it("hands a failure to its own caller and still runs the next task", async () => {
    const chain = createKeyedChain();
    const failed = chain.run("k", () => Promise.reject(new Error("quota")));
    const next = chain.run("k", () => Promise.resolve(2));
    await expect(failed).rejects.toThrow("quota");
    expect(await next).toBe(2);
  });

  it("does not make one key wait for another", async () => {
    const chain = createKeyedChain();
    const stuck = deferred<void>();
    void chain.run("a", () => stuck.promise);
    expect(await chain.run("b", () => Promise.resolve("free"))).toBe("free");
    stuck.resolve();
  });

  it("forgets a key once its queue has drained, and keeps one still in flight", async () => {
    const chain = createKeyedChain();
    const held = deferred<void>();
    void chain.run("held", () => held.promise);
    await chain.run("done", () => Promise.resolve());
    await flush();
    expect(chain.pendingKeys()).toBe(1);
    held.resolve();
    await flush();
    expect(chain.pendingKeys()).toBe(0);
  });

  it("lands every key's tasks in call order, whatever each one costs (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            key: fc.constantFrom("a", "b", "c"),
            ticks: fc.nat({ max: 5 }),
            fails: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        async (tasks) => {
          const chain = createKeyedChain();
          const landed: { key: string; index: number }[] = [];
          const runs = tasks.map((task, index) =>
            chain
              .run(task.key, async () => {
                for (let i = 0; i < task.ticks; i += 1) await Promise.resolve();
                landed.push({ key: task.key, index });
                if (task.fails) throw new Error("refused");
              })
              .catch(() => undefined),
          );
          await Promise.all(runs);
          for (const key of ["a", "b", "c"]) {
            const order = landed
              .filter((l) => l.key === key)
              .map((l) => l.index);
            expect(order).toEqual([...order].sort((x, y) => x - y));
          }
          expect(landed).toHaveLength(tasks.length);
          expect(chain.pendingKeys()).toBe(0);
        },
      ),
    );
  });
});
