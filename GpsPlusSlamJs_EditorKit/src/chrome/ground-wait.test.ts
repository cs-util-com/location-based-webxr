/**
 * Why these tests matter: "Put on the ground" on ground that has not
 * loaded yet must wait for it rather than put the item at a wrong height,
 * and must not wait forever: the creator is told when it gives up. A wait
 * the page called off (another selection, the 3D view closed) must write
 * nothing when the ground arrives later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GROUND_WAIT, waitForGround } from "./ground-wait.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("waitForGround", () => {
  it("answers at once with ground that has loaded", async () => {
    await expect(waitForGround(() => 512.5)).resolves.toEqual({
      kind: "ground",
      value: 512.5,
    });
  });

  it("waits for ground that loads later, reading it again every interval", async () => {
    let reads = 0;
    const waited = waitForGround(() => {
      reads += 1;
      return reads < 4 ? null : 500;
    });
    await vi.advanceTimersByTimeAsync(3 * GROUND_WAIT.everyMs);
    await expect(waited).resolves.toEqual({ kind: "ground", value: 500 });
    expect(reads).toBe(4);
  });

  it("gives up after its time, and says so", async () => {
    const waited = waitForGround(() => null, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000 + GROUND_WAIT.everyMs);
    await expect(waited).resolves.toEqual({ kind: "timeout" });
  });

  it("stops when called off, and reads no more", async () => {
    const stop = new AbortController();
    let reads = 0;
    const waited = waitForGround(
      () => {
        reads += 1;
        return null;
      },
      { signal: stop.signal },
    );
    stop.abort();
    await vi.advanceTimersByTimeAsync(5 * GROUND_WAIT.everyMs);
    await expect(waited).resolves.toEqual({ kind: "stopped" });
    expect(reads).toBe(1);
  });

  it("is stopped at once by a signal already called off", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      waitForGround(() => 1, { signal: stop.signal }),
    ).resolves.toEqual({ kind: "stopped" });
  });
});
