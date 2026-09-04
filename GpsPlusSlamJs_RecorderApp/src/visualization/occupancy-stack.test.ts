/**
 * Why these tests matter: the live and replay scenes used to build this stack
 * in two copies whose parity was maintained by comment, and the numbers that
 * must agree (the carve floor, the cube noise floor, the camera-move epsilon,
 * the refresh throttle) are exactly the ones a copy silently loses. These pin
 * the mapping from the options group to the three constructors and the feed,
 * for both variants the two call sites use, and the teardown order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, mockWarn } = vi.hoisted(() => ({
  calls: [] as string[],
  mockWarn: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/ar/occupancy-grid', () => ({
  OccupancyGrid: vi.fn(function (this: { opts: unknown }, opts: unknown) {
    this.opts = opts;
  }),
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer',
  () => ({
    OccupancyCubesVisualizer: vi.fn(function (
      this: { parent: unknown; opts: unknown; dispose: () => void },
      parent: unknown,
      opts: unknown
    ) {
      this.parent = parent;
      this.opts = opts;
      this.dispose = vi.fn(() => {
        calls.push('cubes.dispose');
      });
    }),
  })
);
vi.mock('./occluder-sink', () => ({
  createOccluderSink: vi.fn(() => ({
    sink: { refresh: vi.fn(), clear: vi.fn() },
    dispose: vi.fn(() => {
      calls.push('occluder.dispose');
    }),
  })),
}));
vi.mock('./wire-occupancy-grid-subscribers', () => ({
  wireOccupancyGridSubscribers: vi.fn(() =>
    vi.fn(() => {
      calls.push('unsubscribe');
    })
  ),
}));
vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { OccupancyCubesVisualizer } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';
import { createOccluderSink } from './occluder-sink';
import { wireOccupancyGridSubscribers } from './wire-occupancy-grid-subscribers';
import { wireOccupancyStack, type OccupancyStackDeps } from './occupancy-stack';

const arWorldGroup = { name: 'arWorldGroup' } as unknown as never;
const storeRef = {
  get: () => null,
} as unknown as OccupancyStackDeps['storeRef'];

function occupancy(
  overrides: Partial<OccupancyStackDeps['occupancy']> = {}
): OccupancyStackDeps['occupancy'] {
  return {
    cellSizeM: 0.15,
    minConfidence: 3,
    persistentOcclusion: false,
    liveOcclusion: false,
    occluderDebugStyle: 'off',
    occluderMeshMode: 'smooth',
    occluderRadiusM: 0,
    ...overrides,
  };
}

function wirerOptions() {
  return vi.mocked(wireOccupancyGridSubscribers).mock.calls.at(-1)?.[0] as {
    grid: unknown;
    visualizer: { refresh: unknown; clear: unknown };
    occluder: unknown;
    refreshIntervalMs: number;
    refreshOnCameraMoveM: number | undefined;
    onError: (err: unknown) => void;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});

describe('wireOccupancyStack', () => {
  it('builds the grid at the carve floor and the cubes on arWorldGroup at the same noise floor', () => {
    const stack = wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy(),
      depthIntervalMs: 500,
      showCubes: true,
    });

    expect(OccupancyGrid).toHaveBeenCalledWith({
      cellSizeM: 0.15,
      carveConfidenceThreshold: 3,
    });
    expect(OccupancyCubesVisualizer).toHaveBeenCalledWith(arWorldGroup, {
      minObservations: 3,
    });
    const opts = wirerOptions();
    expect(opts.grid).toBe(stack.grid);
    expect(opts.visualizer).toBe(
      vi.mocked(OccupancyCubesVisualizer).mock.instances[0]
    );
    expect(opts.occluder).toBeUndefined();
    expect(opts.refreshIntervalMs).toBe(500);
    // Cubes are a camera-relative window: one chunk edge, 16 × 0.15 m.
    expect(opts.refreshOnCameraMoveM).toBeCloseTo(2.4, 10);
  });

  it('cubes OFF: no visualizer is allocated, the feed gets a no-op sink, and no epsilon without a window', () => {
    wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy(),
      depthIntervalMs: 1000,
      showCubes: false,
    });

    expect(OccupancyCubesVisualizer).not.toHaveBeenCalled();
    const opts = wirerOptions();
    expect(() => {
      (opts.visualizer.refresh as () => void)();
      (opts.visualizer.clear as () => void)();
    }).not.toThrow();
    expect(opts.refreshOnCameraMoveM).toBeUndefined();
  });

  it('a windowed occluder alone still sets the camera-move epsilon; an unbounded one does not', () => {
    wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy({ persistentOcclusion: true, occluderRadiusM: 25 }),
      depthIntervalMs: 1000,
      showCubes: false,
    });
    expect(createOccluderSink).toHaveBeenCalledWith(
      arWorldGroup,
      expect.objectContaining({ occluderRadiusM: 25 })
    );
    expect(wirerOptions().occluder).toBeDefined();
    expect(wirerOptions().refreshOnCameraMoveM).toBeCloseTo(2.4, 10);

    wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy({ persistentOcclusion: true, occluderRadiusM: 0 }),
      depthIntervalMs: 1000,
      showCubes: false,
    });
    expect(wirerOptions().refreshOnCameraMoveM).toBeUndefined();
  });

  it('appends the log context to a grid-update failure', () => {
    wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy(),
      depthIntervalMs: 1000,
      showCubes: true,
      logContext: 'during replay',
    });
    const err = new Error('boom');
    wirerOptions().onError(err);
    expect(mockWarn).toHaveBeenCalledWith(
      'Occupancy grid update failed during replay',
      err
    );
  });

  it('dispose stops the feed before releasing the cubes and the occluder it fed', () => {
    const stack = wireOccupancyStack({
      arWorldGroup,
      storeRef,
      occupancy: occupancy({ persistentOcclusion: true }),
      depthIntervalMs: 1000,
      showCubes: true,
    });
    stack.dispose();
    expect(calls).toEqual(['unsubscribe', 'cubes.dispose', 'occluder.dispose']);
  });
});
