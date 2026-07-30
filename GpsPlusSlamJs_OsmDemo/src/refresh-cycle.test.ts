/**
 * The refresh cycle — the only thing in the demo that can fail two ways.
 *
 * Why these tests matter:
 * The reported defect was a map still drawing the previous category's cells
 * under a status line saying the refresh had failed. Fixing it is not just
 * "clear on error": the old `try` wrapped the data step AND both view renders,
 * so a three.js exception and an Overpass 429 arrived at the same `catch` and
 * would get the same treatment. Blanking a correct map because the 3D pane threw
 * is the same class of lie in the other direction. These tests pin the split at
 * the seam where it can actually be known — the data step reports `fetchFailed`,
 * a view reports `nonFatalError`, and only the first clears the picture.
 *
 * @see refresh-cycle.ts.md
 */

import { describe, it, expect, vi } from "vitest";

import { createDemoStore, selectOsmView } from "./osm-store.js";
import { createRefreshCycle, renderSafely } from "./refresh-cycle.js";
import type { DemoSnapshot } from "./demo-pipeline.js";
import type { TransferableMesh } from "./worker/protocol.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

const snapshot = (category: string): DemoSnapshot => ({
  position: COLOGNE,
  category,
  threshold: 1,
  cells: [
    {
      cell: "cell-0",
      scores: { [category]: 3 },
      contributors: { [category]: {} },
    },
  ],
  regions: [],
  missingTiles: [],
  loadedTiles: ["871fa199affffff"],
  stats: { chunksScored: 1, chunksReused: 0, geometryBuilt: 0 },
});

/** An empty mesh — these tests are about the cycle, not about geometry. */
const NO_MESH: TransferableMesh = {
  buildings: {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    triangleCount: 0,
    forcedEars: 0,
  },
  trees: [],
  plates: {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    triangleCount: 0,
    forcedEars: 0,
  },
  plateCount: 0,
  poi: [],
  roads: {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    triangleCount: 0,
    forcedEars: 0,
  },
  roadCount: 0,
  volumes: 0,
  parts: 0,
  guessedHeights: 0,
  approximateRoofs: 0,
};

/** The producer shape these tests write against: position + category in, snapshot out. */
type Update = (
  position: { lat: number; lng: number },
  category: string,
) => Promise<DemoSnapshot>;

function setup(update: Update, onReply?: (signal: AbortSignal) => void) {
  const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
  /** Records the order of mesh handoffs and dispatches — see the ordering test. */
  const events: string[] = [];
  const refresh = createRefreshCycle({
    store: demo.store,
    actions: demo.actions,
    // The pipeline moved into the worker, so the cycle now calls over RPC. The
    // narrow `RefreshWorker` shape is what keeps this test worker-free.
    worker: {
      call: async (_kind, payload, options) => {
        const snapshot = await update(payload.position, payload.category);
        // The signal is FORWARDED to the test, so a test can supersede the run
        // after the reply has landed — the exact race the guard exists for.
        onReply?.(options.signal);
        return { snapshot, mesh: NO_MESH };
      },
    },
    onMesh: () => {
      events.push("mesh");
    },
  });
  demo.store.subscribe(() => {
    if (selectOsmView(demo.store.getState()).snapshot !== undefined) {
      events.push("snapshot");
    }
  });
  return { ...demo, refresh, events };
}

describe("createRefreshCycle — the happy path", () => {
  it("announces fetching, then publishes the snapshot and returns to idle", async () => {
    const phases: string[] = [];
    const { store, refresh, subscribe } = setup(() => {
      phases.push(selectOsmView(store.getState()).loading.phase);
      return Promise.resolve(snapshot("walkable"));
    });
    subscribe(
      (view) => view.loading.phase,
      (phase) => phases.push(`→${phase}`),
    );

    await refresh();

    // The in-progress state must be observable WHILE the fetch runs, not just
    // inferred afterwards — that is the whole of CLAUDE.md's async-feedback
    // rule. Two independent witnesses: subscribers see `fetching` before `idle`
    // (they run synchronously inside `dispatch`, hence before the await), and
    // the pipeline itself, which runs strictly between them, reads `fetching`.
    expect(phases.filter((p) => p.startsWith("→"))).toEqual([
      "→fetching",
      "→idle",
    ]);
    expect(phases).toContain("fetching");
    expect(selectOsmView(store.getState()).loading.phase).toBe("idle");
    expect(selectOsmView(store.getState()).snapshot?.category).toBe("walkable");
  });

  it("hands over the mesh BEFORE dispatching the snapshot", async () => {
    // WHY THIS TEST MATTERS. The mesh cannot live in the store (it is
    // Float32Array vertex data, which RTK's serialisability scan rejects), so it
    // is handed to the caller through a callback while the 3D view draws from a
    // snapshot SUBSCRIPTION. If the dispatch came first, that subscriber would
    // run with the previous position's mesh still in place and draw one frame of
    // buildings belonging somewhere else — the exact class of cross-view
    // disagreement the store was introduced to make impossible.
    //
    // Ordering is invisible to every other test here: both orders end with the
    // same final state, and only the intermediate frame differs.
    const { refresh, events } = setup(() =>
      Promise.resolve(snapshot("walkable")),
    );

    await refresh();

    expect(events).toEqual(["mesh", "snapshot"]);
  });

  it("reads the position and category from the store at call time", async () => {
    // Not from arguments captured earlier: a category change and a map click
    // land as two dispatches, and the refresh must use whatever is current when
    // it actually runs, or a coalesced run fetches for a superseded intent.
    const seen: string[] = [];
    const { store, actions, refresh } = setup((_position, category) => {
      seen.push(category);
      return Promise.resolve(snapshot(category));
    });

    store.dispatch(actions.categoryChanged("battleArea"));
    await refresh();

    expect(seen).toEqual(["battleArea"]);
  });

  it("coalesces overlapping refreshes to the most recent intent", async () => {
    // `latestOnly`'s contract, exercised through the cycle: the map stays
    // clickable across an 18 s fetch, and the LAST click is the one that counts.
    let resolveFirst: (() => void) | undefined;
    const categories: string[] = [];
    const { store, actions, refresh } = setup(async (_position, category) => {
      categories.push(category);
      if (categories.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return snapshot(category);
    });

    const first = refresh();
    store.dispatch(actions.categoryChanged("battleArea"));
    void refresh();
    store.dispatch(actions.categoryChanged("restingArea"));
    void refresh();
    resolveFirst?.();
    await first;

    // Two runs, not three: the middle intent was superseded before it started.
    expect(categories).toEqual(["walkable", "restingArea"]);
  });
});

describe("createRefreshCycle — a data failure", () => {
  it("clears the snapshot so no view keeps drawing the old place", async () => {
    const { store, actions, refresh } = setup(() =>
      Promise.reject(new Error("Overpass returned 429")),
    );
    store.dispatch(actions.snapshotReady(snapshot("walkable")));

    await refresh();

    const view = selectOsmView(store.getState());
    expect(view.snapshot).toBeUndefined();
    expect(view.loading).toEqual({
      phase: "error",
      message: "Overpass returned 429",
    });
  });

  it("survives a thrown non-Error, because a rejected fetch can throw anything", async () => {
    // A rejected fetch can carry anything; this asserts the demo survives it.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate
    const { store, refresh } = setup(() => Promise.reject("just a string"));
    await refresh();
    expect(selectOsmView(store.getState()).loading.message).toContain(
      "just a string",
    );
  });

  it("recovers on the next successful refresh", async () => {
    let fail = true;
    const { store, refresh } = setup(() =>
      fail
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(snapshot("walkable")),
    );

    await refresh();
    fail = false;
    await refresh();

    expect(selectOsmView(store.getState()).loading.phase).toBe("idle");
    expect(selectOsmView(store.getState()).snapshot).toBeDefined();
  });
});

describe("renderSafely — a view failure", () => {
  it("reports the error WITHOUT discarding the snapshot the other view drew", () => {
    // The half of the split that a single `catch` gets wrong: if the 3D scene
    // throws, the 2D map is showing exactly the right thing.
    const { store, actions } = setup(() =>
      Promise.resolve(snapshot("walkable")),
    );
    store.dispatch(actions.snapshotReady(snapshot("walkable")));

    renderSafely({ store, actions }, "3D view", () => {
      throw new Error("WebGL context lost");
    });

    const view = selectOsmView(store.getState());
    expect(view.snapshot).toBeDefined();
    expect(view.loading.phase).toBe("error");
    expect(view.loading.message).toContain("3D view");
    expect(view.loading.message).toContain("WebGL context lost");
  });

  it("does not touch the store when the render succeeds", () => {
    const { store, actions } = setup(() =>
      Promise.resolve(snapshot("walkable")),
    );
    store.dispatch(actions.snapshotReady(snapshot("walkable")));
    const before = store.getState();

    renderSafely({ store, actions }, "map", () => undefined);

    expect(store.getState()).toBe(before);
  });

  it("lets one failing view fail without stopping the next one", () => {
    // Views are independent subscribers; a thrown exception inside one must not
    // prevent the others from drawing the same snapshot.
    const { store, actions } = setup(() =>
      Promise.resolve(snapshot("walkable")),
    );
    const second = vi.fn();

    renderSafely({ store, actions }, "first", () => {
      throw new Error("nope");
    });
    renderSafely({ store, actions }, "second", second);

    expect(second).toHaveBeenCalledOnce();
  });
});

describe("createRefreshCycle — a superseded run applies nothing", () => {
  it("drops a reply that landed just before the supersession", async () => {
    // WHY THIS TEST MATTERS, and it was missing until a PR review pointed it out.
    // Normally the abort rejects the worker call before it resolves. But there is a
    // real race: if the reply has ALREADY landed when a newer input arrives, the
    // cancellation has nothing left to cancel and the continuation runs anyway. The
    // superseded snapshot would then be dispatched — a visible flash of the previous
    // position before the current one replaces it.
    //
    // The guard is `if (signal.aborted) return;` after the await. Deleting it left
    // all ten other tests in this file green, because the fake worker ignored its
    // third argument and no test ever superseded a run after its reply landed.
    //
    // Driven through a REAL supersession rather than a hand-aborted controller:
    // `latestOnly` owns the signal, so the only honest way to abort it is to give
    // the wrapper a newer input — which is exactly what a second map click does.
    let superseded = false;
    // A function DECLARATION, so it is hoisted and can be named by the callback
    // that runs before `refresh` is bound. A `let` holder is the same thing with an
    // extra reassignment that `prefer-const` correctly objects to.
    function supersede(): void {
      void refresh();
    }
    const { store, refresh, events } = setup(
      () => Promise.resolve(snapshot("walkable")),
      () => {
        // Once only, or this recurses for as long as the wrapper keeps draining.
        if (superseded) return;
        superseded = true;
        supersede();
      },
    );

    await refresh();

    // ONE handover, not two: the superseded run applied nothing and the run that
    // replaced it applied everything. Without the guard both would.
    expect(events.filter((e) => e === "mesh")).toHaveLength(1);
    // The surviving run still published, so the guard did not simply break the cycle.
    expect(selectOsmView(store.getState()).snapshot).toBeDefined();
    // And a supersession is not a failure.
    expect(selectOsmView(store.getState()).loading.phase).not.toBe("error");
  });
});
