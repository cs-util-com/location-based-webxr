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

import {
  createSlice,
  type ActionCreatorWithOptionalPayload,
  type ActionCreatorWithPayload,
  type PayloadAction,
  type Reducer,
} from '@reduxjs/toolkit';

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
 * magnitude — a res-7 Overpass tile is ~15–90 s while scoring a working set is
 * milliseconds — so a UI that shows one label for both is telling the user
 * nothing about how long to wait.
 */
export type OsmViewLoadingPhase = 'idle' | 'fetching' | 'scoring' | 'error';

export interface OsmViewLoading {
  readonly phase: OsmViewLoadingPhase;
  /** Human-readable detail. Empty when idle. */
  readonly message: string;
}

/**
 * The minimum that lets four views agree without any of them talking.
 *
 * `TGeoEvent` defaults to `never`, so a consumer that has no geo-events writes
 * `OsmViewState<DemoSnapshot>` exactly as before and its `geoEvent` can only
 * ever be `undefined`.
 */
export interface OsmViewState<TSnapshot, TGeoEvent = never> {
  /** Where the user is, real or simulated by a map click. */
  position: OsmViewLatLng;
  /** The affordance category being displayed. */
  category: string;
  /** Draw cells at or below the threshold too. */
  showBelowThreshold: boolean;
  /**
   * Which render layers are enabled, by name.
   *
   * DELIBERATELY STRUCTURAL — `Record<string, boolean>` rather than the consumer's
   * own union. This package is published and `gps-plus-slam-osm` is not, so **any**
   * reference to it (including a type-only import, which lands in the emitted
   * `.d.ts`) makes `pnpm install` 404 for every consumer. That constraint is already
   * recorded in `osm-bridge/opfs-osm-blob-store.ts` and it is why `TSnapshot` is a
   * generic; a layer union would hit the same wall for the same reason.
   *
   * The consumer narrows it at its selector. The slice only has to store and replace
   * it, which needs no knowledge of the names at all.
   */
  layers: Readonly<Record<string, boolean>>;
  /**
   * Which surface the consumer draws as the ground, by name.
   *
   * A STRING for the same publish-boundary reason as `layers`: this package is
   * published and `gps-plus-slam-osm` is not, so naming the consumer's union
   * here would 404 every install. The consumer narrows it at its selector.
   *
   * A MODE RATHER THAN A LAYER, and the distinction is the consumer's: layers
   * are things the scene can draw, each independently, while this is one thing
   * drawn different ways and is therefore exclusive.
   */
  groundMode: string;
  /** The cell the details panel is explaining, or none. */
  selectedCell: string | undefined;
  /**
   * The map FEATURE the details panel is describing, or none.
   *
   * Mutually exclusive with `selectedCell`: there is one panel, so there is one
   * selection. Holding both would make the panel's contents depend on which
   * branch of the renderer ran last.
   */
  selectedFeature: OsmViewFeature | undefined;
  /**
   * The affordance REGION the details panel is describing, or none.
   *
   * Mutually exclusive with the other two, for the same reason they are with
   * each other: there is one panel, so there is one selection. A region is the
   * coarse claim and a cell the fine one, and both are clickable in both views,
   * so without exclusivity the panel's contents would depend on which branch of
   * which renderer ran last.
   *
   * A REGION ID, not the region. Ids are unstable across a refresh — two regions
   * merging as more data loads changes BOTH their ids — so the consumer resolves
   * this against the current snapshot and drops the selection when it no longer
   * exists. Holding the object would show numbers from a region that is gone.
   */
  selectedRegion: string | undefined;
  loading: OsmViewLoading;
  /** Whatever the consumer's pipeline last produced. Opaque here. */
  snapshot: TSnapshot | undefined;
  /**
   * The geo-event the consumer last found, or none.
   *
   * A SECOND OPAQUE PAYLOAD, for the same publish-boundary reason `TSnapshot` is
   * one: a geo-event is a `gps-plus-slam-osm` type, and naming it here — even in
   * a type-only import, which still lands in the emitted `.d.ts` — would 404
   * every consumer's install. The slice stores it and never looks inside.
   *
   * WHY IT IS STATE AND NOT A LAYER THE CONSUMER OWNS. It used to go straight
   * from the worker into a Leaflet layer, which made it the one overlay in the
   * view that was not a projection of this state: nothing could clear it, no
   * other view could react to it, and a category switch left the previous
   * category's events sitting over the new category's cells. That was the
   * reported defect.
   *
   * CLEARED BY `categoryChanged` and `fetchFailed`, KEPT by `positionChanged`.
   * The asymmetry is the point and is not an oversight — see those reducers.
   */
  geoEvent: TGeoEvent | undefined;
}

/**
 * A selected map feature, STRUCTURALLY.
 *
 * The same publish-boundary rule as `layers`: this package is on npm and
 * `gps-plus-slam-osm` is not, so a type-only import of `PoiMarker` here would 404
 * every consumer's install. Three plain strings are all the panel needs, and TS
 * structural typing means a consumer can hand a `PoiMarker` straight in.
 */
export interface OsmViewFeature {
  /** Stable id, e.g. `node/4242`. */
  readonly feature: string;
  /** `key=value` of the primary tag, e.g. `amenity=cafe`. */
  readonly kind: string;
  /** A short human label. */
  readonly label: string;
}

export interface CreateOsmViewSliceOptions {
  /**
   * Slice name, which also namespaces the action types. Defaults to `osmView`.
   * Override when one store mounts two of these.
   */
  readonly name?: string;
  readonly initialPosition: OsmViewLatLng;
  readonly initialCategory: string;
  /** Layers on at start. Defaults to none, so a consumer must opt in. */
  readonly initialLayers?: Readonly<Record<string, boolean>>;
  /** Ground mode at start. Defaults to empty — the consumer names its own. */
  readonly initialGroundMode?: string;
}

const IDLE: OsmViewLoading = { phase: 'idle', message: '' };

/**
 * The slice's action creators, WRITTEN OUT rather than inferred.
 *
 * WHY THIS EXISTS, because "the compiler already knew this" is the obvious
 * objection. It did — until the slice gained its second type parameter. The
 * declaration emitter (`rolldown-plugin-dts`) inlines the inferred reducers map
 * for a one-parameter generic and gives up on a two-parameter one, falling back
 * to `CaseReducerActions<SliceCaseReducers<State>, string>`. That fallback has
 * an INDEX SIGNATURE, so under `noUncheckedIndexedAccess` every consumer sees
 * `slice.actions.snapshotReady` as possibly `undefined` and cannot call any of
 * them. Verified by building both ways: the demo's typecheck went from clean to
 * 19 errors on `Cannot invoke an object which is possibly 'undefined'`.
 *
 * So this is a workaround for a build-tool limitation — and it pays for itself,
 * because the published surface of a published package is now stated rather
 * than inferred, and a reducer signature changing under a consumer becomes a
 * compile error here instead of a silent API change.
 *
 * The type argument on each creator is the ACTION TYPE STRING, which is `string`
 * rather than a literal because `options.name` decides it at runtime.
 */
export interface OsmViewActions<TSnapshot, TGeoEvent> {
  positionChanged: ActionCreatorWithPayload<OsmViewLatLng, string>;
  placeChanged: ActionCreatorWithPayload<OsmViewLatLng, string>;
  categoryChanged: ActionCreatorWithPayload<string, string>;
  showBelowThresholdChanged: ActionCreatorWithPayload<boolean, string>;
  groundModeChanged: ActionCreatorWithPayload<string, string>;
  layersChanged: ActionCreatorWithPayload<
    Readonly<Record<string, boolean>>,
    string
  >;
  cellSelected: ActionCreatorWithOptionalPayload<string | undefined, string>;
  featureSelected: ActionCreatorWithOptionalPayload<
    OsmViewFeature | undefined,
    string
  >;
  regionSelected: ActionCreatorWithOptionalPayload<string | undefined, string>;
  fetchStarted: ActionCreatorWithOptionalPayload<string | undefined, string>;
  scoringStarted: ActionCreatorWithOptionalPayload<string | undefined, string>;
  snapshotReady: ActionCreatorWithPayload<TSnapshot, string>;
  geoEventFound: ActionCreatorWithOptionalPayload<
    TGeoEvent | undefined,
    string
  >;
  fetchFailed: ActionCreatorWithPayload<string, string>;
  nonFatalError: ActionCreatorWithPayload<string, string>;
}

/** What {@link createOsmViewSlice} hands back. Named for the same reason. */
export interface OsmViewSlice<TSnapshot, TGeoEvent> {
  reducer: Reducer<OsmViewState<TSnapshot, TGeoEvent>>;
  actions: OsmViewActions<TSnapshot, TGeoEvent>;
}

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
/**
 * A position with signed zero normalised away.
 *
 * WHY THE STORE CANNOT HOLD `-0`. This state is persisted and inspected through
 * devtools, so it must survive a JSON round-trip — and `-0` does not:
 * `JSON.stringify(-0)` is `"0"`, so a `-0` latitude reloads as `0` and the state
 * that comes back is not the state that went in. RTK's serialisability check
 * does not catch it, because `-0` IS serialisable; it simply is not
 * round-trippable, which is the stronger property the store actually needs.
 *
 * Nothing is lost by normalising: `-0 === 0` is true and both denote the same
 * point on the equator or the prime meridian, so no consumer can tell them
 * apart except by `Object.is`.
 *
 * Found 2026-07-31 by `osm-view-slice.property.test.ts`, which generates
 * latitudes with `fc.double` and therefore reaches `-0` roughly one run in
 * fifty — it had passed on the same code an hour earlier. `snapshotReady` is
 * the only other numeric payload and takes `fc.nat()`, which cannot produce a
 * negative zero, so this is the sole source.
 */
function withoutSignedZero(position: OsmViewLatLng): OsmViewLatLng {
  return {
    // `x === 0` is true for BOTH zeroes, so this maps -0 to +0 and leaves every
    // other value untouched.
    lat: position.lat === 0 ? 0 : position.lat,
    lng: position.lng === 0 ? 0 : position.lng,
  };
}

export function createOsmViewSlice<TSnapshot, TGeoEvent = never>(
  options: CreateOsmViewSliceOptions
): OsmViewSlice<TSnapshot, TGeoEvent> {
  const initialState: OsmViewState<TSnapshot, TGeoEvent> = {
    // Normalised here too, not only in `positionChanged`: `initialPosition` is
    // consumer input, so without this the very first state could violate the
    // round-trip invariant before any action was ever dispatched.
    position: withoutSignedZero(options.initialPosition),
    category: options.initialCategory,
    showBelowThreshold: false,
    layers: options.initialLayers ?? {},
    groundMode: options.initialGroundMode ?? '',
    selectedCell: undefined,
    selectedFeature: undefined,
    selectedRegion: undefined,
    loading: IDLE,
    snapshot: undefined,
    geoEvent: undefined,
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
       *
       * KEEPS the geo-event, and the asymmetry with the selection is deliberate.
       * A geo-event is a pure function of tile and time, so moving cannot make
       * it untrue — and the consumer's label reads "640 m NE", which is an
       * instruction to walk there. Dropping it on the first step would delete
       * the thing the user is navigating towards.
       */
      positionChanged(state, action: PayloadAction<OsmViewLatLng>) {
        return {
          ...state,
          position: withoutSignedZero(action.payload),
          selectedCell: undefined,
          selectedFeature: undefined,
          selectedRegion: undefined,
        };
      },

      /**
       * The user DECLARED they are somewhere else — a location picker, a jump to
       * a named site. Everything `positionChanged` does, plus the snapshot and
       * the geo-event.
       *
       * WHY THIS IS A SECOND ACTION RATHER THAN A FLAG (DEC-R12-8). The eighth
       * OSM testing session jumped New York -> London and watched New York's
       * buildings stay on screen for the 20-30 s the next Overpass fetch took,
       * under a status line already naming London. Nothing was stale in the sense
       * the existing guards check: the snapshot was the last TRUE picture of a
       * place the user had said they were leaving. Two intents, two actions —
       * `positionChanged` carries no mode flag, so an existing consumer cannot
       * accidentally acquire this behaviour, and a walk cannot accidentally lose
       * a scene it is about to redraw almost identically.
       *
       * CLEARS THE GEO-EVENT, which is the one exception to the asymmetry
       * `positionChanged` documents (DEC-R12-10). "640 m NE" is an instruction to
       * walk there; it survives a step and does not survive a teleport across an
       * ocean.
       *
       * LEAVES THE PRESENTATION ALONE — category, layers, ground mode. Those are
       * how the user is looking rather than where they are, and resetting them
       * would make the picker a settings reset.
       */
      placeChanged(state, action: PayloadAction<OsmViewLatLng>) {
        return {
          ...state,
          position: withoutSignedZero(action.payload),
          selectedCell: undefined,
          selectedFeature: undefined,
          selectedRegion: undefined,
          snapshot: undefined,
          geoEvent: undefined,
        };
      },

      /**
       * Switch the displayed category. KEEPS the selection — "what does this
       * same cell score for `battleArea`?" is a question the details panel can
       * answer, and clearing it would make the obvious next click impossible.
       *
       * CLEARS the geo-event, and that is the opposite call for the opposite
       * reason. The selection is a place, which means the same thing in every
       * category; an event is an ANSWER, computed against one category's scores
       * and its threshold. Keeping it is how the session ended up looking at
       * walkable events sitting on battle-area cells.
       */
      categoryChanged(state, action: PayloadAction<string>) {
        return { ...state, category: action.payload, geoEvent: undefined };
      },

      showBelowThresholdChanged(state, action: PayloadAction<boolean>) {
        return { ...state, showBelowThreshold: action.payload };
      },

      /**
       * Switch which surface is drawn as the ground.
       *
       * Kept out of `layersChanged` deliberately: a layer set is a set of
       * independent switches and this is exclusive, so merging them would make
       * "no ground" expressible as more than one state.
       */
      groundModeChanged(state, action: PayloadAction<string>) {
        return { ...state, groundMode: action.payload };
      },

      /**
       * Replaces the whole layer set.
       *
       * WHOLE-SET REPLACEMENT rather than a `{ layer, enabled }` pair, and the
       * reason is the publish boundary: a per-layer action would want the
       * consumer's layer union as its payload type, and this package cannot name
       * an OSM type. The consumer computes the next set with its own exhaustive
       * helper and hands the result over, which also keeps the reducer free of any
       * opinion about what a valid layer name is.
       */
      layersChanged(
        state,
        action: PayloadAction<Readonly<Record<string, boolean>>>
      ) {
        return { ...state, layers: action.payload };
      },

      /**
       * Select a cell, or pass `undefined` to close the details panel.
       *
       * CLEARS any selected feature: one panel, one selection.
       */
      cellSelected(state, action: PayloadAction<string | undefined>) {
        return {
          ...state,
          selectedCell: action.payload,
          selectedFeature: undefined,
          selectedRegion: undefined,
        };
      },

      /**
       * Select a map feature, or pass `undefined` to close the panel.
       *
       * CLEARS any selected cell, for the same reason `cellSelected` clears this.
       */
      featureSelected(
        state,
        action: PayloadAction<OsmViewFeature | undefined>
      ) {
        return {
          ...state,
          selectedFeature: action.payload,
          selectedCell: undefined,
          selectedRegion: undefined,
        };
      },

      /**
       * Select an affordance region by id, or pass `undefined` to close.
       *
       * CLEARS the other two, for the same reason they clear each other.
       */
      regionSelected(state, action: PayloadAction<string | undefined>) {
        return {
          ...state,
          selectedRegion: action.payload,
          selectedCell: undefined,
          selectedFeature: undefined,
        };
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

      /**
       * THE CAST IS THE PRICE OF TWO OPAQUE PAYLOADS, and it is the same
       * workaround the file header already describes for one. `state` is an
       * immer `Draft`, so spreading it yields
       * `TGeoEvent extends object ? Draft<TGeoEvent> : TGeoEvent` for the
       * geo-event, while `action.payload` here is a raw `TSnapshot` — so the
       * result matches neither the draft type (wrong snapshot) nor the plain
       * one (wrong geo-event), and there is no annotation that satisfies both
       * without breaking RTK's contravariant `state` parameter.
       *
       * It is sound because these reducers build a fresh object and never
       * mutate, so no draft ever escapes; only the two reducers with a generic
       * payload need it.
       */
      snapshotReady(state, action: PayloadAction<TSnapshot>) {
        return {
          ...state,
          snapshot: action.payload,
          loading: IDLE,
        } as OsmViewState<TSnapshot, TGeoEvent>;
      },

      /**
       * The consumer found a geo-event, or `undefined` to take it down.
       *
       * ONE FIELD, so two sets of events cannot coexist by construction — the
       * reading the session could not settle is unrepresentable rather than
       * merely untested.
       *
       * `undefined` is a first-class payload rather than a separate
       * `geoEventCleared` action: a second action would be a second way to
       * reach the same state, and the consumer's renderer already takes
       * `undefined` to mean "clear the layer".
       */
      geoEventFound(state, action: PayloadAction<TGeoEvent | undefined>) {
        return { ...state, geoEvent: action.payload } as OsmViewState<
          TSnapshot,
          TGeoEvent
        >;
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
          selectedFeature: undefined,
          // A REGION ID CANNOT OUTLIVE THE SNAPSHOT IT NAMES. Unlike a cell id,
          // which is an H3 index and means the same thing in any snapshot, a
          // region id is the lowest-sorting cell of a flood fill — so with no
          // snapshot there is nothing it could resolve against.
          selectedRegion: undefined,
          // AND THE GEO-EVENT, for the reason this action exists at all. It
          // empties the map of cells, regions and fetch boxes; markers left
          // standing on that blank map are the stale overlay in its purest form.
          geoEvent: undefined,
          loading: { phase: 'error', message: action.payload },
        };
      },

      /**
       * An error that must NOT discard the snapshot.
       *
       * KEEPS the snapshot, and that is not an oversight. If the 3D scene throws
       * after the map has drawn, the map is showing exactly the right thing;
       * routing this through `fetchFailed` would blank a correct picture to
       * report a fault in the other view. Stale cells can only originate from a
       * data failure, so nothing is lost by the split.
       *
       * NAMED FOR THE GUARANTEE, NOT THE ORIGIN. This was `renderFailed`, which
       * described where the first caller happened to be rather than what the
       * action promises — and the second caller was already a refused GPS
       * permission, which is not a render failure by any reading. The invariant
       * consumers depend on is "the snapshot survives"; the name now says so, so
       * a caller can tell which of the two error actions it wants without
       * reading the reducer. Renamed while the slice was still unreleased
       * (published framework was 1.14.0; the slice ships in 1.15.0), so no
       * deprecated alias is needed.
       */
      nonFatalError(state, action: PayloadAction<string>) {
        return {
          ...state,
          loading: { phase: 'error', message: action.payload },
        };
      },
    },
  });

  return {
    reducer: slice.reducer,
    /**
     * THE ONE CAST, and where the guarantee it gives up is bought back.
     *
     * RTK types a creator whose payload is a bare generic as a CONDITIONAL —
     * `IfVoid<TSnapshot, …, IfMaybeUndefined<TSnapshot, …, …>>` — which TS
     * cannot resolve while `TSnapshot` is still a type parameter, so it cannot
     * be shown assignable to anything written by hand. The cast is therefore
     * unavoidable given the declared return type, which itself is unavoidable
     * given the emitter's two-generic limitation (see {@link OsmViewActions}).
     *
     * WHAT REPLACES THE CHECK: `osm-view-slice.test.ts` assigns these actions to
     * `OsmViewActions<TestSnapshot, TestGeoEvent>` at CONCRETE type arguments,
     * where every conditional resolves and the comparison is real. Add a
     * reducer without adding it to the interface and that assignment fails
     * under `typecheck:tests`.
     */
    actions: slice.actions as unknown as OsmViewActions<TSnapshot, TGeoEvent>,
  };
}
