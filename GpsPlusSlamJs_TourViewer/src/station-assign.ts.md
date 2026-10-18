# station-assign.ts

## Purpose

The automatic-station rule (tour editor plan 2026-10-17-1816, W3, owner
decisions D20 and D21): which station a new element - a pin, a photo, a
recorded photo, later a model - belongs to. A version 3 tour has no loose
items; each lives in a station with its pose relative to the station's
anchor. Pure.

## Public API

- `STATION_RADIUS_M = 25` - R, the most a station's elements are from its
  anchor, horizontally. **Provisional until measured**: the plan measures R
  over 15-40 m on recorded walks (the error at a station's edge - heading
  error times the distance from the anchor plus tracking drift between
  placements - against the station's size). That measurement is not part
  of M5a.
- `nearestStationWithin(stations, at, radiusM?)` - the id of the nearest
  station whose anchor is within `radiusM` (default R) of `at`, else
  `null`. Horizontal distance (`move-with-code.ts` `horizontalM`), R itself
  inside, a tie to the earlier station.
- `assignToStations({ stations, elements, positionOf, newStationId,
radiusM? })` - every element, in order, joins the nearest station within
  R, or starts a new one anchored at the element's own `{ lat, lon, alt }`.
  Returns `{ stations, stationOf }`: the given stations first (the same
  objects, their order), the new ones after in the order they started, and
  per element the id of its station.
- Types `StationSeat` (`{ id, anchor }`) and `StationPoint`
  (`{ lat, lon, alt }`).

## Invariants & assumptions

- **An anchor never moves.** It is fixed at the station's first element
  and never re-centred: a centre of mass would move with each new element
  and rewrite every earlier item's local pose (D20, against D17).
- **Order matters.** The same elements in another order can group
  differently (a fixed anchor at the FIRST element); callers pass them in
  the order they were made: the walk's photos in capture order, the AR
  placements in placement order.
- Defensive: a radius that is not a positive finite number throws
  `RangeError`; a new id that is already taken throws (two stations under
  one id would merge their items).
- The geodesy is licence-gated: the caller runs after the store is built.

## Examples

```ts
const { stations, stationOf } = assignToStations({
  stations: existing.map((s) => ({ id: s.id, anchor: s.geo })),
  elements: placements,
  positionOf: (p) => p.geo,
  newStationId: () => newObjectId(),
});
```

## Tests

- `station-assign.test.ts` - the edges: R itself, a tie, horizontal
  distance, a chain along a path, existing stations first, the order, a
  swept radius, refused radii and ids.
- `station-assign.property.test.ts` - for any elements over 200 m and any
  R in 15-40 m: an element within R joins the nearest station, one beyond
  R starts a new station at itself, anchors never move as elements are
  added, every element ends within R of its anchor, and a batch equals
  adding one element at a time.
