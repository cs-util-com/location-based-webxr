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
  stats: { chunksScored: 1, chunksReused: 0, geometryBuilt: 1 },
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
