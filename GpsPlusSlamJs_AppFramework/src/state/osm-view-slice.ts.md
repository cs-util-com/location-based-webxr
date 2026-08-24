# `osm-view-slice.ts`

**Purpose.** A Redux Toolkit slice factory holding the state that several OSM-affordance views must agree on — the user's position, the displayed category, the sub-threshold toggle, the selected cell, the refresh phase, the last computed snapshot, and the last found geo-event.

## Public API

- `createOsmViewSlice<TSnapshot, TGeoEvent = never>(options)` → `{ reducer, actions }`
  - `options.name` — slice name, which namespaces the action types. Defaults to `osmView`. Override when one store mounts two of these.
  - `options.initialPosition: OsmViewLatLng`, `options.initialCategory: string` — required; the slice has no opinion about where or what a consumer starts on.
  - Generic over `TSnapshot`: whatever the consumer's pipeline produces. The slice never inspects it.
  - Generic over `TGeoEvent` too, defaulting to `never`. A consumer with no geo-events writes `createOsmViewSlice<DemoSnapshot>(…)` exactly as before, and its `geoEvent` can then only ever be `undefined`.
- Actions
  - `positionChanged(OsmViewLatLng)` — moves the user, **clears `selectedCell`**, **keeps `snapshot` and `geoEvent`**. This is TRAVEL: a step, a map click, a GPS fix.
  - `placeChanged(OsmViewLatLng)` — the user DECLARED they are somewhere else (a location picker, a jump to a named site). Everything `positionChanged` does, plus **clears `snapshot` and `geoEvent`**; leaves category, layers and ground mode alone.
  - `categoryChanged(string)` — switches category, **keeps `selectedCell`**, **clears `geoEvent`**.
  - `showBelowThresholdChanged(boolean)`, `cellSelected(string | undefined)`.
  - `fetchStarted(message?)`, `scoringStarted(message?)` — phase only; the previous snapshot stays.
  - `snapshotReady(TSnapshot)` — stores it and returns to `idle`.
  - `geoEventFound(TGeoEvent | undefined)` — stores one, or takes it down. `undefined` is a first-class payload rather than a second `geoEventCleared` action, so there is one way to reach the state.
  - `fetchFailed(message)` — **clears the snapshot, the selection and the geo-event**, phase `error`.
  - `nonFatalError(message)` — phase `error`, **snapshot, selection and geo-event untouched**.
- Types: `OsmViewState<TSnapshot, TGeoEvent>`, `OsmViewLatLng`, `OsmViewLoading`, `OsmViewLoadingPhase`, `CreateOsmViewSliceOptions`.

No selectors are exported. The mount key is the consumer's choice, so a selector here would have to guess it — and guess wrongly at runtime rather than at compile time.

## Invariants & assumptions

- **`fetchFailed` and `nonFatalError` are not interchangeable, and merging them is a defect.** A data failure means nothing new was produced, so any picture still on screen is a claim nothing supports — it must go. A view failure means the snapshot is valid and the _other_ view drew it correctly; discarding it would blank a correct picture to report a fault elsewhere. Stale cells can only originate from a data failure, so the split loses nothing. Pinned by `osm-view-slice.property.test.ts` over arbitrary action sequences.
- **The state must stay JSON-serialisable.** RTK's default middleware throws on non-serialisable state in development. Never put a `Map`, a `Set`, a Leaflet layer or a three.js object in here — raw feature maps belong in the consumer's pipeline. Pinned by a round-trip property test.
- **And ROUND-TRIPPABLE, which is stronger than serialisable.** `positionChanged` normalises signed zero, because `JSON.stringify(-0)` is `"0"` — so a `-0` latitude reloads as `0` and the state that comes back is not the state that went in. RTK's check does not catch this: `-0` is perfectly serialisable, it simply does not survive the trip. Nothing is lost, since `-0 === 0` and both denote the same point; only `Object.is` can tell them apart. Found 2026-07-31 by the property test, which reaches `-0` through `fc.double` roughly one run in fifty and had passed on identical code an hour earlier — so there is now a deterministic example test beside it rather than a seed lottery.
- **The geo-event's clearing rules are asymmetric with the selection's, deliberately.** A _position_ change drops the selection but KEEPS the event: an event is a pure function of tile and time, so moving cannot make it untrue, and the consumer's label reads "640 m NE" — an instruction to walk there, which clearing on the first step would delete. A _category_ change does the opposite: it keeps the selection, because a place means the same thing in every category, and clears the event, because an event is an ANSWER computed against one category's scores and threshold. Getting these backwards is how the reported bug looked — walkable events sitting on battle-area cells.
- **Travel and a declared place change are two ACTIONS, not one action with a flag (DEC-R12-8).** The eighth OSM testing session jumped New York → London and watched New York's buildings stay on screen for the 20–30 s the next Overpass fetch took, under a status line already naming London. Nothing was stale by the existing rules — the snapshot was the last _true_ picture of a place the user had said they were leaving. `placeChanged` clears it; `positionChanged` must not, because a walk moves to a scene about to be mostly identical and blanking it on every step is the cost the consumer's mesh planner exists to avoid. Collapsing the two is a defect, and the property tests state both directions.
- **`placeChanged` is the one exception to the geo-event asymmetry (DEC-R12-10).** "640 m NE" survives a step and does not survive a teleport across an ocean, so a declared change clears it while an ordinary move still keeps it.
- **One geo-event field, so two sets cannot coexist.** The session could not settle whether old and new events had been visible simultaneously; with a single field that reading is unrepresentable rather than merely untested, which is why no test asserts it.
- **`fetchStarted` deliberately does not clear the snapshot.** Blanking there would flash the view empty on every interaction across an ~15–90 s Overpass fetch. The previous snapshot is the last true picture until the refresh actually fails.
- **No `gps-plus-slam-osm` types appear here, by hard constraint.** This package is published to npm and that one is not; a type-only import still lands in the published `.d.ts` and makes `pnpm install` 404 for every consumer. `OsmViewLatLng` is therefore declared structurally, and everything larger is deferred to `TSnapshot`. Same reasoning as `osm-bridge/opfs-osm-blob-store.ts`.
- The reducers return fresh objects rather than mutating the immer draft, matching `qr-detected-slice`: `TSnapshot` is opaque and may carry readonly tuples that immer's `WritableDraft` rejects.

## Examples

```ts
import { configureStore } from '@reduxjs/toolkit';
import { createOsmViewSlice } from 'gps-plus-slam-app-framework/state';

const osmView = createOsmViewSlice<DemoSnapshot, GeoEvent>({
  initialPosition: { lat: 50.9413, lng: 6.9583 },
  initialCategory: 'walkable',
});

const store = configureStore({ reducer: { osmView: osmView.reducer } });

store.dispatch(osmView.actions.fetchStarted('Fetching…'));
store.dispatch(osmView.actions.snapshotReady(snapshot));
store.dispatch(osmView.actions.cellSelected('8d1fb46622d8dbf'));
store.dispatch(osmView.actions.geoEventFound(event));

// A view that throws while drawing keeps the snapshot; a failed fetch does not.
store.dispatch(osmView.actions.nonFatalError('WebGL context lost'));
store.dispatch(osmView.actions.fetchFailed('Overpass returned 429'));
```

## Tests

- `osm-view-slice.test.ts` — initial state, action-type namespacing, the selection rules for position vs category changes, the refresh cycle, both halves of the failure split, the geo-event's four clearing rules, and the `placeChanged`/`positionChanged` pair (each assertion has its twin asserting the opposite for the other action).
- `osm-view-slice.property.test.ts` — the invariants over arbitrary action sequences: `nonFatalError` never touches the snapshot, `fetchFailed` always clears it, `placeChanged` always clears the snapshot and geo-event while never touching the presentation, every reachable state survives a JSON round-trip, and the position changes only through the two actions that write it.

No test data required; the snapshot type is stubbed with a one-field object precisely because the slice never looks inside it.
