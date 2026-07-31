/**
 * WHY THESE TESTS MATTER (W8). Moving the grid build into the worker turns a
 * synchronous call into an async one, and that introduces exactly one new way to
 * be wrong: a build that was superseded while in flight can land last and paint
 * a grid the store no longer describes.
 *
 * That is not hypothetical here. FIVE things rebuild the grid — a new snapshot,
 * a category change, the below-threshold switch, a layer toggle, and the heat
 * scale moving — and three of them are a checkbox, so a user can produce two in
 * a hundred milliseconds. An RPC has no ordering guarantee, so without
 * coalescing the older reply wins whenever it happens to be faster, which for a
 * cached worker is *often*. It is the same shape as R3-5: an async result
 * arriving after the state it belonged to.
 *
 * So the assertions are about ordering and abandonment, not about the buffers —
 * the geometry itself is `cell-mesh.test.ts`'s subject and did not move.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createCellMeshCycle,
  type CellMeshRequest,
} from "./cell-mesh-cycle.js";
import { EMPTY_CELL_MESH } from "./cell-mesh.js";

function request(overrides: Partial<CellMeshRequest> = {}): CellMeshRequest {
  return {
    cells: [{ cell: "8f1", score: 4 }],
    centre: { lat: 50.9413, lng: 6.9583 },
    threshold: 1,
    scale: { threshold: 1, max: 9 },
    showBelowThreshold: false,
    ...overrides,
  };
}

/** A worker whose replies can be released in whatever order a test wants. */
function deferredWorker() {
  const pending: {
    payload: CellMeshRequest;
    resolve: (mesh: typeof EMPTY_CELL_MESH) => void;
    signal?: AbortSignal | undefined;
  }[] = [];
  return {
    pending,
    call: (
      _kind: "cellMesh",
      payload: CellMeshRequest,
      options?: { readonly signal?: AbortSignal },
    ) =>
      new Promise<typeof EMPTY_CELL_MESH>((resolve) => {
        pending.push({ payload, resolve, signal: options?.signal });
      }),
  };
}

describe("createCellMeshCycle", () => {
  it("applies a finished build", async () => {
    const worker = deferredWorker();
    const apply = vi.fn();
    const cycle = createCellMeshCycle({ worker, apply });

    const done = cycle(request());
    worker.pending[0]?.resolve(EMPTY_CELL_MESH);
    await done;

    expect(apply).toHaveBeenCalledWith(EMPTY_CELL_MESH);
  });

  it("drops the intermediate request, never the newest", async () => {
    // Latest-wins rather than a lock: refusing a rebuild while one is in flight
    // would make the checkbox feel broken, which is the trade `refresh-cycle.ts`
    // and `terrain-cycle.ts` already made for the same reason.
    const worker = deferredWorker();
    const apply = vi.fn();
    const cycle = createCellMeshCycle({ worker, apply });

    void cycle(request({ threshold: 1 }));
    void cycle(request({ threshold: 2 }));
    const last = cycle(request({ threshold: 3 }));

    // Drain rather than resolving a fixed index: `latestOnly` only issues the
    // queued call once the active one settles, so the second worker call does
    // not exist yet at the moment the first is resolved.
    let resolved = 0;
    for (let turn = 0; turn < 10; turn++) {
      while (resolved < worker.pending.length) {
        worker.pending[resolved]?.resolve(EMPTY_CELL_MESH);
        resolved += 1;
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    await last;

    const thresholds = worker.pending.map((call) => call.payload.threshold);
    // The middle one never reached the worker at all.
    expect(thresholds).not.toContain(2);
    expect(thresholds.at(-1)).toBe(3);
  });

  it("does NOT paint a reply that arrived after it was superseded", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `latestOnly` can stop the next CALL;
    // it cannot recall a reply already on its way back. Painting it would put a
    // grid on screen built from state the store has moved past — self-consistent,
    // and therefore invisible.
    const worker = deferredWorker();
    const apply = vi.fn();
    const cycle = createCellMeshCycle({ worker, apply });

    void cycle(request({ threshold: 1 }));
    const first = worker.pending[0];
    void cycle(request({ threshold: 2 }));

    // The first run has been aborted by the second; its reply lands anyway.
    expect(first?.signal?.aborted).toBe(true);
    first?.resolve(EMPTY_CELL_MESH);
    await Promise.resolve();

    expect(apply).not.toHaveBeenCalled();
  });

  it("passes the abort signal through, so the worker can stop early", () => {
    const worker = deferredWorker();
    const cycle = createCellMeshCycle({ worker, apply: () => {} });
    void cycle(request());
    expect(worker.pending[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});
