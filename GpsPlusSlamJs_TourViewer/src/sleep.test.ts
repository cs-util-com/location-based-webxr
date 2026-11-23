import { afterEach, describe, expect, it, vi } from "vitest";

import { sleep } from "./sleep";

describe("sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Why: the worker spike's at-rest window and the photo gaps rest on it;
  // resolving early would shorten the baseline the verdict compares with.
  it("resolves only once the time has passed", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleep(500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});
