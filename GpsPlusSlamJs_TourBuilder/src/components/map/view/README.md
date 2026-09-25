# map/view — the plain Leaflet map + replay e2e

The only impure half of component 7. Plain `L.map(container)` in a real DOM
element — no Three.js, no CSS3D (see the root `README.md` for why the
framework's `LeafletMapOverlay` isn't wrapped directly).

## `tour-map.ts`

```ts
createTourMap(container: HTMLElement | null, options?: TourMapOptions): TourMapInstance | null
// options: { tileServerUrl?, onTileError? }
```

`applyMapVisibility(map, visible)` — show + `resize()` or hide a map (no-op for
`null`). The HUD Map toggle in both the composed app and the desktop-preview
demo goes through it.

`TourMapInstance`:

- **`setGpsPosition(lat, lon)`** — centers the map. Same name/shape as
  `LeafletMapOverlay`.
- **`render(data: MapData)`** — draws the user-position dot via the framework's
  shared `buildMapData`/`drawMapData` (the exact routine the live CSS3D map and
  the 2D summary map already share).
- **`setWaypoints(markers)`** — replaces the waypoint marker layer wholesale
  (fine at realistic tour sizes — a handful to a few dozen, matching the
  existing `drawTrajectory`/`addPriorMarkers` bulk-redraw precedent). Marker
  color/size per status: `unvisited` grey 20px, `next` gold 24px (highlight
  only), `visited` green 20px + a ✓ glyph.
- **`toggle()` / `show()` / `hide()` / `isVisible()`** — visibility via the
  container's `display` style. Starts hidden. `show()` schedules `resize()`
  (`invalidateSize()`) via `requestAnimationFrame` — after the browser applies
  the `display` change, not a fixed timeout guess.
- **`resize()`** — public too, for callers that resize the container
  themselves.
- **`getLeafletMap()` / `destroy()`** — parity with `LeafletMapOverlay`;
  `destroy()` is idempotent.

## `tour-map-replay.e2e.test.ts`

The second test level (TASK.md §2.3). Replays the real Task 1 zip
(`recordings/2026-06-22_16-06-59utc.zip`) via `replayRecording`, converts the
full `odometryPositions` path to lat/lon via the framework's already-tested
`computeFusedPath` (no new geo math), feeds every point through
`setGpsPosition` in order, and asserts the map centers on each expected
lat/lon in sequence — the "assert the position marker follows the track"
line from TASK.md.

Note: under `@vitest-environment jsdom`, jsdom's global `URL` breaks relative
resolution against a `file:` base (`new URL(relative, import.meta.url)`) even
though `import.meta.url` itself is a correct `file:` URL. The test resolves
the recording path via `node:path` instead.

## Tests

`tour-map.test.ts` (Leaflet mocked — same pattern as the framework's
`leaflet-map-overlay.test.ts`) covers map/tile-layer creation, `setGpsPosition`
centering, marker placement + per-status icon color (the "geo→screen
projection" test line — verified via Leaflet's own marker lat/lng, not custom
Mercator math), wholesale marker replacement, `render`'s user-dot path,
toggle/show/hide, resize, destroy idempotency, and the tile-error callback.
`tour-map-replay.e2e.test.ts` is the replay e2e. Both run under
`pnpm test:unit`.
