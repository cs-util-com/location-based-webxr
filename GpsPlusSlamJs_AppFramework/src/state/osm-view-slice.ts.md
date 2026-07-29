# `osm-view-slice.ts`

**Purpose.** A Redux Toolkit slice factory holding the state that several OSM-affordance views must agree on — the user's position, the displayed category, the sub-threshold toggle, the selected cell, the refresh phase, and the last computed snapshot.

## Public API

- `createOsmViewSlice<TSnapshot>(options)` → `{ reducer, actions }`
  - `options.name` — slice name, which namespaces the action types. Defaults to `osmView`. Override when one store mounts two of these.
  - `options.initialPosition: OsmViewLatLng`, `options.initialCategory: string` — required; the slice has no opinion about where or what a consumer starts on.
  - Generic over `TSnapshot`: whatever the consumer's pipeline produces. The slice never inspects it.
- Actions
  - `positionChanged(OsmViewLatLng)` — moves the user and **clears `selectedCell`**.
  - `categoryChanged(string)` — switches category and **keeps `selectedCell`**.
  - `showBelowThresholdChanged(boolean)`, `cellSelected(string | undefined)`.
  - `fetchStarted(message?)`, `scoringStarted(message?)` — phase only; the previous snapshot stays.
  - `snapshotReady(TSnapshot)` — stores it and returns to `idle`.
  - `fetchFailed(message)` — **clears the snapshot and the selection**, phase `error`.
  - `nonFatalError(message)` — phase `error`, **snapshot and selection untouched**.
- Types: `OsmViewState<TSnapshot>`, `OsmViewLatLng`, `OsmViewLoading`, `OsmViewLoadingPhase`, `CreateOsmViewSliceOptions`.

No selectors are exported. The mount key is the consumer's choice, so a selector here would have to guess it — and guess wrongly at runtime rather than at compile time.

## Invariants & assumptions

- **`fetchFailed` and `nonFatalError` are not interchangeable, and merging them is a defect.** A data failure means nothing new was produced, so any picture still on screen is a claim nothing supports — it must go. A view failure means the snapshot is valid and the _other_ view drew it correctly; discarding it would blank a correct picture to report a fault elsewhere. Stale cells can only originate from a data failure, so the split loses nothing. Pinned by `osm-view-slice.property.test.ts` over arbitrary action sequences.
- **The state must stay JSON-serialisable.** RTK's default middleware throws on non-serialisable state in development. Never put a `Map`, a `Set`, a Leaflet layer or a three.js object in here — raw feature maps belong in the consumer's pipeline. Pinned by a round-trip property test.
- **`fetchStarted` deliberately does not clear the snapshot.** Blanking there would flash the view empty on every interaction across an 18–110 s Overpass fetch. The previous snapshot is the last true picture until the refresh actually fails.
- **No `gps-plus-slam-osm` types appear here, by hard constraint.** This package is published to npm and that one is not; a type-only import still lands in the published `.d.ts` and makes `pnpm install` 404 for every consumer. `OsmViewLatLng` is therefore declared structurally, and everything larger is deferred to `TSnapshot`. Same reasoning as `osm-bridge/opfs-osm-blob-store.ts`.
- The reducers return fresh objects rather than mutating the immer draft, matching `qr-detected-slice`: `TSnapshot` is opaque and may carry readonly tuples that immer's `WritableDraft` rejects.

## Examples

```ts
import { configureStore } from '@reduxjs/toolkit';
import { createOsmViewSlice } from 'gps-plus-slam-app-framework/state';

const osmView = createOsmViewSlice<DemoSnapshot>({
  initialPosition: { lat: 50.9413, lng: 6.9583 },
  initialCategory: 'walkable',
});

const store = configureStore({ reducer: { osmView: osmView.reducer } });

store.dispatch(osmView.actions.fetchStarted('Fetching…'));
store.dispatch(osmView.actions.snapshotReady(snapshot));
store.dispatch(osmView.actions.cellSelected('8d1fb46622d8dbf'));

// A view that throws while drawing keeps the snapshot; a failed fetch does not.
store.dispatch(osmView.actions.nonFatalError('WebGL context lost'));
store.dispatch(osmView.actions.fetchFailed('Overpass returned 429'));
```

## Tests

- `osm-view-slice.test.ts` — initial state, action-type namespacing, the selection rules for position vs category changes, the refresh cycle, and both halves of the failure split.
- `osm-view-slice.property.test.ts` — the invariants over arbitrary action sequences: `nonFatalError` never touches the snapshot, `fetchFailed` always clears it, every reachable state survives a JSON round-trip, and position/category change only through their own actions.

No test data required; the snapshot type is stubbed with a one-field object precisely because the slice never looks inside it.
