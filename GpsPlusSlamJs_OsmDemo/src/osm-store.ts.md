# `osm-store.ts`

**Purpose.** Build the demo's single Redux store, bind the framework's generic OSM slice to `DemoSnapshot`, and hand out a change-only subscriber the views are driven from.

## Public API

- `createDemoStore({ start, category })` → `{ store, actions, subscribe }`
  - `store` — a plain RTK `configureStore` with one reducer mounted at `osmView`.
  - `actions` — the slice's action creators (`positionChanged`, `categoryChanged`, `showBelowThresholdChanged`, `cellSelected`, `fetchStarted`, `scoringStarted`, `snapshotReady`, `fetchFailed`, `renderFailed`).
  - `subscribe(select, onChange)` — calls `onChange(current, previous)` only when `select`'s result changes by **reference**. Returns an unsubscribe function.
- `selectOsmView(state)` — the slice state from the root. The one place the mount key is named.
- `summariseSnapshot(state)` — the devtools `stateSanitizer`. Exported for its test, not for callers.
- Types: `DemoRootState`, `CreateDemoStoreOptions`, `DemoStore`.

## Invariants & assumptions

- **The snapshot is excluded from RTK's serialisability scan on BOTH sides.** The middleware walks the dispatched action _and_ the resulting state, so `ignoredPaths: ["osmView.snapshot"]` alone left the ~931-cell payload of `snapshotReady` still being scanned on every refresh — half the cost, silently. The action is excluded by **type**, taken from the action creator rather than spelled out, so renaming the slice cannot quietly stop it matching. The guarantee this gives up is recovered in **`demo-pipeline.test.ts`**, which fails a gate rather than printing a `console.error` (the channel `serializableCheck` actually reports through — which is why the surviving store test spies on `error`).
  - **Not in `osm-store.test.ts`.** The round-trip assertion lived there for one commit before moving. A fixture written next to its own assertion proves only that the fixture is serialisable; the guard has to drive the real producer, which is where it now lives.
- **Nothing non-serialisable goes in the store.** RTK's default middleware throws on non-serialisable state in development. `CellScore.contributors` is a plain `Record` rather than a `Map` for exactly this reason; the merged `OsmFeature` map is a `Map` and therefore stays in `DemoPipeline`, where it is also cheapest to keep.
  - The store test that dispatches a real `DemoSnapshot` and asserts nothing was logged does **not** support this bullet for the snapshot — both exclusions above close that channel, so a `Map` in the snapshot produces zero `console.error` calls and the assertion would pass regardless. It still earns its place for the rest of the state, which is scanned.
- **`subscribe` compares by reference, never deeply.** Every producer returns a fresh object per refresh and the same object otherwise, so `!==` is both correct and free. Deep-comparing ~931 cells to decide whether to redraw them would cost more than the redraw.
- **Views do not import this module.** Each view keeps a plain `render(...)` taking the data it draws; `main.ts` subscribes and calls them. A view that imported the store would be untestable without one, and the seam that makes "is the data wrong or the drawing wrong?" answerable is the same seam that makes the views mockable.
- **Plain `configureStore`, not `createSlamAppStore`.** That factory wires the library's GPS/AR reducers, licence validation and persistence middleware, none of which this demo has. The slice is identical either way, so switching if AR mode ever arrives is a one-line change.
- `summariseSnapshot` must never throw — devtools sanitises state the developer may not know is being inspected, and an exception there takes the whole app down. It tolerates a missing slice and a missing snapshot.

## Examples

```ts
const { store, actions, subscribe } = createDemoStore({
  start: { lat: 50.9413, lng: 6.9583 },
  category: "walkable",
});

subscribe(
  (view) => view.snapshot,
  (snapshot) => {
    if (snapshot === undefined) mapView.clear();
    else
      mapView.render(
        snapshot.cells,
        snapshot.regions,
        "walkable",
        snapshot.threshold,
      );
  },
);

store.dispatch(actions.positionChanged({ lat: 50.94, lng: 6.95 }));
```

## Tests

`osm-store.test.ts` — the slice is mounted where the selectors look; dispatching a real `DemoSnapshot` logs nothing for the rest of the state (**not** a guard on the snapshot itself — see the invariant above); `subscribe` fires only on change, fires with `undefined` when a failed fetch clears the snapshot, and stops after unsubscribing; `summariseSnapshot` replaces the cells with a count and tolerates an empty state.

The framework slice's own behaviour (the `fetchFailed` / `renderFailed` split, the JSON round-trip) is tested in `GpsPlusSlamJs_AppFramework/src/state/osm-view-slice.{test,property.test}.ts` and deliberately not re-tested here.
