# new-pin.ts

## Purpose

The editor's new items, as data, pure: the tree's add in place and the
add palette (a short text or a long text). Where a new item goes
in its station (inside the circle, clear of the items already there) and
the item itself, named by its number, standing on the ground where that
has loaded and seated in the station it was added to.

## Public API

- `freePinSpot(station)` -> `{ northM, eastM }` in the station's frame:
  the first place on rings of 4, 6, 8 and 10 m (each capped at the found
  radius), 12 places a ring starting due north and going clockwise, that
  keeps more than 2.2 m from every item; with none free, 4 m north (or
  the radius, if smaller).
- `NewItemInput` - `{ station, id, nowIso, groundAt }`, what each new
  item is made from.
- `newPin(input)` -> `TourPin`: a pin (a short
  text in its `pin` view) with that id and time, its caption "New pin n"
  (n one more than the station's pins), its `geo` at the free spot (`itemGeoPose`), its height the
  ground's there by `groundAt` (the anchor's height while none has
  loaded), and `station` set to the station's id, so the station rule
  does not seat it in another.
- `newLongText(input)` -> `TourReadingSign`: a long text in its
  `reading` view, titled "New long text n" (n one more than the
  station's long texts), its body `NEW_LONG_TEXT_BODY` ("Write the text
  here."; the file's long text needs a body), placed and seated as a pin
  is.
- `addNewItem({ stations, stationId, kind, id, nowIso, groundAt, place })`
  -> `NewItemOutcome` (`{ kind: "added", item }` or `{ kind: "refused",
reason }`): the add itself - the new pin or long text of the station,
  handed to `place` (the tour's own check, `EditorSession.place`).
  Refused in words when the station is gone (an undo or a delete between
  the press and the add: "That station is no longer in this tour -
  nothing was added.", `place` not called) or when `place` refuses (its
  words). The page toasts the refusal.

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
the ground; the long text's fields and its round trip through the file's
record (it parses back as written); `addNewItem`'s gone station, its
passed-on refusal and its placed item.
