/**
 * Why these tests matter: `settle` replaces fixed waits across the unit
 * suites, so what it promises is what those tests may assume. A step the
 * fingerprint cannot see (a digest on the thread pool) is only covered by
 * the quiet window of wall clock, whatever the platform's timer tick; and a
 * state that never settles must be said by settle's own message, which a
 * bound above the test timeout would never let anyone read.
 *
 * Only `performance` is faked, so the clock moves when a test says so while
 * settle's windows turn for real: each claim is the order of "clock reached
 * the mark" and "settle finished", which no machine load can change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "./settle.js";

/** A running settle, with the reads of its fingerprint counted. */
function watch(state: () => unknown, quietMs?: number) {
  let reads = 0;
  let finished = false;
  const done = settle(
    () => {
      reads += 1;
      return [state()];
    },
    quietMs === undefined ? {} : { quietMs },
  ).finally(() => {
    finished = true;
  });
  // Marked as handled here; the test that expects a rejection still sees it.
  done.catch(() => undefined);
  return {
    done,
    isFinished: () => finished,
    /** Lets settle run this many more windows at the present clock. */
    async windows(count: number): Promise<void> {
      const target = reads + count;
      while (reads < target && !finished) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

describe("settle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits out the quiet window of wall clock even when nothing changes", async () => {
    const run = watch(() => 1, 60);
    await run.windows(4);
    vi.advanceTimersByTime(59);
    await run.windows(4);
    expect(run.isFinished()).toBe(false);

    vi.advanceTimersByTime(1);
    await run.done;
  });

  it("counts the quiet window from the last change", async () => {
    let value = 0;
    const run = watch(() => value, 40);
    await run.windows(4);
    vi.advanceTimersByTime(30);
    value = 1;
    await run.windows(4);
    vi.advanceTimersByTime(20);
    value = 2;
    await run.windows(4);

    // 59 ms after the first change, but only 39 after the last one.
    vi.advanceTimersByTime(39);
    await run.windows(4);
    expect(run.isFinished()).toBe(false);

    vi.advanceTimersByTime(1);
    await run.done;
  });

  it("says so when the state never stops changing, inside the default test timeout", async () => {
    let value = 0;
    const run = watch(() => (value += 1));
    await run.windows(2);
    vi.advanceTimersByTime(4000);
    await run.windows(4);
    expect(run.isFinished()).toBe(false);

    // The message's 4000 is the bound, under vitest's 5000 ms test timeout.
    vi.advanceTimersByTime(1);
    await expect(run.done).rejects.toThrow(/still changing after 4000 ms/);
  });
});
