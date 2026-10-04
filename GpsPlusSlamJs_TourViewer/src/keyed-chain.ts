/**
 * Tasks run one after another PER KEY, in the order they were queued
 * (authoring plan 2026-09-28-0953, M4 review #7; M2c review #7).
 *
 * The draft writes a file per object, and nothing awaited them: a
 * placement's write could land AFTER the delete a quick tap issued a moment
 * later, and bring the deleted object back on the next open. Queued under
 * one key, the second task starts only once the first has settled, so the
 * writes to one key land in call order whatever each one costs.
 *
 * A task that fails or rejects does not break the chain behind it: its
 * caller gets its own rejection, and the next task runs as usual. A key
 * whose queue has drained is dropped, so the map holds only keys with
 * work in flight.
 *
 * @see keyed-chain.ts.md
 */

export interface KeyedChain {
  /**
   * Run `task` once every task queued earlier under `key` has settled.
   * Resolves or rejects with the task's own outcome.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** How many keys have a task queued or running. */
  pendingKeys(): number;
}

export function createKeyedChain(): KeyedChain {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(task);
      tails.set(key, next);
      // Forget the key once its last task settled, and only then: a task
      // queued meanwhile is the new tail and must stay.
      const forget = (): void => {
        if (tails.get(key) === next) tails.delete(key);
      };
      next.then(forget, forget);
      return next;
    },
    pendingKeys: () => tails.size,
  };
}
