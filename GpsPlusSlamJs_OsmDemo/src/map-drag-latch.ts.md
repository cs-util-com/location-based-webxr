# `map-drag-latch.ts`

## Purpose

Answers one question for the map-pan camera follow (DEC-L4): **did the USER move
the map, or did code?** Leaflet's `moveend` cannot tell them apart; this can.

## Public API

- `createMapDragLatch(): MapDragLatch`
  - `gestureStarted()` — arm. Wired to `dragend` **only** — see below.
  - `moveEnded(): boolean` — read and clear. `true` exactly once per armed
    gesture, `false` for every move nobody made.

## Invariants & assumptions

- **Read-and-clear, not a flag anyone else clears.** A latch left armed fires on
  the next `moveend`, which is very likely to be a programmatic one — i.e. it
  fails into exactly the behaviour it exists to prevent, one event later.
- ⚠️ **`zoomstart` IS NOT ARMED ON, and the reason is a measured regression.**
  The first version did arm on it, to cover a one-finger drag that gains a
  second finger — Leaflet finishes the drag mid-gesture (`Draggable._onDown`
  calls `finishDrag()`), so the camera lands on the mid-pinch centre and never
  on the final one. But **Leaflet raises `moveend` for a ZOOM as well as for a
  pan**, so every wheel or button zoom consumed the latch and snapped the camera
  target to the map centre — **~100 m in the e2e fixture** — silently undoing
  the `zoomend` handler's deliberate "the target is kept".
  - The two targets diverge routinely: a map click recentres the camera without
    moving the map, and a 3D drag moves the target without moving the map. That
    is why reconciling them on a zoom is a defect rather than a tidy-up.
  - **The pinch imprecision is the accepted cost**, and it is far smaller: the
    camera lands on the centre at the moment the second finger arrived.
- **Two arms then one read is still ONE move**, and the unit test keeps saying
  so: nothing in the latch depends on which event armed it, so a future caller
  that adds a second arming source cannot get a double move for free.
- **Armed on `dragend`, read on `moveend`, and the centre is never read at
  `dragend`.** `dragend` fires when the finger lifts, before the inertia glide
  settles, so the centre there is not where the map ends up. Leaflet raises
  `moveend` on both drag-end branches — directly when inertia is off, and via
  the inertia animation's end when it is not — and fires `dragend` **before**
  either, so the drag's own `moveend` always finds the latch armed.
- ⚠️ **`dragstart` IS NOT ARMED ON either** (PR #347 review): a latch armed
  for the whole gesture is stolen by any programmatic `moveend` landing
  mid-drag. The concrete path: locate is pressed, the fix takes seconds, the
  user drags while waiting — `centreOn` fires `moveend`, consumes the latch,
  the camera is re-aimed by the recentre, and the drag's own end then finds
  the latch already clear, so the user's drag is not followed. Both halves
  inverted against the contract. Armed only at `dragend`, that window closes.
- ⚠️ **Accepted residual risk:** if a gesture ever armed the latch and no
  `moveend` followed, the next _programmatic_ pan would move the camera once.
  Read-and-clear bounds it to that single move, and no such path is known in
  Leaflet 1.9 — a `setView` during an inertia glide calls `_stop()`, which
  raises the pending `moveend` first.
- **Accepted gap:** a keyboard-arrow pan of the map does not move the camera.
  One more event on the same latch if it ever matters.
- ⚠️ **A drag moves the camera but loads NO DATA.** A map click dispatches
  `positionChanged`, which re-anchors, refetches the working set and loads
  terrain; a drag is a LOOK, not a move, so it does none of that. Drag far
  enough and the 3D view is aimed past the built mesh at empty space, with no
  status line saying so. Recorded rather than fixed — a fetch on every idle
  drag would be the most expensive gesture in the app, and moving the user
  instead would teleport them. Raised with the owner as a decision.

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
mapView.map.on("dragend", () => latch.gestureStarted());
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
