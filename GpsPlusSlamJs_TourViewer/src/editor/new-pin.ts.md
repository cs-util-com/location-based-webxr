# new-pin.ts

## Purpose

The 3D inspector's Add pin, as data, pure: where a new pin goes in its
station (inside the circle, clear of the items already there) and the
pin itself, named by its number, standing on the ground where that has
loaded and seated in the station it was added to.

## Public API

- `freePinSpot(station)` -> `{ northM, eastM }` in the station's frame:
  the first place on rings of 4, 6, 8 and 10 m (each capped at the found
  radius), 12 places a ring starting due north and going clockwise, that
  keeps more than 2.2 m from every item; with none free, 4 m north (or
  the radius, if smaller).
- `newPin({ station, id, nowIso, groundAt })` -> `TourPin`: a pin (a short
  text in its `pin` view) with that id and time, its caption "New pin n"
  (n one more than the station's pins), its `geo` at the free spot (`itemGeoPose`), its height the
  ground's there by `groundAt` (the anchor's height while none has
  loaded), and `station` set to the station's id, so the station rule
  does not seat it in another.

## Invariants & assumptions

- The spot is always within the found radius (a radius of 0 gives the
  anchor itself).
- `groundAt` answers ellipsoidal heights, as the file writes them; a
  non-finite answer counts as not loaded.

## Examples

```ts
const pin = newPin({
  station,
  id: newObjectId(),
  nowIso: new Date().toISOString(),
  groundAt,
});
session.place(pin); // one undo step
```

## Tests

`new-pin.test.ts`: an empty station, a taken spot, a small circle, a
property that the spot is inside the circle for any items and radius;
the pin's fields, its place in the frame, its height with and without
the ground.
