/**
 * occluder-mesh-worker-client — the app-side glue that backs the driver with a
 * real Worker. Tested via an injectable worker factory: a throwing factory must
 * degrade to synchronous meshing (occluder still works), and a fake worker must
 * be driven (post → respond → callback) and terminated on dispose.
 */

import { describe, it, expect, vi } from 'vitest';
import { createOccluderMeshWorker } from './occluder-mesh-worker-client';
import { meshOccupiedCells } from '../ar/occupancy-mesher';
import {
  runMeshRequest,
  type MeshWorkerRequest,
} from '../ar/occlusion-mesh-worker';
import type { GridCell } from '../ar/bresenham3d';
import { clearLogBuffer, getLogBuffer } from '../utils/logger';

const CELL = 0.15;
const CELLS: GridCell[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 0, 1],
  [1, 0, 1],
];

describe('createOccluderMeshWorker', () => {
  it('falls back to synchronous meshing when the worker cannot be created', () => {
    const { driver, dispose } = createOccluderMeshWorker(() => {
      throw new Error('no worker in this env');
    });
    let indices: Uint32Array | null = null;
    driver.request(CELLS, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(CELLS, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    dispose();
  });

  it('drives a real-ish worker: posts a request, applies the response, terminates on dispose', () => {
    const posted: MeshWorkerRequest[] = [];
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      postMessage: (message: MeshWorkerRequest): void => {
        posted.push(message);
      },
      terminate: vi.fn(),
    };
    const { driver, dispose } = createOccluderMeshWorker(
      () => fakeWorker as unknown as Worker
    );

    let done = 0;
    driver.request(CELLS, CELL, 'greedy', undefined, () => {
      done++;
    });
    expect(posted).toHaveLength(1);
    expect(done).toBe(0); // async — nothing delivered until the worker responds

    // Simulate the worker computing + posting back.
    const { response } = runMeshRequest(posted[0]!);
    fakeWorker.onmessage?.({ data: response });
    expect(done).toBe(1);

    dispose();
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('logs mesh duration + cell count per completed job (the freshness numbers the Phase-2 gate field walk reads)', () => {
    clearLogBuffer();
    const posted: MeshWorkerRequest[] = [];
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      postMessage: (message: MeshWorkerRequest): void => {
        posted.push(message);
      },
      terminate: vi.fn(),
    };
    const { driver, dispose } = createOccluderMeshWorker(
      () => fakeWorker as unknown as Worker
    );

    driver.request(CELLS, CELL, 'greedy', undefined, () => {});
    const { response } = runMeshRequest(posted[0]!);
    fakeWorker.onmessage?.({ data: response });

    const entries = getLogBuffer().filter(
      (e) => e.tag === 'OccluderMeshWorker' && e.message.includes('cells')
    );
    expect(entries).toHaveLength(1);
    // The log line must carry the numbers the field checklist needs: input
    // size, mesh mode, and the wall-clock duration.
    expect(entries[0]!.message).toMatch(/4 cells/);
    expect(entries[0]!.message).toMatch(/greedy/);
    expect(entries[0]!.message).toMatch(/\d+ ms/);
    dispose();
  });

  it('recovers to synchronous meshing when the worker errors before ever meshing (module load failure)', () => {
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onmessageerror: null as ((event: unknown) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const { driver, dispose } = createOccluderMeshWorker(
      () => fakeWorker as unknown as Worker
    );

    // First job goes to the worker; the worker's module then fails to load →
    // onerror before any successful mesh.
    driver.request(CELLS, CELL, 'per-face', undefined, () => {});
    // The client's `worker.onerror` handler (assigned over `fakeWorker.onerror`)
    // reads `.message`, mirroring a real ErrorEvent.
    fakeWorker.onerror?.({ message: 'load failed' });
    // Driver declared the worker unusable → the client terminated it.
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);

    // The next request now meshes synchronously (occluder keeps working).
    let indices: Uint32Array | null = null;
    driver.request(CELLS, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(CELLS, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));

    dispose();
  });

  it('recovers to synchronous meshing when the worker errors before the FIRST request (module load failure before any post)', () => {
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onmessageerror: null as ((event: unknown) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const { driver, dispose } = createOccluderMeshWorker(
      () => fakeWorker as unknown as Worker
    );

    // Realistic module-load-failure ordering: the module fails to load within a
    // few ms of construction — BEFORE the first refresh posts any job. The
    // driver must give up on the worker now (a load-failed worker silently
    // discards posts), so the client terminates it and the first request meshes
    // synchronously instead of wedging forever.
    fakeWorker.onerror?.({ message: 'load failed' });
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
    expect(fakeWorker.postMessage).not.toHaveBeenCalled();

    let indices: Uint32Array | null = null;
    driver.request(CELLS, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(CELLS, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(fakeWorker.postMessage).not.toHaveBeenCalled();

    dispose();
  });
});
