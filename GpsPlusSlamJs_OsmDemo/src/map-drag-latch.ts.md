# `map-drag-latch.ts`

## Purpose

Answers one question for the map-pan camera follow (DEC-L4): **did the USER move
the map, or did code?** Leaflet's `moveend` cannot tell them apart; this can.

## Public API

- `createMapDragLatch(): MapDragLatch`
  - `gestureStarted()` — arm. Wired to `dragstart` **and** `zoomstart`.
  - `moveEnded(): boolean` — read and clear. `true` exactly once per armed
    gesture, `false` for every move nobody made.

## Invariants & assumptions

- **Read-and-clear, not a flag anyone else clears.** A latch left armed fires on
  the next `moveend`, which is very likely to be a programmatic one — i.e. it
  fails into exactly the behaviour it exists to prevent, one event later.
- **Two arms then one read is ONE move.** A one-finger drag that gains a second
  finger makes Leaflet finish the drag mid-gesture (`Draggable._onDown` calls
  `finishDrag()`), so `dragstart` and `zoomstart` can both arrive before any
  `moveend`. Without this the camera would be re-aimed at the mid-pinch centre.
- **`zoomstart` is safe to arm on**, because none of the programmatic movers
  changes the zoom: `panTo` and `centreOn` both call `setView` with
  `map.getZoom()`.
- **Read on `moveend`, never on `dragend`.** `dragend` fires when the finger
  lifts, before the inertia glide settles, so the centre read there is not where
  the map ends up. Leaflet raises `moveend` on both drag-end branches — directly
  when inertia is off, and via the inertia animation's end when it is not.
- ⚠️ **Accepted residual risk:** if a gesture ever armed the latch and no
  `moveend` followed, the next _programmatic_ pan would move the camera once.
  Read-and-clear bounds it to that single move, and no such path is known in
  Leaflet 1.9 — a `setView` during an inertia glide calls `_stop()`, which
  raises the pending `moveend` first.
- **Accepted gap:** a keyboard-arrow pan of the map does not move the camera.
  One more event on the same latch if it ever matters.

## Why the camera move itself is not in here

`BuildingView.recentre(enu)` already does all of it — the ENU→scene flip
(`{x, y: 0, z: −y}`), translation only, current distance and direction kept. It
is the same call a map CLICK already makes through the position subscriber, so
the follow is two lines at the call site and there is nothing to extract. The
first draft of the plan proposed a `cameraTargetForLatLng` helper; the cold
review pointed out it already existed under another name.

## Examples

```ts
const latch = createMapDragLatch();
mapView.map.on("dragstart", () => latch.gestureStarted());
mapView.map.on("zoomstart", () => latch.gestureStarted());
mapView.map.on("moveend", () => {
  if (!latch.moveEnded()) return;
  const centre = mapView.map.getCenter();
  buildingView.recentre(
    enuFrameAt(anchors.origin).toEnu({ lat: centre.lat, lng: centre.lng }),
  );
});
```

## Tests

- `map-drag-latch.test.ts` — the four states: no gesture says no, one gesture
  says yes exactly once, a drag that becomes a pinch still says yes exactly
  once, and the latch re-arms for the next gesture.
- `boot-and-shell.spec.js` → "dragging the 2D map carries the 3D camera with
  it" — the wiring, through the observable the shareable camera link already
  exposes (`clat`/`clng`). **Two drags in the same direction**, asserting the
  longitude strictly increases: one drag would only prove that _something_ wrote
  the URL. `data-frames` was rejected as the observable — it counts repaints
  from half a dozen unrelated causes, so it rises whether or not the camera
  moved.
  - **Mutation-verified:** making the `moveend` handler return unconditionally
    fails it.
  - ⚠️ **The NEGATIVE half is not asserted here, and deliberately so.** "A
    programmatic pan does not move the camera" has no clean fixture: every
    programmatic pan in this demo moves the camera by its own, correct route —
    the quest search aims at the beacon, `centreOn` recentres on the user. What
    would actually regress is the quest search's beacon-height aim, and
    `scene-3d.spec.js` → "brings the beacon into frame even from a CLOSE camera"
    already fails if this follow clobbers it. The latch's own `false` cases are
    unit-tested above.

## Related

- [`map-zoom-to-camera.ts`](./map-zoom-to-camera.ts.md) — the other half of the
  map→3D binding, which this deliberately mirrors: zoom drives the camera's
  distance, a drag drives its target.
- [`recentre-camera.ts`](./recentre-camera.ts.md) — the move itself.
