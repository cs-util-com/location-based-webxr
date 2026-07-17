/**
 * @vitest-environment jsdom
 *
 * Tests for `wireOccupancyGridSubscribers` (2026-06-11 occupancy-grid
 * port plan, Iter 4).
 *
 * Why this test matters:
 * The occupancy grid is derived state fed from the persisted
 * `recording/recordDepthSample` action stream via the framework's
 * `latestDepthSample` observation hook. The wiring must fold every new
 * sample exactly once, throttle visualizer refreshes to ~1 Hz (replay
 * dispatches much faster), clear grid + visualizer on store swap
 * (Start Recording / Replay), and never let a grid/visualizer failure
 * break the store subscription.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { createRecorderStore } from '../state/recorder-store';
import {
  recordDepthSample,
  recordWriteFailure,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';
import { createStoreRef } from '../state/store-ref';
import {
  wireOccupancyGridSubscribers,
  type OccupancyGridSink,
} from './wire-occupancy-grid-subscribers';
import type { ViewerPose } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';

function makeSample(
  timestamp = 1000,
  cameraPos: DepthSample['cameraPos'] = [0, 0, 0],
  cameraRot: DepthSample['cameraRot'] = [0, 0, 0, 1]
): DepthSample {
  return {
    timestamp,
    cameraPos,
    cameraRot,
    points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
  };
}

function makeGridSpy() {
  return {
    addSample: vi.fn<(sample: DepthSample) => number>(() => 1),
    clear: vi.fn<() => void>(),
  };
}

function makeVisualizerSpy() {
  return {
    refresh:
      vi.fn<(grid: OccupancyGridSink, viewerPose?: ViewerPose) => void>(),
    clear: vi.fn<() => void>(),
  };
}

function makeOccluderSpy() {
  return {
    refresh: vi.fn<(grid: OccupancyGridSink) => void>(),
    clear: vi.fn<() => void>(),
  };
}

/** A grid spy exposing a controllable `getRevision` (settled-scene skip). */
function makeRevisionGridSpy(initial = 0) {
  let revision = initial;
  return {
    addSample: vi.fn<(sample: DepthSample) => number>(() => 1),
    clear: vi.fn<() => void>(),
    getRevision: vi.fn<() => number>(() => revision),
    setRevision(r: number) {
      revision = r;
    },
  };
}

function makeStore() {
  return createRecorderStore({ storageBackend: new NullStorageBackend() });
}

describe('wireOccupancyGridSubscribers', () => {
  let storeRef: ReturnType<typeof createStoreRef<ReturnType<typeof makeStore>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    storeRef = createStoreRef(makeStore());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('folds each dispatched depth sample into the grid exactly once', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
    });

    const sample = makeSample();
    storeRef.get().dispatch(recordDepthSample(sample));
    expect(grid.addSample).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledWith(sample);

    // Unrelated dispatches (same latestDepthSample reference) add nothing
    storeRef.get().dispatch(recordWriteFailure('disk full'));
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('seeds a sample that was dispatched before wiring', () => {
    const grid = makeGridSpy();
    const sample = makeSample();
    storeRef.get().dispatch(recordDepthSample(sample));

    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: makeVisualizerSpy(),
    });
    expect(grid.addSample).toHaveBeenCalledWith(sample);
    dispose();
  });

  it('throttles visualizer refreshes: leading edge + one trailing refresh per burst', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      refreshIntervalMs: 1000,
    });

    // First sample: immediate (leading-edge) refresh with the grid and the
    // sample's head pose (Issue B1 — forwarded for viewer-local selection).
    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(visualizer.refresh).toHaveBeenCalledWith(grid, {
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
    });

    // Burst within the interval: no synchronous refresh...
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    storeRef.get().dispatch(recordDepthSample(makeSample(3)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledTimes(3); // samples are never throttled

    // ...but exactly one trailing refresh when the interval elapses
    vi.advanceTimersByTime(1000);
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);

    // Quiet period over: next sample refreshes immediately again
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(4)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(3);

    dispose();
  });

  it('skips the cube/occluder refresh while the grid revision is unchanged (settled scene)', () => {
    // Why this matters: a long session re-observes already-mapped surfaces for
    // minutes. When the occupied set can no longer change, the O(cells) cube
    // re-build + occluder re-mesh are pure waste — the wirer must skip them.
    const grid = makeRevisionGridSpy(0);
    const visualizer = makeVisualizerSpy();
    const occluder = makeOccluderSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      occluder,
      refreshIntervalMs: 1000,
    });

    // First sample bumps the revision → leading-edge refresh of both sinks.
    grid.setRevision(1);
    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(occluder.refresh).toHaveBeenCalledTimes(1);

    // A later sample that does NOT change the revision (settled re-observation):
    // the sample is still folded in, but neither sink re-derives.
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    expect(grid.addSample).toHaveBeenCalledTimes(2);
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(occluder.refresh).toHaveBeenCalledTimes(1);

    // Once the revision changes again, refreshes resume.
    grid.setRevision(2);
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(3)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);
    expect(occluder.refresh).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('re-refreshes a SETTLED grid when the camera moves beyond the epsilon (Step 2 revision-guard fix)', () => {
    // Why this matters (2026-07-03 fps plan, Step 2 ⚠ revision-guard
    // interaction): with camera-relative windows, the correct visible set
    // changes when the CAMERA moves even if the grid didn't. Without this
    // condition, walking back into settled geometry never re-windows — the
    // occluder/cubes freeze on the old neighbourhood.
    const grid = makeRevisionGridSpy(0);
    const visualizer = makeVisualizerSpy();
    const occluder = makeOccluderSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      occluder,
      refreshIntervalMs: 1000,
      refreshOnCameraMoveM: 2.4,
    });

    grid.setRevision(1);
    storeRef.get().dispatch(recordDepthSample(makeSample(1, [0, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(occluder.refresh).toHaveBeenCalledTimes(1);

    // Settled grid + small drift (1 m < ε): skip stays in force.
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(2, [1, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(occluder.refresh).toHaveBeenCalledTimes(1);

    // Settled grid + camera moved 5 m from the LAST RENDERED position
    // (> 2.4 m ε): both sinks must re-derive their windows.
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(3, [5, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);
    expect(occluder.refresh).toHaveBeenCalledTimes(2);

    // The re-render recorded the new pose: staying put skips again.
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(4, [5.5, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('without refreshOnCameraMoveM the legacy guard skips on unchanged revision regardless of movement', () => {
    // Why: unbounded consumers (radius 0 / older callers) produce identical
    // output wherever the camera is — ε-refreshes would be pure waste, so
    // the movement condition is strictly opt-in.
    const grid = makeRevisionGridSpy(0);
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      refreshIntervalMs: 1000,
    });

    grid.setRevision(1);
    storeRef.get().dispatch(recordDepthSample(makeSample(1, [0, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(2, [100, 0, 0])));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('forwards the viewer pose to the occluder sink (windowed occluder snapshots need it)', () => {
    const grid = makeGridSpy();
    const occluder = makeOccluderSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: makeVisualizerSpy(),
      occluder,
    });

    const sample = makeSample(1, [3, 2, 1], [0, 0, 0, 1]);
    storeRef.get().dispatch(recordDepthSample(sample));
    expect(occluder.refresh).toHaveBeenCalledWith(grid, {
      cameraPos: [3, 2, 1],
      cameraRot: [0, 0, 0, 1],
    });

    dispose();
  });

  it('retries a same-revision refresh after a transient sink failure (does not get stuck)', () => {
    // Why this matters: `lastRenderedRevision` must not advance until the sinks
    // actually succeed. If a refresh throws once while the revision was already
    // marked rendered, every later same-revision sample (a settled scene) would
    // short-circuit at the revision guard forever — a transient render failure
    // becomes permanently sticky until the occupied set changes again.
    const grid = makeRevisionGridSpy(0);
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
      refreshIntervalMs: 1000,
    });

    // Leading-edge refresh throws once (transient render failure).
    visualizer.refresh.mockImplementationOnce(() => {
      throw new Error('render boom');
    });
    grid.setRevision(1);
    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Same revision, next sample after the throttle interval: the failed render
    // MUST be retried (was: stuck at 1 call because the revision had already
    // been marked rendered before the sink threw).
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('forwards the freshest sample pose to the trailing refresh of a burst (Issue B1)', () => {
    // Why this matters: the wirer must remember the LAST sample's pose even
    // while refreshes are throttled, so the single trailing refresh ranks
    // cells against where the camera actually ended up — not the first
    // sample of the burst.
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      refreshIntervalMs: 1000,
    });

    // Leading-edge refresh uses the first sample's pose.
    storeRef.get().dispatch(recordDepthSample(makeSample(1, [1, 0, 0])));
    expect(visualizer.refresh).toHaveBeenLastCalledWith(grid, {
      cameraPos: [1, 0, 0],
      cameraRot: [0, 0, 0, 1],
    });

    // Burst within the interval: poses keep updating, refresh is deferred.
    storeRef.get().dispatch(recordDepthSample(makeSample(2, [2, 0, 0])));
    storeRef.get().dispatch(recordDepthSample(makeSample(3, [9, 9, 9])));

    // The trailing refresh fires with the LAST burst sample's pose.
    vi.advanceTimersByTime(1000);
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);
    expect(visualizer.refresh).toHaveBeenLastCalledWith(grid, {
      cameraPos: [9, 9, 9],
      cameraRot: [0, 0, 0, 1],
    });

    dispose();
  });

  it('does not leak the old store pose into the new store after a swap (Issue B1)', () => {
    // Why this matters: the old recording's head pose is meaningless for the
    // new store. The swap resets the remembered pose to null (defensive — a
    // refresh is always preceded by a sample that overwrites it), and the
    // first refresh on the new store must carry that store's OWN sample pose,
    // never the stale one.
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1, [5, 5, 5])));
    expect(visualizer.refresh).toHaveBeenLastCalledWith(grid, {
      cameraPos: [5, 5, 5],
      cameraRot: [0, 0, 0, 1],
    });

    const newStore = makeStore();
    storeRef.set(newStore);
    visualizer.refresh.mockClear();

    newStore.dispatch(recordDepthSample(makeSample(2, [7, 8, 9])));
    expect(visualizer.refresh).toHaveBeenLastCalledWith(grid, {
      cameraPos: [7, 8, 9],
      cameraRot: [0, 0, 0, 1],
    });

    dispose();
  });

  it('clears grid and visualizer on store swap and re-attaches to the new store', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    const newStore = makeStore();
    storeRef.set(newStore);
    expect(grid.clear).toHaveBeenCalledTimes(1);
    expect(visualizer.clear).toHaveBeenCalledTimes(1);

    // Old store no longer feeds the grid…
    storeRef.get(); // (newStore)
    newStore.dispatch(recordDepthSample(makeSample(2)));
    expect(grid.addSample).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('still clears the visualizer when grid.clear() throws on swap', () => {
    // Why this matters: grid and visualizer clears are independent
    // best-effort. A throwing grid.clear() must not skip visualizer.clear(),
    // otherwise the cube view keeps rendering the now-stale grid after a swap.
    const grid = makeGridSpy();
    grid.clear.mockImplementationOnce(() => {
      throw new Error('clear boom');
    });
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.set(makeStore());
    expect(grid.clear).toHaveBeenCalledTimes(1);
    expect(visualizer.clear).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('stops processing after dispose', () => {
    const grid = makeGridSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: makeVisualizerSpy(),
    });
    dispose();

    storeRef.get().dispatch(recordDepthSample(makeSample()));
    expect(grid.addSample).not.toHaveBeenCalled();
  });

  it('reports grid failures via onError and keeps the subscription alive', () => {
    const grid = makeGridSpy();
    grid.addSample.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(visualizer.refresh).not.toHaveBeenCalled(); // failed sample → no refresh

    // Next sample still flows
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    expect(grid.addSample).toHaveBeenCalledTimes(2);
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('survives a THROWING onError callback — the error handler itself must not break the subscription', () => {
    // Why this test matters: the wirer's documented contract is that a failure
    // "can never break the AR session or the store subscription", but onError
    // is caller-supplied — an unguarded throw from it escaped the catch blocks
    // straight into the store's dispatch path.
    const grid = makeGridSpy();
    grid.addSample.mockImplementation(() => {
      throw new Error('grid boom');
    });
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn(() => {
      throw new Error('broken error handler');
    });
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    expect(() =>
      storeRef.get().dispatch(recordDepthSample(makeSample(1)))
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);

    // The subscription is still alive: the next sample reaches the grid.
    expect(() =>
      storeRef.get().dispatch(recordDepthSample(makeSample(2)))
    ).not.toThrow();
    expect(grid.addSample).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('reports visualizer refresh failures via onError without breaking sample flow', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    visualizer.refresh.mockImplementation(() => {
      throw new Error('render boom');
    });
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    dispose();
  });

  describe('optional occluder (occupancy.persistentOcclusion)', () => {
    it('refreshes the occluder on the same throttle as the visualizer', () => {
      const grid = makeGridSpy();
      const visualizer = makeVisualizerSpy();
      const occluder = makeOccluderSpy();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid,
        visualizer,
        occluder,
        refreshIntervalMs: 1000,
      });

      // Leading-edge refresh hits both sinks with the live grid (plus the
      // sample's viewer pose since the Step-2 windowed-occluder change).
      storeRef.get().dispatch(recordDepthSample(makeSample(1)));
      expect(visualizer.refresh).toHaveBeenCalledTimes(1);
      expect(occluder.refresh).toHaveBeenCalledTimes(1);
      expect(occluder.refresh.mock.calls[0]?.[0]).toBe(grid);

      // Burst coalesces to a single trailing refresh on BOTH sinks.
      storeRef.get().dispatch(recordDepthSample(makeSample(2)));
      expect(occluder.refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(occluder.refresh).toHaveBeenCalledTimes(2);

      dispose();
    });

    it('clears the occluder on store swap', () => {
      const grid = makeGridSpy();
      const occluder = makeOccluderSpy();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid,
        visualizer: makeVisualizerSpy(),
        occluder,
      });

      storeRef.set(makeStore());
      expect(occluder.clear).toHaveBeenCalledTimes(1);

      dispose();
    });

    it('reports an occluder failure via onError without breaking the visualizer', () => {
      const grid = makeGridSpy();
      const visualizer = makeVisualizerSpy();
      const occluder = makeOccluderSpy();
      occluder.refresh.mockImplementation(() => {
        throw new Error('mesh boom');
      });
      const onError = vi.fn();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid,
        visualizer,
        occluder,
        onError,
      });

      storeRef.get().dispatch(recordDepthSample(makeSample(1)));
      // Occluder threw, but the visualizer still refreshed and the error surfaced.
      expect(onError).toHaveBeenCalledTimes(1);
      expect(visualizer.refresh).toHaveBeenCalledTimes(1);

      dispose();
    });
  });

  describe('grid-size telemetry (Step 0 of the 2026-07-03 long-session fps plan)', () => {
    // Why these tests matter: the ~30 s cells-over-time log line is the
    // offline half of the fps attribution — it correlates grid growth with
    // the stats overlay's fps trend from a single log export. It must be
    // throttled (a per-sample log would spam a 2 Hz stream) and must never
    // break the wiring.

    /** Grid spy with a mutable `size` (mirrors `OccupancyGrid.size`). */
    function makeSizedGridSpy() {
      const spy = {
        addSample: vi.fn<(sample: DepthSample) => number>(() => 1),
        clear: vi.fn<() => void>(),
        size: 0,
      };
      return spy;
    }

    it('reports grid.size with the first sample, then at most once per interval', () => {
      const grid = makeSizedGridSpy();
      const onGridSize = vi.fn();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid,
        visualizer: makeVisualizerSpy(),
        onGridSize,
      });

      grid.size = 10;
      storeRef.get().dispatch(recordDepthSample(makeSample(1)));
      expect(onGridSize).toHaveBeenCalledTimes(1);
      expect(onGridSize).toHaveBeenLastCalledWith(10);

      // Samples within the 30 s window do not re-report.
      vi.advanceTimersByTime(10_000);
      grid.size = 500;
      storeRef.get().dispatch(recordDepthSample(makeSample(2)));
      expect(onGridSize).toHaveBeenCalledTimes(1);

      // Crossing the window reports the CURRENT size.
      vi.advanceTimersByTime(21_000);
      grid.size = 1234;
      storeRef.get().dispatch(recordDepthSample(makeSample(3)));
      expect(onGridSize).toHaveBeenCalledTimes(2);
      expect(onGridSize).toHaveBeenLastCalledWith(1234);

      dispose();
    });

    it('does not report for grids without a size, and a throwing callback surfaces via onError without breaking folding', () => {
      const plainGrid = makeGridSpy(); // no `size` property
      const onGridSize = vi.fn();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid: plainGrid,
        visualizer: makeVisualizerSpy(),
        onGridSize,
      });
      storeRef.get().dispatch(recordDepthSample(makeSample(1)));
      expect(onGridSize).not.toHaveBeenCalled();
      dispose();

      const grid = makeSizedGridSpy();
      const onError = vi.fn();
      const throwing = vi.fn(() => {
        throw new Error('telemetry boom');
      });
      // Fresh store: the previous wirer's sample survives in the old store and
      // would be re-seeded on attach, skewing the addSample count.
      const freshRef = createStoreRef(makeStore());
      const dispose2 = wireOccupancyGridSubscribers({
        storeRef: freshRef,
        grid,
        visualizer: makeVisualizerSpy(),
        onGridSize: throwing,
        onError,
      });
      freshRef.get().dispatch(recordDepthSample(makeSample(2)));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(grid.addSample).toHaveBeenCalledTimes(1);
      dispose2();
    });

    it('restarts the telemetry cadence on store swap (new session logs from t0)', () => {
      const grid = makeSizedGridSpy();
      const onGridSize = vi.fn();
      const dispose = wireOccupancyGridSubscribers({
        storeRef,
        grid,
        visualizer: makeVisualizerSpy(),
        onGridSize,
      });

      grid.size = 42;
      storeRef.get().dispatch(recordDepthSample(makeSample(1)));
      expect(onGridSize).toHaveBeenCalledTimes(1);

      // Swap the store (Start Recording / Replay) shortly after: the fresh
      // session's first sample must report immediately, not wait out the
      // previous session's window.
      vi.advanceTimersByTime(1_000);
      storeRef.set(makeStore());
      grid.size = 3;
      storeRef.get().dispatch(recordDepthSample(makeSample(2)));
      expect(onGridSize).toHaveBeenCalledTimes(2);
      expect(onGridSize).toHaveBeenLastCalledWith(3);

      dispose();
    });
  });
});
