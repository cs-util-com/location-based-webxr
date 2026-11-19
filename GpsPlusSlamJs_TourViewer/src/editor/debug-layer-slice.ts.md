# debug-layer-slice.ts

## Purpose

The debug layer's page state in the store (`debugLayer`): whether "Show
debug data" is on, whose walk the layer shows, the camera captures it
drew and the panel's status line. The 3D view on the globe draws from it;
the switch, the status line and the map's visibility follow it. The 2D
map is still drawn through the layer's view callbacks (`edit-main.ts`),
with the same captures.

## Public API

- `DebugLayerState` - `{ shown, source, captures, status }`:
  - `shown` - the View menu's "Show debug data"; on at every start.
  - `source` - `"walk"` (the tour file's own walk), `"added"` (debug data
    added beside the tour, "Add debug data…"), or null while no layer
    runs.
  - `captures` - `DebugPlace[]` in capture order (`image`, the picture's
    entry name and the capture's id; `lat`, `lon`, `alt` in degrees and
    metres over the ellipsoid), or null until drawn.
  - `status` - the panel's status line (reading, declined, shown), ""
    for none.
- `debugLayerActions`
  - `started({ source })` - shown, the source set, nothing drawn; an
    unknown source is ignored.
  - `drawn({ captures })` - the captures drawn, cleaned by
    `debugPlacesOf`; ignored while no layer runs.
  - `shownChanged({ on })`.
  - `statusSaid({ line })` - the status line, kept through starts and
    clears until said again; a line that is no string is "".
  - `cleared()` - no source, nothing drawn; `shown` kept until the next
    start.
- `debugLayerReducer`, `initialDebugLayerState`, `selectDebugLayer(root)`.
- `debugPlacesOf(captures)` - the captures a drawing keeps: a non-empty
  string name and a finite place on the Earth (|lat| <= 90, |lon| <= 180),
  the first of a name drawn twice, in their order.

## Invariants and assumptions

- Mounted as a page slice of the desktop editor's store (`edit-main.ts`
  passes it to `createTourViewerStore`); the phone's store never names it.
- Debug data, never the tour: no history, no draft, no save reads it.
- `captures` is never non-null while `source` is null (a property test
  holds it over any action sequence).
- Thumbnails are not state: they live in `debug-thumbs.ts`, keyed by the
  same names.

## Examples

```ts
store.dispatch(debugLayerActions.started({ source: "added" }));
store.dispatch(
  debugLayerActions.drawn({
    captures: captures.map((c) => ({ image: c.image, ...c.geo })),
  }),
);
selectDebugLayer(store.getState()).captures; // what the globe draws
```

## Tests

- `debug-layer-slice.test.ts` - start, draw, switch, clear, the status
  line, an unknown source, a drawing without a layer, mounting in the store, the cleaning.
- `debug-layer-slice.property.test.ts` - any captures keep unique names
  with finite places in their order; no action sequence leaves captures
  without a source.
