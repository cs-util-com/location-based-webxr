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

import {
  ZERO_STAGE_TIMINGS,
  ZERO_WORKER_TIMINGS,
} from "./snapshot-timings-fixture.js";
import { describe, it, expect, vi } from "vitest";

import { SCORE_DISK_MAX_RADIUS, SCORE_DISK_RADIUS } from "gps-plus-slam-osm";

import { createDemoStore, selectLayers, selectOsmView } from "./osm-store.js";
import {
  createRefreshCycle,
  isFinalRing,
  renderSafely,
} from "./refresh-cycle.js";
import { createAnchorHolder } from "./scene-anchor.js";
import type { DemoSnapshot } from "./demo-pipeline.js";
import type { ClickSummary } from "./click-timings.js";
import type { TransferableMesh } from "./worker/protocol.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** `radius` cells, so a wider pass is observably a bigger working set. */
const snapshotAt = (category: string, radius: number): DemoSnapshot => ({
  ...snapshot(category),
  // The pass's own ring, which is what the fake worker is being asked for and
  // what the real pipeline now reports back (F42).
  radius,
  cells: Array.from({ length: radius }, (_, i) => ({
    cell: `cell-${i}`,
    scores: { [category]: 3 },
    contributors: { [category]: {} },
  })),
});

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
  cellCount: 1,
  observedMax: 3,
  aboveThresholdCount: 1,
  undergroundCount: 0,
  undergroundOutlines: [],
  stats: { chunksScored: 1, chunksReused: 0, geometryBuilt: 0 },
  timings: ZERO_STAGE_TIMINGS,
  // A FINAL snapshot by default: these tests are about failure handling and
  // ordering, not about widening, so the base should not look half-delivered.
  radius: SCORE_DISK_MAX_RADIUS,
});

/** One empty buffer set, for the layers that are still a single mesh. */
const EMPTY_MESH_DATA = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  triangleCount: 0,
  forcedEars: 0,
};

/** An empty mesh — these tests are about the cycle, not about geometry. */
const NO_MESH: TransferableMesh = {
  buildings: [],
  trees: [],
  plates: [],
  plateCount: 0,
  poi: [],
  roads: [],
  roadCount: 0,
  underground: [],
  regions: [],
  volumes: 0,
  parts: 0,
  guessedHeights: 0,
  approximateRoofs: 0,
  barriers: 0,
};

/**
 * Never resolves; rejects when the run is superseded.
 *
 * Raced against the producer so the fake worker behaves like the real one, whose
 * `RpcAbortError` is what makes W2's distinction — superseded is not failed —
 * something the cycle has to make at all.
 */
function superseded(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      reject(new Error("The request was superseded"));
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

/** The producer shape these tests write against: position + category in, snapshot out. */
type Update = (
  position: { lat: number; lng: number },
  category: string,
  radius: number,
) => Promise<DemoSnapshot>;

function setup(update: Update, onReply?: (signal: AbortSignal) => void) {
  const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
  /** Reply counter, so the fake sends one full mesh and then slabs (W6). */
  let calls = 0;
  /** Records the order of mesh handoffs and dispatches — see the ordering test. */
  const events: string[] = [];
  const refresh = createRefreshCycle({
    store: demo.store,
    actions: demo.actions,
    anchors: createAnchorHolder(COLOGNE),
    // The pipeline moved into the worker, so the cycle now calls over RPC. The
    // narrow `RefreshWorker` shape is what keeps this test worker-free.
    worker: {
      call: async (_kind, payload, options) => {
        // REJECTS ON ABORT, exactly as the real client does (`rpc-client.ts`
        // posts an `abort` and rejects with `RpcAbortError`). The fake used to
        // ignore the signal, which made every test here blind to the whole
        // abort path — including the defect W2 fixes, where that rejection
        // reached the generic `catch` and was reported as a data failure.
        const snapshot = await Promise.race([
          update(payload.position, payload.category, payload.radius),
          superseded(options.signal),
        ]);
        // The signal is FORWARDED to the test, so a test can supersede the run
        // after the reply has landed — the exact race the guard exists for.
        onReply?.(options.signal);
        // The worker sends the FULL mesh on the first pass of a click and only
        // the region slabs afterwards (W6). The fake reproduces that shape so the
        // cycle is driven by what it will really receive.
        calls += 1;
        return calls === 1
          ? {
              snapshot,
              mesh: { kind: "full" as const, mesh: NO_MESH },
              workerTimings: ZERO_WORKER_TIMINGS,
            }
          : {
              snapshot,
              mesh: { kind: "regions" as const, regions: [], underground: [] },
              workerTimings: ZERO_WORKER_TIMINGS,
            };
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

    // ONE PAIR PER RING now (W16), and the ORDER within each pair is the
    // invariant — not the count. A dispatch before its mesh would draw the new
    // ring's cells over the previous ring's geometry.
    expect(events).toHaveLength(6);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]).toBe("mesh");
      expect(events[i + 1]).toBe("snapshot");
    }
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

    // Once per ring, and every ring reads the SAME current intent — a widening
    // pass must not drift onto a category the store has moved off.
    expect(seen).toEqual(["battleArea", "battleArea", "battleArea"]);
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

    // The middle intent was superseded before it started, so it never runs. The
    // first run contributes only its opening ring — it is aborted after that —
    // and the survivor runs all three.
    expect(categories).toEqual([
      "walkable",
      "restingArea",
      "restingArea",
      "restingArea",
    ]);
  });
});

describe("createRefreshCycle — a SUPERSEDED run (W2, finding R3-5)", () => {
  it("reports nothing, and keeps the snapshot AND the selection", async () => {
    // WHY THIS TEST MATTERS. This is the reported bug: "the 3D scene sometimes
    // resets — switching category empties it completely before it reloads", and
    // "clicking the map sometimes resets the areas". Neither is a reset. A newer
    // click aborts the run in flight, the RPC rejects with `RpcAbortError`, and
    // the cycle's `catch` treated that identically to an Overpass 429 — so
    // `fetchFailed` fired, which CLEARS the snapshot and the selection by
    // design. Both views are snapshot subscribers, so both blanked, and the
    // details panel closed itself while it was being read.
    //
    // The two guards that already existed cannot see it: they check
    // `signal.aborted` after an await RESOLVES, and an aborted call rejects.
    //
    // The assertion is "no error was ever observed", not "the final state is
    // fine" — the newer run's own snapshot arrives moments later and would
    // repair the final state whether or not the bug is present.
    let releaseFirst: (() => void) | undefined;
    let calls = 0;
    const { store, actions, refresh, subscribe } = setup(
      async (_position, category) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return snapshot(category);
      },
    );
    store.dispatch(actions.snapshotReady(snapshot("walkable")));
    store.dispatch(actions.cellSelected("cell-0"));

    const phases: string[] = [];
    subscribe(
      (view) => view.loading.phase,
      (phase) => phases.push(phase),
    );

    const first = refresh();
    // Supersedes the run in flight — the abort that used to be reported as a
    // data failure.
    void refresh();
    releaseFirst?.();
    await first;

    expect(phases).not.toContain("error");
    const view = selectOsmView(store.getState());
    expect(view.snapshot).toBeDefined();
    // The details panel follows this. Clearing it is why the panel dismissed
    // itself on every second click.
    expect(view.selectedCell).toBe("cell-0");
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

    // THREE handovers, one per ring, and all three belong to the SURVIVING run:
    // the superseded run applied nothing. Without the guard its rings would
    // interleave with the survivor's, and the last one to land would win.
    expect(events.filter((e) => e === "mesh")).toHaveLength(3);
    // The surviving run still published, so the guard did not simply break the cycle.
    expect(selectOsmView(store.getState()).snapshot).toBeDefined();
    // And a supersession is not a failure.
    expect(selectOsmView(store.getState()).loading.phase).not.toBe("error");
  });
});

describe("createRefreshCycle — progressive scoring (W16, DEC-R2-30)", () => {
  it("widens ring by ring, and the FIRST pass is the full original working set", () => {
    // THE REQUIREMENT THAT SHAPES THE REST. The user waits for the first answer
    // and for nothing else, so progressive scoring must not make it later.
    // Starting at ring 0 to make the steps uniform would trade the thing people
    // notice for the thing they do not — the plan says that fails review.
    const radii: number[] = [];
    const { refresh } = setup((_position, category, radius) => {
      radii.push(radius);
      return Promise.resolve(snapshotAt(category, radius));
    });

    return refresh().then(() => {
      expect(radii[0]).toBe(SCORE_DISK_RADIUS);
      expect(radii[radii.length - 1]).toBe(SCORE_DISK_MAX_RADIUS);
      // Strictly increasing: a repeated radius is wasted work, and a decreasing
      // one would narrow the map after widening it.
      for (let i = 1; i < radii.length; i += 1) {
        expect(radii[i]).toBeGreaterThan(radii[i - 1] as number);
      }
    });
  });

  it("publishes a MONOTONICALLY growing working set", async () => {
    // What the user sees: the map fills outward. A pass that published fewer
    // cells than the one before would make it visibly contract, which reads as
    // data being lost rather than as more arriving.
    const counts: number[] = [];
    const { store, refresh, subscribe } = setup((_p, category, radius) =>
      Promise.resolve(snapshotAt(category, radius)),
    );
    subscribe(
      (view) => view.snapshot,
      (snap) => {
        if (snap !== undefined) counts.push(snap.cells.length);
      },
    );

    await refresh();

    expect(counts.length).toBeGreaterThan(1);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1] as number);
    }
    expect(selectOsmView(store.getState()).snapshot?.cells.length).toBe(
      SCORE_DISK_MAX_RADIUS,
    );
  });

  it("STOPS the remaining rings when the user moves", async () => {
    // The other half of the guarantee. The rings still to come belong to a place
    // the user has left; scoring them spends the worker on ground nobody is
    // looking at, and publishing them would put the old position back on screen
    // after the new one had arrived.
    let superseded = false;
    function supersede(): void {
      void refresh();
    }
    const radii: number[] = [];
    const { refresh, events } = setup(
      (_p, category, radius) => {
        radii.push(radius);
        return Promise.resolve(snapshotAt(category, radius));
      },
      () => {
        if (superseded) return;
        superseded = true;
        supersede();
      },
    );

    await refresh();

    // The first run got exactly one ring in before it was superseded; the run
    // that replaced it did all three. Four calls, not six.
    expect(radii).toEqual([
      SCORE_DISK_RADIUS,
      SCORE_DISK_RADIUS,
      SCORE_DISK_RADIUS + 1,
      SCORE_DISK_MAX_RADIUS,
    ]);
    // And only the survivor's rings reached the store.
    expect(events.filter((e) => e === "snapshot")).toHaveLength(3);
  });
});

describe("createRefreshCycle — an error stops the widening (W16)", () => {
  it("does not let a later ring erase a message the user needs to read", async () => {
    // A DEFECT W16 INTRODUCED, fixed and pinned. Publishing a snapshot returns
    // the loading phase to `idle`, which erases whatever is on the status line.
    // With one emission per refresh that window was negligible; with three it
    // spans the whole widening, so an error arriving mid-run — a refused
    // geolocation permission was the real case — got wiped by the next ring and
    // the demo looked like it had done nothing at all.
    //
    // Found by an e2e that had nothing to do with scoring, which is the argument
    // for keeping end-to-end tests of things that "cannot" interact.
    const seen: number[] = [];
    const { store, actions, refresh } = setup((_p, category, radius) => {
      seen.push(radius);
      // Something fails while the first ring is in flight.
      if (radius === SCORE_DISK_RADIUS) {
        queueMicrotask(() => store.dispatch(actions.fetchFailed("denied")));
      }
      return Promise.resolve(snapshotAt(category, radius));
    });

    await refresh();

    // The opening ring was REQUESTED but never published, and no wider ring was
    // even asked for.
    expect(seen).toEqual([SCORE_DISK_RADIUS]);
    expect(selectOsmView(store.getState()).snapshot).toBeUndefined();
    const view = selectOsmView(store.getState());
    expect(view.loading.phase).toBe("error");
    expect(view.loading.message).toContain("denied");
  });
});

describe("createRefreshCycle — the mesh is built once per click (W6)", () => {
  it("merges a regions-only pass into the mesh it already holds", async () => {
    // WHY THIS TEST MATTERS. Progressive scoring runs three passes and only the
    // region slabs change between them, so the worker sends the full geometry
    // once and slabs afterwards. The obvious way to get that wrong is to treat a
    // slabs-only reply as "no geometry" and blank the buildings on rings 3 and 4
    // — which would look exactly like the reset bug W2 just fixed.
    const held: unknown[] = [];
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    let calls = 0;
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        call: (_kind, payload) => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? {
                  snapshot: snapshotAt(payload.category, payload.radius),
                  mesh: { kind: "full" as const, mesh: NO_MESH },
                  workerTimings: ZERO_WORKER_TIMINGS,
                }
              : {
                  snapshot: snapshotAt(payload.category, payload.radius),
                  mesh: {
                    kind: "regions" as const,
                    // Region slabs are NOT chunked (W20): a region is one
                    // contiguous claim and is drawn as one slab, so it stays a
                    // single `MeshData` while buildings, plates and roads became
                    // chunk lists.
                    regions: [
                      {
                        medianScore: calls,
                        id: `r${calls}`,
                        mesh: EMPTY_MESH_DATA,
                      },
                    ],
                    underground: [],
                  },
                  workerTimings: ZERO_WORKER_TIMINGS,
                },
          );
        },
      },
      onMesh: (mesh) => held.push(mesh),
    });

    await refresh();

    // One full reply, then one per remaining ring. The COUNT of full replies is
    // the whole claim: it used to be one per ring.
    const kinds = held.map((mesh) => (mesh as { kind: string }).kind);
    expect(kinds[0]).toBe("full");
    expect(kinds.filter((kind) => kind === "full")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "regions")).toHaveLength(
      SCORE_DISK_MAX_RADIUS - SCORE_DISK_RADIUS,
    );
  });
});

/**
 * The end of the widening has to be a FACT the app states, not one inferred.
 *
 * Why this test matters (F42): scoring publishes once per ring and each publish
 * sets `loading: idle`, so "the status line stopped changing" was the only
 * available signal that widening had finished — and it is a bad one. Under
 * worker contention the gap between rings exceeds the window that was watching
 * for it, so one e2e run read 845 cells where another read 1692 from the same
 * fixture, and the UI meanwhile told the user a final-looking answer three
 * times.
 *
 * `isFinalRing` lives next to `PROGRESSIVE_RADII` precisely so that changing the
 * ring list cannot leave a stale definition of "last" behind somewhere else.
 */
describe("isFinalRing", () => {
  it("is true for the last radius the cycle scores and false for the others", () => {
    expect(isFinalRing(SCORE_DISK_MAX_RADIUS)).toBe(true);
    expect(isFinalRing(SCORE_DISK_RADIUS)).toBe(false);
  });

  it("stays true above the last radius, so an unexpected value never hides the end", () => {
    // Defensive: a caller passing a radius the cycle never scores must not leave
    // the UI stuck in "still widening" forever. Erring towards "finished" keeps
    // a wrong radius a cosmetic bug rather than a permanent spinner.
    expect(isFinalRing(SCORE_DISK_MAX_RADIUS + 1)).toBe(true);
  });
});

/**
 * WHY THIS TEST MATTERS (round 10, stage B).
 *
 * The cell array structured-clones across the worker boundary in a measured
 * 27–35 ms at the 488-chunk cap, three times per move — and in the DEFAULT
 * configuration the page draws none of it, because the `cells` layer is off
 * (DEC-R7b-5/R7b-6). The regions are computed in the worker and the ramp's `max`
 * now arrives as a number, so nothing on the page needs the array.
 *
 * The saving is entirely in ASKING for it correctly. `demo-pipeline` honouring
 * `includeCells` is unit-tested there; what nothing else covers is that the
 * cycle actually sets the flag from the live layer state — and a cycle that
 * always asked for cells would be invisible except as the cost this stage
 * exists to remove.
 */
describe("the refresh cycle asks for cells only when they are drawn", () => {
  const requestFor = async (cellsLayerOn: boolean) => {
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    // `cells` is OFF in DEFAULT_LAYERS, so the ON case is the one that needs a
    // dispatch. Getting this backwards made the first version of these tests
    // assert the same state twice.
    if (cellsLayerOn) {
      demo.store.dispatch(
        demo.actions.layersChanged({
          ...selectLayers(demo.store.getState()),
          cells: true,
        }),
      );
    }
    const asked: boolean[] = [];

    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        // Not `async`: there is nothing to await, and the rule is right that an
        // async function without one is a promise wrapper pretending to be work.
        call: (_kind, payload) => {
          asked.push(payload.includeCells);
          return Promise.resolve({
            snapshot: snapshot("walkable"),
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          });
        },
      },
      onMesh: () => {},
    });

    await refresh();
    return asked;
  };

  it("does not ask for cells while the layer is off", async () => {
    // The default configuration, and the whole point of the stage.
    const asked = await requestFor(false);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked).not.toContain(true);
  });

  it("asks for cells once the layer is on", async () => {
    // THE OTHER DIRECTION, and it is what stops this being a deletion. Turning
    // the layer on must bring the array back, or the map draws nothing.
    const asked = await requestFor(true);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked).not.toContain(false);
  });

  it("re-reads the layer for each ring, so a mid-widening switch-off takes effect", async () => {
    // THE INVARIANT THE SIDECAR PROMISES, which nothing verified. Both tests
    // above set the layer before `refresh()` starts, so hoisting the
    // `isLayerEnabled` call out of the ring loop passes them unchanged -- the
    // claim had nothing behind it. Raised in review on #254.
    //
    // Switching OFF is the reachable direction to test: switching ON also
    // triggers a refetch, which would abort the run being observed.
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    demo.store.dispatch(
      demo.actions.layersChanged({
        ...selectLayers(demo.store.getState()),
        cells: true,
      }),
    );

    const asked: boolean[] = [];
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        call: (_kind, payload) => {
          asked.push(payload.includeCells);
          // Off after the first ring has been asked for.
          demo.store.dispatch(
            demo.actions.layersChanged({
              ...selectLayers(demo.store.getState()),
              cells: false,
            }),
          );
          return Promise.resolve({
            snapshot: snapshot("walkable"),
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          });
        },
      },
      onMesh: () => {},
    });

    await refresh();

    // A CAPTURED-ONCE implementation gives [true, true, true]; naming it is what
    // makes this test bite rather than merely pass.
    expect(asked).toEqual([true, false, false]);
  });
});

describe("the scene anchor", () => {
  /**
   * Runs the cycle at each position in turn, recording the frameOrigin sent.
   *
   * ADVANCES THE HOLDER BEFORE EACH REFRESH, which is what `main.ts`'s position
   * subscriber does — the anchor moves once, at the top, so the camera and the
   * terrain load read the same value this refresh will send. The cycle used to
   * own that decision and therefore ran it LAST, leaving the other two consumers
   * on the outgoing frame whenever it moved.
   */
  async function originsFor(
    positions: readonly { lat: number; lng: number }[],
  ): Promise<({ lat: number; lng: number } | undefined)[]> {
    const demo = createDemoStore({
      start: positions[0]!,
      category: "walkable",
    });
    const anchors = createAnchorHolder(positions[0]!);
    const sent: ({ lat: number; lng: number } | undefined)[] = [];
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors,
      worker: {
        call: (_kind, payload) => {
          sent.push(payload.frameOrigin);
          return Promise.resolve({
            snapshot: snapshot("walkable"),
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          });
        },
      },
      onMesh: () => {},
    });

    for (const position of positions) {
      demo.store.dispatch(demo.actions.positionChanged(position));
      anchors.advance(position);
      await refresh();
    }
    return sent;
  }

  it("keeps ONE frame origin across a walk", async () => {
    // THE REGRESSION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. The frame used
    // to be derived from the position on every publish, so every vertex in the
    // scene moved whenever the user did — which no AR content can live with,
    // the framework's own origin being fixed for the session.
    //
    // Three steps of roughly 20 m, which is a walk, not travel.
    const walk = [
      COLOGNE,
      { lat: COLOGNE.lat + 0.0002, lng: COLOGNE.lng },
      { lat: COLOGNE.lat + 0.0004, lng: COLOGNE.lng },
    ];

    const origins = await originsFor(walk);

    expect(origins.length).toBeGreaterThanOrEqual(3);
    for (const origin of origins) expect(origin).toEqual(COLOGNE);
  });

  it("re-anchors for a DECLARED place change, however small the move", async () => {
    // THE SITE PICKER'S RULE (DEC-R11-7). Choosing a place is a discontinuity,
    // not travel, so it does not consult the distance at all — two picker
    // entries a few hundred metres apart are still two different scenes.
    //
    // Without this the anchor is kept for any move under 5 km, so hopping
    // between nearby places would leave the second one drawn in the first
    // one's frame.
    const near = { lat: COLOGNE.lat + 0.0005, lng: COLOGNE.lng };
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const anchors = createAnchorHolder(COLOGNE);
    const sent: ({ lat: number; lng: number } | undefined)[] = [];
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors,
      worker: {
        call: (_kind, payload) => {
          sent.push(payload.frameOrigin);
          return Promise.resolve({
            snapshot: snapshot("walkable"),
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          });
        },
      },
      onMesh: () => {},
    });

    await refresh();
    demo.store.dispatch(demo.actions.positionChanged(near));
    anchors.advance(near, { declared: true });
    await refresh();

    expect(sent.at(-1)).toEqual(near);
  });

  it("sends the anchor the holder ALREADY HOLDS, never one of its own", async () => {
    // WHY THIS TEST MATTERS. This is the structural half of the ordering fix.
    // While the cycle computed the anchor itself, "the camera, the terrain and
    // the geometry agree about the frame" was a rule about statement order in
    // `main.ts`; now it is a consequence of there being one value. The
    // assertion is that a refresh with NO position change re-sends the held
    // origin rather than re-deriving one from wherever the user happens to be —
    // which is what a category switch or a layer toggle does all day.
    const walked = { lat: COLOGNE.lat + 0.0004, lng: COLOGNE.lng };
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const anchors = createAnchorHolder(COLOGNE);
    const sent: ({ lat: number; lng: number } | undefined)[] = [];
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors,
      worker: {
        call: (_kind, payload) => {
          sent.push(payload.frameOrigin);
          return Promise.resolve({
            snapshot: snapshot("walkable"),
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          });
        },
      },
      onMesh: () => {},
    });

    // The user has moved and the holder was advanced for it — a step, so the
    // anchor stayed put. A later refresh that nobody told about the move must
    // still send the anchor, not the position.
    demo.store.dispatch(demo.actions.positionChanged(walked));
    anchors.advance(walked);
    await refresh();

    expect(sent.at(-1)).toEqual(COLOGNE);
    expect(sent.at(-1)).not.toEqual(walked);
  });

  it("re-anchors once the user travels past the threshold", async () => {
    // The counterweight. Without it "the origin never moves" would also pass
    // for a scene that ignored position entirely — and the frame's fixed
    // longitude scale really does need re-taking eventually.
    const origins = await originsFor([
      COLOGNE,
      { lat: COLOGNE.lat + 0.1, lng: COLOGNE.lng },
    ]);

    expect(origins.at(-1)).not.toEqual(COLOGNE);
  });
});

describe("the click-path breakdown is reported exactly once per PUBLISHED ring", () => {
  /**
   * Why these tests matter: `onTimings` sits behind three guards that each
   * exist because of a real, reported bug — the superseded-run guard (a flash
   * of the previous position), the error guard (W16's erased error message) and
   * the abort `catch` (finding R3-5, "the scene resets"). The callback was
   * added behind all three and pinned by none of them, so a future reorder that
   * hoisted it above the superseded check would print a ranked breakdown for a
   * position the user had already left, and every test would stay green.
   *
   * A breakdown of a discarded pass is worse than no breakdown: it is a
   * confident, decimal-pointed answer about work nobody is waiting for.
   */
  function timingSetup(
    update: Update,
    onReply?: (signal: AbortSignal) => void,
  ) {
    const seen: number[] = [];
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        call: async (_kind, payload, options) => {
          onReply?.(options.signal);
          const snapshot = await update(
            payload.position,
            payload.category,
            payload.radius,
          );
          return {
            snapshot,
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          };
        },
      },
      onMesh: () => {},
      onTimings: (t) => seen.push(t.radius),
    });
    return { ...demo, refresh, seen };
  }

  it("emits one breakdown per ring, tagged with the ring it belongs to", async () => {
    // Per pass rather than per click, because stages 6 and 7 are near-zero on
    // rings 3 and 4 by design and a per-click sum would hide exactly that.
    const { refresh, seen } = timingSetup((_position, category, radius) =>
      Promise.resolve({ ...snapshot(category), radius }),
    );

    await refresh();

    expect(seen).toEqual([SCORE_DISK_RADIUS, 3, SCORE_DISK_MAX_RADIUS]);
  });

  it("reports only AFTER the snapshot is published, which is what the guards protect", async () => {
    // The structural property that makes all three guards protective. Every
    // early `return` in the loop — superseded run, error phase on screen, and
    // the `catch` — sits BEFORE the publish, so anything ordered after the
    // publish cannot fire for a pass that did not publish.
    //
    // Asserted as ordering rather than by simulating each guard, because that
    // is the invariant a future reorder would break: hoisting `onTimings`
    // above the publish would print a ranked breakdown for a position the user
    // had already left, and nothing else in this file would notice.
    const order: string[] = [];
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        call: (_kind, payload) =>
          Promise.resolve({
            snapshot: { ...snapshot(payload.category), radius: payload.radius },
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          }),
      },
      onMesh: () => order.push("mesh"),
      onTimings: () => order.push("timings"),
    });
    demo.store.subscribe(() => {
      if (selectOsmView(demo.store.getState()).snapshot !== undefined) {
        order.push("published");
      }
    });

    await refresh();

    // First ring: mesh, then publish, then the breakdown. Never before.
    expect(order.slice(0, 3)).toEqual(["mesh", "published", "timings"]);
    expect(order.indexOf("timings")).toBeGreaterThan(
      order.indexOf("published"),
    );
  });

  it("opens the click clock BEFORE the fetchStarted dispatch", async () => {
    // r504 REVIEW. The clock used to open twenty-two lines after the dispatch,
    // while three separate documents said `pageResidualMs` covers "the
    // `fetchStarted` dispatch and its subscriber renders". A synchronous store
    // dispatch with subscriber renders behind it is exactly the page-side stage
    // this summary exists to make visible — and it was the only page-side stage
    // the docs named by hand while measuring none of it.
    //
    // It matters beyond bookkeeping: `pageResidualMs` is the ONLY clock in the
    // instrument that can see page time at all (the per-ring algebra cancels
    // it), so an unmeasured page stage here is unmeasurable everywhere.
    //
    // Driven by burning REAL time inside the subscriber rather than by mocking
    // the clock, because the property under test is WHERE the clock opens
    // relative to a synchronous dispatch — against a mocked clock the test
    // would pass with the call in either position.
    const BURN_MS = 20;
    let burned = false;
    let summary: ClickSummary | undefined;

    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const refresh = createRefreshCycle({
      store: demo.store,
      actions: demo.actions,
      anchors: createAnchorHolder(COLOGNE),
      worker: {
        call: (_kind, payload) =>
          Promise.resolve({
            snapshot: { ...snapshot(payload.category), radius: payload.radius },
            mesh: { kind: "regions" as const, regions: [], underground: [] },
            workerTimings: ZERO_WORKER_TIMINGS,
          }),
      },
      onMesh: () => {},
      onClickSummary: (s) => {
        summary = s;
      },
    });

    // The first notification after this point is `fetchStarted` — the cycle
    // dispatches it before anything else it does.
    demo.store.subscribe(() => {
      if (burned) return;
      burned = true;
      const until = performance.now() + BURN_MS;
      while (performance.now() < until) {
        /* spin — standing in for an expensive subscriber render */
      }
    });

    await refresh();

    expect(burned).toBe(true);
    // The rings resolve immediately here, so essentially the whole click IS
    // the burn. With the clock opened after the dispatch this was ~0.
    expect(summary?.pageResidualMs ?? 0).toBeGreaterThanOrEqual(BURN_MS - 5);
  });

  it("says nothing when the pass fails", async () => {
    // A thrown pass never reaches the publish, so it never reaches the report.
    // A breakdown printed from the `catch` would be a ranking of a click that
    // produced no answer at all.
    const { refresh, seen } = timingSetup(() =>
      Promise.reject(new Error("overpass exploded")),
    );

    await refresh();

    expect(seen).toEqual([]);
  });
});
