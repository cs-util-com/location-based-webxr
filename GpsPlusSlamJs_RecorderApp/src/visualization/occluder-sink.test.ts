// @vitest-environment jsdom
/**
 * createOccluderSink — the shared live/replay persistent-occluder wiring.
 *
 * Why these tests matter (code-health plan step 5): this factory replaced two
 * structurally identical blocks in main.ts and replay-mode.ts that had drifted
 * once before (they had to be edited in lockstep). The tests pin the policy
 * BOTH sites now share — windowed vs unbounded snapshots, degrade-on-bad-pose,
 * debug-style application — and the new single-call teardown contract that
 * replaced the "null two module variables in every path" pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_RECORDING_OPTIONS } from '../state/recording-options';
import type { OccupancyOptions } from '../state/recording-options';
import { createOccluderSink } from './occluder-sink';

function makeOccupancy(overrides: Partial<OccupancyOptions>): OccupancyOptions {
  return { ...DEFAULT_RECORDING_OPTIONS.occupancy, ...overrides };
}

function makeDeps() {
  const mesh = {
    applyMeshData: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    setDebugStyle: vi.fn(),
  };
  const driver = { request: vi.fn() };
  const worker = { driver, dispose: vi.fn() };
  const createMesh = vi.fn(() => mesh);
  const createWorker = vi.fn(() => worker);
  return { mesh, driver, worker, createMesh, createWorker };
}

function makeGrid() {
  return {
    cellSizeM: 0.15,
    getOccupiedCellsFlat: vi.fn(() => new Int32Array([1, 2, 3])),
    getOccupiedCellsWithinFlat: vi.fn(() => new Int32Array([4, 5, 6])),
    getCellPoint: vi.fn(() => null),
  };
}

const PARENT = { name: 'ar-world-group' };

describe('createOccluderSink', () => {
  it('constructs the mesh under the given parent with the configured style knobs', () => {
    const d = makeDeps();
    createOccluderSink(
      PARENT as never,
      makeOccupancy({
        occluderMeshMode: 'corner-fit',
        occluderDebugStyle: 'matcap',
      }),
      {
        createMesh: d.createMesh as never,
        createWorker: d.createWorker,
      }
    );
    expect(d.createMesh).toHaveBeenCalledWith(PARENT, { mode: 'corner-fit' });
    expect(d.mesh.setDebugStyle).toHaveBeenCalledWith('matcap');
    expect(d.createWorker).toHaveBeenCalledTimes(1);
  });

  it('refresh uses the UNBOUNDED flat snapshot when the radius is 0', () => {
    const d = makeDeps();
    const grid = makeGrid();
    const { sink } = createOccluderSink(
      PARENT as never,
      makeOccupancy({ occluderRadiusM: 0 }),
      {
        createMesh: d.createMesh as never,
        createWorker: d.createWorker,
      }
    );
    sink.refresh(grid as never, { cameraPos: [1, 2, 3] } as never);
    expect(grid.getOccupiedCellsFlat).toHaveBeenCalled();
    expect(grid.getOccupiedCellsWithinFlat).not.toHaveBeenCalled();
  });

  it('refresh windows around a usable camera pose when a radius is set, and degrades to unbounded on a non-finite pose', () => {
    const d = makeDeps();
    const grid = makeGrid();
    const occupancy = makeOccupancy({ occluderRadiusM: 25, minConfidence: 4 });
    const { sink } = createOccluderSink(PARENT as never, occupancy, {
      createMesh: d.createMesh as never,
      createWorker: d.createWorker,
    });

    sink.refresh(grid as never, { cameraPos: [1, 2, 3] } as never);
    expect(grid.getOccupiedCellsWithinFlat).toHaveBeenCalledWith(
      [1, 2, 3],
      25,
      4
    );

    // A tracking-glitch pose must never blank the occluder — unbounded fallback.
    sink.refresh(grid as never, { cameraPos: [NaN, 2, 3] } as never);
    expect(grid.getOccupiedCellsFlat).toHaveBeenCalledWith(4);
    // No pose at all → unbounded too.
    sink.refresh(grid as never, undefined);
    expect(grid.getOccupiedCellsFlat).toHaveBeenCalledTimes(2);
  });

  it('applies delivered geometry to the mesh, and clear() clears it', () => {
    const d = makeDeps();
    const grid = makeGrid();
    const { sink } = createOccluderSink(PARENT as never, makeOccupancy({}), {
      createMesh: d.createMesh as never,
      createWorker: d.createWorker,
    });
    sink.refresh(grid as never, undefined);
    const onMesh = d.driver.request.mock.calls[0]![4] as (
      p: Float32Array,
      i: Uint32Array
    ) => void;
    const positions = new Float32Array([1]);
    const indices = new Uint32Array([0]);
    onMesh(positions, indices);
    expect(d.mesh.applyMeshData).toHaveBeenCalledWith(positions, indices);
    sink.clear();
    expect(d.mesh.clear).toHaveBeenCalledTimes(1);
  });

  it('dispose() releases worker + mesh once (idempotent) and turns the callbacks into no-ops', () => {
    const d = makeDeps();
    const grid = makeGrid();
    const handle = createOccluderSink(PARENT as never, makeOccupancy({}), {
      createMesh: d.createMesh as never,
      createWorker: d.createWorker,
    });
    // Capture a pre-dispose onMesh callback (an in-flight worker response).
    handle.sink.refresh(grid as never, undefined);
    const onMesh = d.driver.request.mock.calls[0]![4] as (
      p: Float32Array,
      i: Uint32Array
    ) => void;

    handle.dispose();
    handle.dispose(); // idempotent
    expect(d.worker.dispose).toHaveBeenCalledTimes(1);
    expect(d.mesh.dispose).toHaveBeenCalledTimes(1);

    // Post-dispose: refreshes don't reach the worker, late responses don't
    // resurrect the disposed mesh, clear() is a no-op.
    handle.sink.refresh(grid as never, undefined);
    expect(d.driver.request).toHaveBeenCalledTimes(1);
    onMesh(new Float32Array([1]), new Uint32Array([0]));
    expect(d.mesh.applyMeshData).not.toHaveBeenCalled();
    handle.sink.clear();
    expect(d.mesh.clear).not.toHaveBeenCalled();
  });
});
