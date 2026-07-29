/**
 * `osmView` — the shared state an OSM-affordance UI's views read from.
 *
 * WHY IT EXISTS. A demo with two write-only views and one input does not need a
 * store, and the OSM demo said so in as many words. That stopped being true once
 * it grew a 2D map, a 3D scene, a legend and a details panel that must agree
 * about one selected cell: wiring four views to each other imperatively is six
 * edges, and every one of them is a place the panel can end up explaining a cell
 * the map is no longer showing. One store is four edges and no ordering.
 *
 * WHY IT IS A FACTORY, GENERIC OVER THE SNAPSHOT. This package is published to
 * npm; `gps-plus-slam-osm` is not. A dependency on it — **including a type-only
 * import, which still lands in the published type declarations** — makes
 * `pnpm install` 404 for every consumer of this framework. That is the same
 * constraint `osm-bridge/opfs-osm-blob-store.ts` documents, and it is why this
 * module names no OSM type at all: the consumer supplies its own snapshot type
 * as `TSnapshot`, and the slice stores it without ever looking inside. The
 * alternative — hand-copying `CellScore`, `Region` and the demo's `DemoSnapshot`
 * into this package — would freeze a demo-owned shape into a published API with
 * no compiler link between the two copies.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD. Raw `OsmFeature` maps, Leaflet layers and
 * three.js objects. RTK's default middleware throws on non-serialisable state in
 * development, and the scored data is already plain objects and `Record`s for
 * exactly this reason. Features stay in the consumer's pipeline; this holds
 * scores and ids.
 *
 * @see osm-view-slice.ts.md
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * A WGS84 position.
 *
 * Declared structurally rather than imported from `gps-plus-slam-osm`, for the
 * publishing reason in the module header. It is two numbers and it is stable.
 */
export interface OsmViewLatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Where the refresh cycle is.
 *
 * `fetching` and `scoring` are separate because they differ by two orders of
 * magnitude — a res-7 Overpass tile is 18–110 s while scoring a working set is
 * milliseconds — so a UI that shows one label for both is telling the user
 * nothing about how long to wait.
 */
export type OsmViewLoadingPhase = 'idle' | 'fetching' | 'scoring' | 'error';

export interface OsmViewLoading {
  readonly phase: OsmViewLoadingPhase;
  /** Human-readable detail. Empty when idle. */
  readonly message: string;
}

/** The minimum that lets four views agree without any of them talking. */
export interface OsmViewState<TSnapshot> {
  /** Where the user is, real or simulated by a map click. */
  position: OsmViewLatLng;
  /** The affordance category being displayed. */
  category: string;
  /** Draw cells at or below the threshold too. */
  showBelowThreshold: boolean;
  /** The cell the details panel is explaining, or none. */
  selectedCell: string | undefined;
  loading: OsmViewLoading;
  /** Whatever the consumer's pipeline last produced. Opaque here. */
  snapshot: TSnapshot | undefined;
}

export interface CreateOsmViewSliceOptions {
  /**
   * Slice name, which also namespaces the action types. Defaults to `osmView`.
   * Override when one store mounts two of these.
   */
  readonly name?: string;
  readonly initialPosition: OsmViewLatLng;
  readonly initialCategory: string;
}

const IDLE: OsmViewLoading = { phase: 'idle', message: '' };

/**
 * Builds an `osmView` slice bound to the consumer's snapshot type.
 *
 * ```ts
 * const osmView = createOsmViewSlice<DemoSnapshot>({
 *   initialPosition: DEFAULT_START,
 *   initialCategory: 'walkable',
 * });
 * const store = configureStore({ reducer: { osmView: osmView.reducer } });
 * store.dispatch(osmView.actions.categoryChanged('battleArea'));
 * ```
 *
 * Returns the reducer and the action creators only. Selectors are left to the
 * consumer because the mount key is the consumer's choice — a selector here
 * would have to guess it, and guessing it wrongly fails at runtime rather than
 * at compile time.
 */
export function createOsmViewSlice<TSnapshot>(
  options: CreateOsmViewSliceOptions
) {
  const initialState: OsmViewState<TSnapshot> = {
    position: options.initialPosition,
    category: options.initialCategory,
    showBelowThreshold: false,
    selectedCell: undefined,
    loading: IDLE,
    snapshot: undefined,
  };

  const slice = createSlice({
    name: options.name ?? 'osmView',
    initialState,
    reducers: {
      /**
       * Move the user. Drops the selection: the selected cell belongs to the
       * place being left, and a details panel still explaining it after the map
       * has moved is the exact class of disagreement this store exists to make
       * impossible.
       */
      positionChanged(state, action: PayloadAction<OsmViewLatLng>) {
        return {
          ...state,
          position: action.payload,
          selectedCell: undefined,
        };
      },

      /**
       * Switch the displayed category. KEEPS the selection — "what does this
       * same cell score for `battleArea`?" is a question the details panel can
       * answer, and clearing it would make the obvious next click impossible.
       */
      categoryChanged(state, action: PayloadAction<string>) {
        return { ...state, category: action.payload };
      },

      showBelowThresholdChanged(state, action: PayloadAction<boolean>) {
        return { ...state, showBelowThreshold: action.payload };
      },

      /** Select a cell, or pass `undefined` to close the details panel. */
      cellSelected(state, action: PayloadAction<string | undefined>) {
        return { ...state, selectedCell: action.payload };
      },

      /**
       * A refresh has started. The previous snapshot deliberately STAYS: it is
       * still the last true picture, and blanking here would flash the map empty
       * on every click through an 18 s fetch.
       */
      fetchStarted(state, action: PayloadAction<string | undefined>) {
        return {
          ...state,
          loading: { phase: 'fetching', message: action.payload ?? '' },
        };
      },

      scoringStarted(state, action: PayloadAction<string | undefined>) {
        return {
          ...state,
          loading: { phase: 'scoring', message: action.payload ?? '' },
        };
      },

      snapshotReady(state, action: PayloadAction<TSnapshot>) {
        return { ...state, snapshot: action.payload, loading: IDLE };
      },

      /**
       * The DATA step failed — nothing new was produced.
       *
       * Clears the snapshot, and this is the whole point: leaving it up is the
       * reported defect, a map still drawing the previous category's cells under
       * a status line saying the refresh failed. The selection goes with it,
       * since the cell it names is no longer on screen.
       */
      fetchFailed(state, action: PayloadAction<string>) {
        return {
          ...state,
          snapshot: undefined,
          selectedCell: undefined,
          loading: { phase: 'error', message: action.payload },
        };
      },

      /**
       * A VIEW failed while drawing a valid snapshot.
       *
       * KEEPS the snapshot, and that is not an oversight. If the 3D scene throws
       * after the map has drawn, the map is showing exactly the right thing;
       * routing this through `fetchFailed` would blank a correct picture to
       * report a fault in the other view. Stale cells can only originate from a
       * data failure, so nothing is lost by the split.
       */
      renderFailed(state, action: PayloadAction<string>) {
        return {
          ...state,
          loading: { phase: 'error', message: action.payload },
        };
      },
    },
  });

  return { reducer: slice.reducer, actions: slice.actions };
}
