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

// NARROW SUBPATHS, NOT THE BARREL. The framework's root export pulls in
// Leaflet (for the minimap overlay), which touches `window` at import time —
// so importing it here breaks every node-environment test that reaches the
// store, and drags a mapping library into the demo's bundle for a store
// factory. The subpaths are the published entry points for exactly this.
import {
  createOsmViewSlice,
  createSlamAppStore,
  type OsmViewState,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { GeoEvent, LatLng } from "gps-plus-slam-osm";

import type { DemoSnapshot } from "./demo-pipeline.js";
import { DEFAULT_GROUND_MODE } from "./ground-mode.js";
import { DEFAULT_LAYERS, type LayerSet } from "./layers.js";

/**
 * The demo's root state.
 *
 * **`osmView` is the only slice the demo WRITES**, and it is the only one named
 * here — but the store also carries the framework's `gpsData`, `gpsElements`,
 * `arElements`, `recording`, `tracking` and `trackingQuality` since the AR
 * migration. Those are read through the framework's own selectors
 * (`selectZeroReference`, `selectAlignmentMatrix`), which take the library's
 * root type, so re-declaring them here would be a second, divergable copy of a
 * shape the framework owns.
 */
export interface DemoRootState {
  readonly osmView: OsmViewState<DemoSnapshot, GeoEvent>;
}

export interface CreateDemoStoreOptions {
  readonly start: LatLng;
  readonly category: string;
}

/**
 * The layer set, narrowed back to the demo's own union.
 *
 * The slice stores it structurally as `Record<string, boolean>` because the
 * framework is published and cannot name an OSM type (DEC-R2-18). This is the one
 * place the two meet.
 *
 * NO CAST IS NEEDED, and that is worth knowing rather than rediscovering: an index
 * signature over `string` already satisfies every specific key, so
 * `Record<string, boolean>` is assignable to `Record<LayerKind, boolean>` directly.
 * The safety comes from the write side instead — `toggleLayer` is exhaustive over
 * the union by construction, and `parseLayers` discards names it does not know, so
 * a key outside the union can never enter the store.
 */
export function selectLayers(state: DemoRootState): LayerSet {
  return selectOsmView(state).layers;
}

/** The slice's state, from the root. The one place the mount key is named. */
export function selectOsmView(
  state: DemoRootState,
): OsmViewState<DemoSnapshot, GeoEvent> {
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
          : // `cellCount`, NOT `cells.length` (round 10, stage B). The array is
            // omitted from the snapshot whenever the `cells` layer is off, which
            // is the shipped default — so `cells.length` reads 0 for every real
            // snapshot while the status line reports thousands. A summariser
            // exists precisely to say how big the thing is, and that one would
            // have said zero forever. Raised in review on #254.
            `«${snapshot.cellCount} cells, ${snapshot.regions.length} regions»`,
    },
  } as S;
}

/**
 * Builds the store, its action creators and a change-only subscriber.
 *
 * **Backed by the framework's `createSlamAppStore` since AR milestone 1**, so
 * the library's GPS/AR reducers are present for the alignment wiring to read.
 * The demo dispatches none of them itself; AR mode does.
 */
export function createDemoStore(options: CreateDemoStoreOptions) {
  const slice = createOsmViewSlice<DemoSnapshot, GeoEvent>({
    initialPosition: options.start,
    initialCategory: options.category,
    initialLayers: DEFAULT_LAYERS,
    // The picker names its own modes; the slice only stores the string (W11).
    initialGroundMode: DEFAULT_GROUND_MODE,
  });

  /**
   * THE FRAMEWORK'S FACTORY, not a bare `configureStore` (AR milestone 1).
   *
   * The comment this replaces said switching was "a one-line change… the slice
   * is identical either way". The SLICE is; the MIDDLEWARE was not. Until
   * 2026-08-12 the factory hardcoded its dev-check exemptions to the
   * framework's own `tracking` slice with no consumer hook, so adopting it
   * meant either paying the 71 ms scan documented below on every dispatch or
   * turning every dev check off. The factory now APPENDS caller-supplied
   * exemptions to its own, which is what makes this migration honest rather
   * than a silent regression.
   *
   * WHY MIGRATE AT ALL: AR mode reads the framework's GPS state. The origin
   * comes from `selectZeroReference`, and `enableArWorldGroupAlignment`
   * subscribes to the alignment matrix — neither exists in a store holding
   * only this demo's view slice.
   */
  const store = createSlamAppStore({
    // NOTHING IS PERSISTED BY THIS DEMO. The backend bridges Redux actions to
    // durable storage for recording sessions; this demo records nothing, and a
    // real backend here would start writing GPS actions to OPFS behind the
    // user's back.
    storageBackend: new NullStorageBackend(),
    extraReducers: { osmView: slice.reducer },
    /**
     * The snapshot is exempt from the deep serialisability scan.
     *
     * MEASURED, not assumed: with it included, RTK logged
     * "SerializableStateInvariantMiddleware took 71ms, more than the warning
     * threshold of 32ms" on every action — it walks ~931 cells and their
     * provenance records twice per dispatch, in development, which is exactly
     * when someone is trying to judge whether the app feels fast.
     *
     * Nothing is given up. The guarantee moves from a runtime scan to a test:
     * `demo-pipeline.test.ts` drives the real producer and asserts the
     * snapshot it emits survives a JSON round-trip, and the framework slice
     * has the same property over arbitrary action sequences. A `Map` sneaking
     * into the snapshot fails a gate there instead of printing a
     * `console.error` nobody reads.
     *
     * The pointer matters: the round-trip assertion lived in
     * `osm-store.test.ts` for one commit before moving, and the test left
     * behind there deliberately no longer guards the snapshot — it covers the
     * REST of the state, which is still scanned.
     *
     * THE STATE PATH IS ONLY HALF OF IT: the middleware scans the dispatched
     * ACTION too, and `snapshotReady` carries the same ~931 cells as its
     * payload. Excluding the state alone left the per-dispatch scan exactly
     * where it was on every refresh. Taken from the action creator rather than
     * spelled out, so a slice rename cannot silently stop matching.
     */
    serializableIgnoredPaths: ["osmView.snapshot"],
    serializableIgnoredActions: [slice.actions.snapshotReady.type],
    immutableIgnoredPaths: ["osmView.snapshot"],
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
    select: (view: OsmViewState<DemoSnapshot, GeoEvent>) => T,
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
