/**
 * Why these tests matter: the film compiles its shaders ahead of the
 * first draw and waits for them to be ready. The page can free the scene
 * during that wait (AR starting, a lost context, a reduced-motion
 * remount); three.js's own wait then read the freed programs from its
 * timer and threw an uncaught TypeError, and its promise never settled.
 * This wait must stop asking once the scene is freed, settle anyway, and
 * never let a failing check escape.
 */
import { describe, expect, it, vi } from "vitest";

import { whenReady } from "./film-compile.js";

/** A timer that runs only when told to. */
function manualTimer() {
  const queued: (() => void)[] = [];
  return {
    later: vi.fn((cb: () => void) => {
      queued.push(cb);
    }),
    queued: () => queued.length,
    tick() {
      const next = queued.shift();
      next?.();
    },
  };
}

const settled = async (p: Promise<void>) => {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe("whenReady", () => {
  it("settles at once when everything is ready, with no timer", async () => {
    const timer = manualTimer();
    const p = whenReady({ ready: () => true, stopped: () => false, ...timer });
    expect(await settled(p)).toBe(true);
    expect(timer.later).not.toHaveBeenCalled();
  });

  it("asks again until ready", async () => {
    const timer = manualTimer();
    let n = 0;
    const p = whenReady({
      ready: () => ++n >= 3,
      stopped: () => false,
      ...timer,
    });
    expect(await settled(p)).toBe(false);
    timer.tick();
    expect(await settled(p)).toBe(false);
    timer.tick();
    expect(await settled(p)).toBe(true);
    expect(n).toBe(3);
  });

  it("stops asking once stopped, and settles", async () => {
    const timer = manualTimer();
    let stopped = false;
    const ready = vi.fn(() => false);
    const p = whenReady({ ready, stopped: () => stopped, ...timer });
    expect(ready).toHaveBeenCalledTimes(1);
    stopped = true;
    timer.tick();
    expect(await settled(p)).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(timer.queued()).toBe(0);
  });

  it("asks nothing when already stopped", async () => {
    const ready = vi.fn(() => false);
    const p = whenReady({ ready, stopped: () => true, later: vi.fn() });
    expect(await settled(p)).toBe(true);
    expect(ready).not.toHaveBeenCalled();
  });

  it("settles when a check throws (the first draw finishes the work)", async () => {
    const timer = manualTimer();
    const p = whenReady({
      ready: () => {
        throw new TypeError("freed");
      },
      stopped: () => false,
      ...timer,
    });
    expect(await settled(p)).toBe(true);
    expect(timer.queued()).toBe(0);
  });

  it("gives up after its last try", async () => {
    const timer = manualTimer();
    const ready = vi.fn(() => false);
    const p = whenReady({
      ready,
      stopped: () => false,
      ...timer,
      maxTries: 3,
    });
    timer.tick();
    timer.tick();
    expect(await settled(p)).toBe(true);
    expect(ready).toHaveBeenCalledTimes(3);
    expect(timer.queued()).toBe(0);
  });
});
