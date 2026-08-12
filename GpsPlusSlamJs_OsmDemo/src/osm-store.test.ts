/**
 * The demo's store — the one thing every view reads.
 *
 * Why these tests matter:
 * The framework slice is already tested; what is untested until here is the
 * BINDING — that the demo mounts it under a key its selectors agree on, that
 * `DemoSnapshot` survives RTK's serialisability check, and that a subscriber
 * fires exactly when the thing it draws has changed. The last one is the whole
 * reason the store exists: a subscriber that fires on every dispatch redraws
 * ~931 Leaflet polygons when the user ticks a checkbox, and one that never
 * fires is the stale map this round is fixing.
 *
 * @see osm-store.ts.md
 */

import { ZERO_STAGE_TIMINGS } from "./snapshot-timings-fixture.js";
import { describe, it, expect, vi } from "vitest";

import {
  createDemoStore,
  selectOsmView,
  summariseSnapshot,
} from "./osm-store.js";
import type { DemoSnapshot } from "./demo-pipeline.js";

import { SCORE_DISK_MAX_RADIUS } from "gps-plus-slam-osm";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

const snapshot = (cells: number): DemoSnapshot => ({
  position: COLOGNE,
  category: "walkable",
  threshold: 1,
  cells: Array.from({ length: cells }, (_, i) => ({
    cell: `cell-${i}`,
    scores: { walkable: 2 },
    contributors: { walkable: { "way/1": 2 } },
  })),
  regions: [],
  missingTiles: [],
  loadedTiles: ["871fa199affffff"],
  cellCount: cells,
  heatMax: 2,
  undergroundCount: 0,
  undergroundOutlines: [],
  stats: { chunksScored: 1, chunksReused: 0, geometryBuilt: 1 },
  timings: ZERO_STAGE_TIMINGS,
  // The last ring: these tests are about the store, and a half-widened fixture
  // would say something this file is not trying to say.
  radius: SCORE_DISK_MAX_RADIUS,
});

describe("createDemoStore", () => {
  it("mounts the slice where the selectors look for it", () => {
    const { store } = createDemoStore({
      start: COLOGNE,
      category: "walkable",
    });
    const view = selectOsmView(store.getState());
    expect(view.position).toEqual(COLOGNE);
    expect(view.category).toBe("walkable");
    expect(view.snapshot).toBeUndefined();
  });

  it("stores the snapshot without RTK complaining about anything ELSE in the state", () => {
    // NOT a serialisability guard on the snapshot — that channel is closed on
    // purpose. `ignoredActions` skips the whole action scan and `ignoredPaths`
    // skips the state subtree, so a `Map` inside the snapshot now produces zero
    // `console.error` calls and this assertion would pass regardless. It still
    // earns its place for the REST of the state — `position`, `category`,
    // `loading` and friends are all scanned — and for proving the dispatch
    // path stores what it was given.
    //
    // The snapshot's own guarantee moved to `demo-pipeline.test.ts`, against a
    // real pipeline snapshot rather than a fixture written next to the
    // assertion. See `osm-store.ts.md`.
    const { store, actions } = createDemoStore({
      start: COLOGNE,
      category: "walkable",
    });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    store.dispatch(actions.snapshotReady(snapshot(3)));
    spy.mockRestore();

    expect(errors).toEqual([]);
    expect(selectOsmView(store.getState()).snapshot?.cells).toHaveLength(3);
  });
});

describe("summariseSnapshot", () => {
  it("replaces the snapshot with a count, so devtools does not serialise ~931 cells", () => {
    const state = {
      osmView: { snapshot: snapshot(931), category: "walkable" },
    };
    const sanitised = summariseSnapshot(state) as unknown as {
      osmView: { snapshot: string; category: string };
    };
    expect(sanitised.osmView.snapshot).toBe("«931 cells, 0 regions»");
    expect(sanitised.osmView.category).toBe("walkable");
  });

  it("reports the count even when the cell array was not sent", () => {
    // THE SHIPPED DEFAULT since round 10 stage B: the `cells` layer is off, so
    // the snapshot carries `cellCount` and an EMPTY array. A summariser reading
    // `cells.length` says "0 cells" for every real snapshot while the status
    // line reports thousands -- and the test above cannot catch it, because its
    // fixture populates `cells` directly. Raised in review on #254.
    const withheld: DemoSnapshot = { ...snapshot(931), cells: [] };
    const sanitised = summariseSnapshot({
      osmView: { snapshot: withheld, category: "walkable" },
    }) as unknown as { osmView: { snapshot: string } };

    expect(sanitised.osmView.snapshot).toBe("«931 cells, 0 regions»");
  });

  it("survives an empty state, because devtools sanitises before the first dispatch", () => {
    // A sanitiser that throws takes the whole app down through a devtools
    // extension the developer may not even know is installed.
    expect(() => summariseSnapshot({})).not.toThrow();
    expect(() =>
      summariseSnapshot({ osmView: { snapshot: undefined } }),
    ).not.toThrow();
  });
});

describe("subscribeToOsmView", () => {
  it("fires only when the selected value changes, not on every dispatch", () => {
    // ~931 polygons per redraw is the cost of getting this wrong.
    const { store, actions, subscribe } = createDemoStore({
      start: COLOGNE,
      category: "walkable",
    });
    const seen = vi.fn();
    subscribe((view) => view.snapshot, seen);

    store.dispatch(actions.showBelowThresholdChanged(true));
    store.dispatch(actions.cellSelected("cell-1"));
    expect(seen).not.toHaveBeenCalled();

    const first = snapshot(2);
    store.dispatch(actions.snapshotReady(first));
    expect(seen).toHaveBeenCalledTimes(1);
    // Asserted on the first argument only: the callback also receives the
    // PREVIOUS value, which several subscribers need (the 3D view rebuilds its
    // meshes only when the features behind them changed).
    expect(seen.mock.lastCall?.[0]).toBe(first);
    expect(seen.mock.lastCall?.[1]).toBeUndefined();
  });

  it("fires with `undefined` when a failed fetch clears the snapshot", () => {
    // The W1 path end to end: the map's subscriber must be TOLD the snapshot
    // is gone, or it has no reason to clear the cells it drew.
    const { store, actions, subscribe } = createDemoStore({
      start: COLOGNE,
      category: "walkable",
    });
    const seen = vi.fn();
    store.dispatch(actions.snapshotReady(snapshot(1)));
    subscribe((view) => view.snapshot, seen);

    store.dispatch(actions.fetchFailed("Overpass said no"));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.lastCall?.[0]).toBeUndefined();
  });

  it("stops firing once unsubscribed", () => {
    const { store, actions, subscribe } = createDemoStore({
      start: COLOGNE,
      category: "walkable",
    });
    const seen = vi.fn();
    const off = subscribe((view) => view.category, seen);
    store.dispatch(actions.categoryChanged("battleArea"));
    off();
    store.dispatch(actions.categoryChanged("restingArea"));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

/**
 * The store migration to `createSlamAppStore` (AR milestone 1).
 *
 * Why these tests matter: the migration was described in this file's own source
 * as "a one-line change" for a year, and it was not. The framework's factory
 * hardcoded its dev-check exemptions, so adopting it naively would have
 * reintroduced a **measured 71 ms per dispatch** — the deep serialisability
 * walk over ~931 scored cells — in exactly the builds someone uses to judge
 * whether the app feels fast. That regression is invisible: nothing fails, the
 * app just gets slower in development.
 *
 * So the exemption is pinned, and so is the framework state AR needs, because
 * "the store still works" is not the property the migration was for.
 */
describe("the demo store after the framework migration", () => {
  it("does not warn about the snapshot it deliberately exempts", () => {
    // The 71 ms regression, as an observable. RTK's serializable check reports
    // through `console.error`, so a lost exemption is a stream of complaints
    // rather than a failure — which is why this asserts on the console rather
    // than on a timing.
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });

    demo.store.dispatch(demo.actions.snapshotReady(snapshot(931)));

    const complaints = error.mock.calls
      .flat()
      .filter((arg) => typeof arg === "string" && arg.includes("serializable"));
    expect(complaints).toEqual([]);
    error.mockRestore();
  });

  it("carries the framework GPS state that AR mode reads", () => {
    // THE REASON THE MIGRATION HAPPENED. Without these slices the AR origin
    // (`selectZeroReference`) and the alignment subscription have nothing to
    // read, and the failure would appear only once someone entered AR.
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    const state = demo.store.getState() as Record<string, unknown>;

    for (const slice of ["gpsData", "arElements", "tracking"]) {
      expect(state, `${slice} must exist for the AR wiring`).toHaveProperty(
        slice,
      );
    }
  });

  it("still exposes the demo's own slice unchanged", () => {
    // The counterweight: the migration must not have moved the demo's state.
    const demo = createDemoStore({ start: COLOGNE, category: "walkable" });
    expect(selectOsmView(demo.store.getState()).category).toBe("walkable");
  });
});
