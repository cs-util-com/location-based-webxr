import { describe, expect, it, vi } from "vitest";

import { createPlaybackLoop } from "./playback-loop.js";

/** A controllable fake scheduler: `raf` queues callbacks, `advance` fires them. */
function createFakeScheduler() {
  let queued: ((t: number) => void) | null = null;
  let t = 0;
  return {
    raf: (cb: (t: number) => void) => {
      queued = cb;
    },
    now: () => t,
    /** Advance the clock by `ms` and run the queued frame, if any. */
    advance(ms: number): void {
      t += ms;
      const cb = queued;
      queued = null;
      cb?.(t);
    },
  };
}

describe("createPlaybackLoop", () => {
  it("is not playing initially", () => {
    const loop = createPlaybackLoop({
      length: 10,
      samplesPerSec: 10,
      onSeek: () => {},
    });
    expect(loop.isPlaying()).toBe(false);
  });

  it("play() advances the index once per elapsed sample interval", () => {
    const onSeek = vi.fn();
    const { raf, now, advance } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 5,
      samplesPerSec: 10, // 100ms per sample
      onSeek,
      raf,
      now,
    });

    loop.play();
    expect(onSeek).not.toHaveBeenCalled();

    advance(100);
    expect(onSeek).toHaveBeenCalledWith(1);

    advance(100);
    expect(onSeek).toHaveBeenCalledWith(2);
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  it("does not advance before a full sample interval has elapsed", () => {
    const onSeek = vi.fn();
    const { raf, now, advance } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 5,
      samplesPerSec: 10,
      onSeek,
      raf,
      now,
    });

    loop.play();
    advance(50); // half the interval
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("stops automatically at the end of the sequence", () => {
    const onSeek = vi.fn();
    const onPlayStateChange = vi.fn();
    const { raf, now, advance } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 2, // indices 0, 1
      samplesPerSec: 10,
      onSeek,
      onPlayStateChange,
      raf,
      now,
    });

    loop.play();
    advance(100); // -> index 1 (last)
    expect(onSeek).toHaveBeenCalledWith(1);
    expect(loop.isPlaying()).toBe(true);

    advance(100); // no more indices -> auto-stop, no further onSeek
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(loop.isPlaying()).toBe(false);
    expect(onPlayStateChange).toHaveBeenLastCalledWith(false);
  });

  it("restarts from 0 when play() is called after reaching the end", () => {
    const onSeek = vi.fn();
    const { raf, now, advance } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 2,
      samplesPerSec: 10,
      onSeek,
      raf,
      now,
    });

    loop.play();
    advance(100); // index 1, then auto-stops
    advance(100);
    expect(loop.isPlaying()).toBe(false);

    loop.play();
    advance(100);
    expect(onSeek).toHaveBeenLastCalledWith(1);
  });

  it("toggle() plays when stopped and stops when playing", () => {
    const onPlayStateChange = vi.fn();
    const { raf, now } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 5,
      samplesPerSec: 10,
      onSeek: () => {},
      onPlayStateChange,
      raf,
      now,
    });

    loop.toggle();
    expect(loop.isPlaying()).toBe(true);
    loop.toggle();
    expect(loop.isPlaying()).toBe(false);
  });

  it("seekTo() stops playback and fires onSeek once with the given index", () => {
    const onSeek = vi.fn();
    const { raf, now, advance } = createFakeScheduler();
    const loop = createPlaybackLoop({
      length: 10,
      samplesPerSec: 10,
      onSeek,
      raf,
      now,
    });

    loop.play();
    loop.seekTo(7);

    expect(loop.isPlaying()).toBe(false);
    expect(onSeek).toHaveBeenCalledWith(7);

    // Playback was stopped — a queued frame firing later must do nothing.
    advance(100);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });
});
