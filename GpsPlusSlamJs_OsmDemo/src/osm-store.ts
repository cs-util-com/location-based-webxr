/**
 * The demo's store: one state, four views.
 *
 * WHY THIS EXISTS NOW AND DID NOT BEFORE. With two write-only views and one
 * input, `main.ts` driving both imperatively was the simpler and more debuggable
 * design, and `demo-pipeline.ts` said so. Round-1 feedback added a legend, a
 * details panel, a selected cell that three views must agree on, and a
 * below-threshold toggle that changes what two of them draw. Wiring four views
 * to each other is six edges, every one of which is a place the panel can end up
 * explaining a cell the map is no longer showing. One store is four edges and no
 * ordering question.
 *
 * WHAT STAYS OUT OF IT. Raw `OsmFeature` maps, Leaflet layers, three.js objects.
 * RTK throws on non-serialisable state in development, and the merged features
 * are a `Map` — they stay in `DemoPipeline`, which is also where they are
 * cheapest to keep. The store holds scored data and ids.
 *
 * WHY THE VIEWS DO NOT IMPORT IT. Each view keeps a plain `render(...)` taking
 * the data it draws, and this module's `subscribe` calls them. A view that
 * imported the store would be untestable without one and would know about state
 * it has no business reading — the seam that makes "is the data wrong or the
 * drawing wrong?" answerable is the same seam that makes the views mockable.
 *
 * @see osm-store.ts.md
 */

import { configureStore } from "@reduxjs/toolkit";
import {
  createOsmViewSlice,
  type OsmViewState,
} from "gps-plus-slam-app-framework/state";
import type { LatLng } from "gps-plus-slam-osm";

import type { DemoSnapshot } from "./demo-pipeline.js";

/** The demo's root state. One slice; the demo has no other durable state. */
export interface DemoRootState {
  readonly osmView: OsmViewState<DemoSnapshot>;
}

export interface CreateDemoStoreOptions {
  readonly start: LatLng;
  readonly category: string;
}

/** The slice's state, from the root. The one place the mount key is named. */
export function selectOsmView(
  state: DemoRootState,
): OsmViewState<DemoSnapshot> {
  return state.osmView;
}

/**
 * Replaces the snapshot with a one-line summary before devtools sees it.
 *
 * The snapshot is ~931 cells each carrying a provenance record, and devtools
 * serialises the WHOLE state on every action. Left in, it is comfortably the
 * slowest thing in the app — and it is also the least useful thing to read in a
 * devtools pane, where "931 cells" answers the question the expanded tree does
 * not. The framework's own store sanitises for the same reason.
 *
 * The two casts are the devtools API's doing: its `stateSanitizer` is typed
 * `<S>(state: S) => S`, i.e. "return the same type you were given", which no
 * sanitiser can honestly satisfy — replacing a field with a summary string is
 * the entire job. The narrowing is safe because this store has exactly one
 * reducer and this function is only ever given its root.
 */
export function summariseSnapshot<S>(state: S): S {
  const root = state as DemoRootState;
  const snapshot = root.osmView?.snapshot;
  return {
    ...root,
    osmView: {
      ...root.osmView,
      snapshot:
        snapshot === undefined
          ? undefined
          : `«${snapshot.cells.length} cells, ${snapshot.regions.length} regions»`,
    },
  } as S;
}

/**
 * Builds the store, its action creators and a change-only subscriber.
 *
 * A plain `configureStore` rather than the framework's `createSlamAppStore`:
 * that factory wires the library's GPS/AR reducers, licence validation and
 * persistence middleware, none of which this demo has. The slice is identical
 * either way, so switching to it if AR mode ever arrives is a one-line change.
 */
export function createDemoStore(options: CreateDemoStoreOptions) {
  const slice = createOsmViewSlice<DemoSnapshot>({
    initialPosition: options.start,
    initialCategory: options.category,
  });

  const store = configureStore({
    reducer: { osmView: slice.reducer },
    devTools: { stateSanitizer: summariseSnapshot },
    middleware: (getDefault) =>
      getDefault({
        /**
         * The snapshot is exempt from the deep serialisability scan.
         *
         * MEASURED, not assumed: with it included, RTK logged
         * "SerializableStateInvariantMiddleware took 71ms, more than the
         * warning threshold of 32ms" on every action — it walks ~931 cells and
         * their provenance records twice per dispatch, in development, which is
         * exactly when someone is trying to judge whether the app feels fast.
         *
         * Nothing is given up. The guarantee moves from a runtime scan to a
         * test: `osm-store.test.ts` asserts a real `DemoSnapshot` survives a
         * JSON round-trip, and the framework slice has the same property over
         * arbitrary action sequences. A `Map` sneaking into the snapshot fails
         * there instead of in a console warning nobody reads.
         */
        serializableCheck: {
          ignoredPaths: ["osmView.snapshot"],
          /**
           * The STATE path above is only half of it: the middleware scans the
           * dispatched ACTION too, and `snapshotReady` carries the same ~931
           * cells as its payload. Excluding the state alone left the per-
           * dispatch scan exactly where it was on every refresh.
           *
           * Written as an action TYPE rather than a path, and taken from the
           * action creator rather than spelled out, so a change to the slice's
           * name cannot silently stop matching.
           */
          ignoredActions: [slice.actions.snapshotReady.type],
        },
      }),
  });

  /**
   * Calls `onChange` when `select`'s result changes by reference.
   *
   * Reference equality, not deep equality: every producer here returns a fresh
   * object per refresh and the same object otherwise, so `!==` is both correct
   * and free. Deep-comparing ~931 cells to decide whether to redraw them would
   * cost more than the redraw.
   */
  function subscribe<T>(
    select: (view: OsmViewState<DemoSnapshot>) => T,
    onChange: (current: T, previous: T | undefined) => void,
  ): () => void {
    let previous = select(selectOsmView(store.getState()));
    return store.subscribe(() => {
      const current = select(selectOsmView(store.getState()));
      if (current === previous) return;
      const before = previous;
      previous = current;
      onChange(current, before);
    });
  }

  return { store, actions: slice.actions, subscribe };
}

export type DemoStore = ReturnType<typeof createDemoStore>;
