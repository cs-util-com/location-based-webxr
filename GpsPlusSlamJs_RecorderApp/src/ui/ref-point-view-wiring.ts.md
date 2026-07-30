# ref-point-view-wiring.ts

## Purpose

AR-scoped owner of BOTH ref-point view wirers — the 3D sphere visualizer
subscription (`wireRefPointSubscribers`) and the live-map marker wirer
(`wireRefPointMapMarkers`). Round-3 feedback (2026-07-05,
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-2349-recorder-ar-ready-ref-point-views-user-feedback.md`):
these used to be wired per recording session, so a folder import finishing in
the AR_READY phase filled the Redux store with no view subscribed — nothing
appeared on the map or in 3D until the first recording.

## Public API

- `wireRefPointViews(storeRef, {visualizer, getMap}): {refreshMapMarkers, unsubscribe}`
  - Wires both view wirers against `storeRef.get()` immediately and
    **re-wires them on every store swap** (`storeRef.subscribe`) — a
    recording start swaps in a fresh store, and a captured-store subscriber
    would silently freeze (see `state/store-ref.ts`, the app's canonical
    swap-survival mechanism).
  - `getMap` is late-binding (the minimap is created lazily on the first map
    toggle); main's `handleToggleMap` calls `refreshMapMarkers()` right after
    `mapOverlay.toggle()` whenever the map ends up visible — NOT at overlay
    creation, because the inner Leaflet map exists only after `show()`
    (2026-07-06 round-4 fix; re-shows refresh too, since store-event-free
    phases like AR_READY never trigger the wirer's subscriber).
  - The map wirer's `getStartTime` reads `sessionMetadata.startTime` from the
    CURRENT store — before a session everything renders prior/green, a
    recording's captures render red (identical to the summary map). Marker
    size 20 px (F5-A AR readability) via the shared renderer option.
  - `unsubscribe()` detaches the swap listener and tears down the active pair
    (the map wirer removes its drawn layers).

## Invariants & assumptions

- **Lifecycle = AR session**: wired in `handleEnterAR` (dispose-first on
  re-entry), torn down in `resetMainState` — the same leak-guard pattern as
  the tracking-quality subscription and the other visual layers.
- Exactly ONE pair is live at any time; a swap tears down the old pair before
  wiring the new one (no duplicate spheres/markers).
- The 3D visualizer is zeroRef-gated internally — pre-recording (no GPS
  watch) it simply renders nothing until a zero reference exists.
- Replay does NOT use this module: its store never swaps mid-replay, so
  `replay-mode.ts` keeps its own controller-scoped wiring.

## Examples

```ts
refPointViews?.unsubscribe();
refPointViews = wireRefPointViews(storeRef, {
  visualizer: refPointVisualizer,
  getMap: () => mapOverlay?.getLeafletMap() ?? null,
});
// after mapOverlay.toggle() made the minimap visible:
refPointViews.refreshMapMarkers();
// on reset / AR end:
refPointViews.unsubscribe();
```

## Tests

- [ref-point-view-wiring.test.ts](ref-point-view-wiring.test.ts) — immediate
  wiring, re-wire + old-pair teardown on store swap, lazy `getStartTime`
  through the current store, `refreshMapMarkers` delegation, unsubscribe
  stops following swaps.
- `main.ar-follower-wiring.test.ts` — Enter-AR wiring, dispose-before-rewire
  on a second AR entry, disposal in `resetMainState`.
