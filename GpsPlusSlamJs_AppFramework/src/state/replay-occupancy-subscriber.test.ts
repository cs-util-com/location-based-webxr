/**
 * Tests for `subscribeReplayOccupancy` — the single-store replay occupancy
 * subscriber that folds a replayed depth-sample stream into a grid and drives
 * its visualizers on a throttle.
 *
 * Why this test matters:
 * This is the seam that makes "replay reconstructs the live mesh" work for a
 * fresh consumer (`startReplaySession`). It must (a) fold EVERY new sample into
 * the grid so no geometry is lost, but (b) coalesce the fast replay burst into a
 * throttled refresh so the cubes/mesh are not rebuilt on every action, always
 * ending with a trailing refresh so the final settled state is drawn. It must
 * also forward the newest head pose (for over-cap nearest-N cube selection) and
 * survive a throwing grid/refresh without breaking the store subscription.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeReplayOccupancy,
  type DepthSampleStore,
} from './replay-occupancy-subscriber';
import type { DepthSample } from '../types/ar-types';

/** A minimal store double exposing the recording slice + manual notification. */
function makeFakeStore(): DepthSampleStore & {
  push(sample: DepthSample): void;
} {
  let latest: DepthSample | null = null;
  const listeners = new Set<() => void>();
  return {
    getState() {
      return { recording: { latestDepthSample: latest } };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(sample: DepthSample) {
      latest = sample;
      for (const l of [...listeners]) l();
    },
  };
}

function makeSample(x: number): DepthSample {
  return {
    timestamp: x,
    cameraPos: [x, 0, 0],
    cameraRot: [0, 0, 0, 1],
    points: [],
  };
}

describe('subscribeReplayOccupancy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A deterministic clock so the throttle arithmetic is exact.
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('folds each new sample into the grid and refreshes on the leading edge', () => {
    const store = makeFakeStore();
    const grid = { addSample: vi.fn(() => 1), clear: vi.fn() };
    const onRefresh = vi.fn();
    subscribeReplayOccupancy({
      store,
      grid,
      onRefresh,
      refreshIntervalMs: 250,
    });

    store.push(makeSample(1));

    expect(grid.addSample).toHaveBeenCalledTimes(1);
    // Leading-edge refresh fires immediately, carrying the sample's head pose.
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenLastCalledWith({
      cameraPos: [1, 0, 0],
      cameraRot: [0, 0, 0, 1],
    });
  });

  it('coalesces a burst into ONE trailing refresh but folds every sample', () => {
    const store = makeFakeStore();
    const grid = { addSample: vi.fn(() => 1), clear: vi.fn() };
    const onRefresh = vi.fn();
    subscribeReplayOccupancy({
      store,
      grid,
      onRefresh,
      refreshIntervalMs: 250,
    });

    // Three samples within one interval: leading refresh on the first, the next
    // two schedule a single trailing refresh.
    store.push(makeSample(1)); // leading refresh
    store.push(makeSample(2));
    store.push(makeSample(3));

    expect(grid.addSample).toHaveBeenCalledTimes(3);
    expect(onRefresh).toHaveBeenCalledTimes(1); // leading only, so far

    vi.advanceTimersByTime(250);

    // Trailing refresh drew the final state with the NEWEST pose.
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenLastCalledWith({
      cameraPos: [3, 0, 0],
      cameraRot: [0, 0, 0, 1],
    });
  });

  it('folds a sample already present in the store on subscribe (seed)', () => {
    const store = makeFakeStore();
    store.push(makeSample(7)); // present before wiring
    const grid = { addSample: vi.fn(() => 1), clear: vi.fn() };
    const onRefresh = vi.fn();

    subscribeReplayOccupancy({
      store,
      grid,
      onRefresh,
      refreshIntervalMs: 250,
    });

    expect(grid.addSample).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stops folding and cancels a pending refresh after dispose', () => {
    const store = makeFakeStore();
    const grid = { addSample: vi.fn(() => 1), clear: vi.fn() };
    const onRefresh = vi.fn();
    const dispose = subscribeReplayOccupancy({
      store,
      grid,
      onRefresh,
      refreshIntervalMs: 250,
    });

    store.push(makeSample(1)); // leading refresh
    store.push(makeSample(2)); // schedules a trailing refresh
    dispose();
    vi.advanceTimersByTime(500);

    // The trailing refresh was cancelled; a post-dispose sample is ignored.
    expect(onRefresh).toHaveBeenCalledTimes(1);
    store.push(makeSample(3));
    expect(grid.addSample).toHaveBeenCalledTimes(2); // not 3
  });

  it('routes a throwing addSample to onError without breaking the subscription', () => {
    const store = makeFakeStore();
    const grid = {
      addSample: vi.fn((): number => {
        throw new Error('boom');
      }),
      clear: vi.fn(),
    };
    const onRefresh = vi.fn();
    const onError = vi.fn();
    subscribeReplayOccupancy({
      store,
      grid,
      onRefresh,
      onError,
      refreshIntervalMs: 250,
    });

    store.push(makeSample(1));

    expect(onError).toHaveBeenCalledTimes(1);
    // The failed sample did not refresh, but the subscription is still alive:
    // a later (working) grid call still folds.
    expect(onRefresh).not.toHaveBeenCalled();
    grid.addSample.mockImplementationOnce(() => 1);
    store.push(makeSample(2));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
