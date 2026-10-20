# station-ring.ts

## Purpose

The radius of the station the creator stands in, in their AR view (tour editor plan
2026-10-17-1816, W3 "AR authoring": the open station shows its radius): a
thin band lying on the ground around the station's anchor, R metres out.

## Public API

- `createStationRing() -> StationRing`
  - `show(parent, centre, radiusM)` - lay the ring at `centre`
    (`[north, up, east]` in the scene's GPS-world NUE; `up` is the ground)
    with radius `radiusM`, under `parent`. Moves it on a new centre,
    rebuilds its geometry on a new radius, moves it to a new parent; a
    centre or radius that is not finite and positive takes it away.
  - `hide()` - take it away (kept for the next `show`).
  - No `dispose()`: one ring per page wiring (`creator-stations.ts`), kept
    for the page's life. A session's end only hides it; its material is
    shared by every later session, so freeing it there would break the
    next one, and the page has no teardown to free it at (PR #646 bot
    finding #2: the method was never called).
- `STATION_RING_NAME` - `"station-ring"`, how tests find it.

## Invariants & assumptions

- One mesh at a time; flat (the ring geometry turned into the XZ plane);
  a band of 0.3 m around R, 128 segments (a chord sags about 1.2 cm at
  40 m); the design system's accent `#f2971f` at 70 % opacity, no depth
  write. The look is the builder's choice, not the owner's.
- The caller puts it on the ground: the phone's height less
  `EYE_HEIGHT_M` (`breadcrumbs.ts`), not the anchor's own height (an
  anchor on a wall would float the ring).
- Never picked: its `raycast` is inert, so a tap selects the objects
  inside it.
- Removed through the parent it was added to as well as
  `removeFromParent`: the e2e scene is a plain object that keeps no
  `parent` link.

## Examples

```ts
const ring = createStationRing();
ring.show(scene, [anchorN, eyeUp - EYE_HEIGHT_M, anchorE], STATION_RADIUS_M);
ring.hide();
```

## Tests

- `station-ring.test.ts` - flat at the centre with the radius inside the
  band; moves, rebuilds and re-parents with one ring at a time; hides
  from a parent without parent links and on bad input; shows the same
  ring again after a hide; never hit by a ray.
- Through `creator-stations.test.ts` and
  `playwright-tests/creator-stations.spec.js`.
