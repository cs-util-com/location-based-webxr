# ref-point-map-markers.ts

## Purpose

Store→map reference-point marker wirer: the single code path that projects
the Redux `refPoints` state onto a Leaflet map (2026-07-05 live-map user
feedback — the live AR minimap, the replay minimap, and the session-summary
map must visualize ref points identically, with no duplicated marker code).
Renders through the shared [draw-ref-point-markers.ts](draw-ref-point-markers.ts)
renderer.

## Public API

- `refPointEntriesToMarkerData(entries): RefPointMarkerInput[]` — maps
  `RefPointEntry[]` to renderer input: fused `gpsPoint` preferred over
  `rawGpsPoint`, `name` falling back to the H3 `id`, `timestamp` passed
  through. Also used by `performStop`'s `referencePointsForMap` summary
  snapshot so both maps plot identical coordinates/labels.
- `wireRefPointMapMarkers(store, {getMap, getStartTime, dotSizePx?}): {refresh, unsubscribe}` —
  subscribes to the store and keeps markers on `getMap()` in sync with
  `selectRefPointEntries`:
  - `getMap` is late-binding (the AR minimap is created lazily on the first
    map toggle); returns null/undefined until then. The map's creator calls
    `refresh()` once it exists — and it must do so **after** the map became
    visible: the overlay creates its inner Leaflet map only inside `show()`
    (recording: `refreshMapMarkers()` after `toggle()` in main's
    `handleToggleMap`, 2026-07-06 round-4 fix; replay: `setMapOverlay`).
  - `getStartTime` is read lazily (from `sessionMetadata.startTime`) — before
    a session starts everything classifies prior/green; the `startSession`
    dispatch re-renders with the real start so this-session captures turn
    red. Same classification as the summary map.
  - `unsubscribe()` stops listening AND removes all layers this wirer drew.

## Invariants & assumptions

- **Diffed re-render:** the store fires on every GPS tick during a recording;
  the wirer re-renders only when the memoized `selectRefPointEntries`
  reference or the `getStartTime()` value changes.
- **Null-map renders never record rendered state** (2026-07-06 round-4 fix):
  a `render()` against a null `getMap()` resets the diff-guard state instead
  of recording it. Recording it would "poison" the guard — the subscriber
  would treat the state as already drawn and never render after the
  lazily-created map appears. Corollary: while the map is closed, every store
  event runs a cheap no-op `render()` (zero-layer removal + selector read +
  null-map return).
- Rendering is remove-then-redraw of this wirer's OWN layers only — the
  overlay's trajectory layers are untouched.
- Pure app-side module: the framework's `leaflet-map-overlay` stays
  ref-point-agnostic and only hands out its `L.Map` via `getLeafletMap()`.
- Consumers: `ui/ref-point-view-wiring.ts` (live AR — AR-scoped and
  store-swap-following via main's `storeRef`, round-3 feedback 2026-07-05),
  `replay-mode.ts` (per replay controller, torn down in `dispose`), and
  `recording-session-handlers.ts` uses only the pure
  `refPointEntriesToMarkerData` mapping for the summary snapshot.

## Examples

```ts
const wirer = wireRefPointMapMarkers(store, {
  getMap: () => overlay?.getLeafletMap() ?? null,
  getStartTime: () =>
    store.getState().recording.sessionMetadata?.startTime ??
    Number.MAX_SAFE_INTEGER,
  dotSizePx: 20, // F5-A AR readability
});
// after the lazily-created map appears:
wirer.refresh();
// teardown:
wirer.unsubscribe();
```

## Tests

- [ref-point-map-markers.test.ts](ref-point-map-markers.test.ts) — mapping
  fallbacks, immediate render, diffed re-render (no redraw on GPS ticks),
  startTime-change reclassification (green→red), late map creation via
  `refresh()`, poisoned-guard regression (null-map render must not record
  rendered state; next store event after the map appears draws), `dotSizePx`
  forwarding, unsubscribe cleanup.
- `main.map-toggle-wiring.test.ts` — main's `handleToggleMap` refreshes AFTER
  `mapOverlay.toggle()` made the map visible (first show and re-shows).
- Wiring: `recording-session-handlers.test.ts` (late-binding getMap,
  startTime from store, refresh delegation, teardown/replacement),
  `replay-mode.test.ts` (replay wiring, setMapOverlay refresh, dispose).
