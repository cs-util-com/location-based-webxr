# station-assign.ts

## Purpose

The automatic-station rule (tour editor plan 2026-10-17-1816, W3, owner
decisions D20 and D21): which station a new element - a pin, a photo, later a
model - belongs to. A tour has no loose
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
- `stationHolding(stations, at)` - the id of the station that holds `at`:
  the nearest whose anchor (`geo`) is within its OWN `foundRadiusM`, else
  `null`. Horizontal, the radius itself inside, a tie to the earlier
  station; a radius that is not a positive finite number holds nothing (a
  broken hand-edited file must not swallow every object). The rule the
  tour document seats every placement and move by (`tour-document.ts`),
  and the creator's HUD names the open station by
  (`creator-stations.ts`): a radius the creator set is respected. Type
  `HoldingStation` (`{ id, geo: { lat, lon }, foundRadiusM }`).
- `assignToStations({ stations, elements, positionOf, newStationId,
ownStationOf?, radiusM? })` - every element, in order, joins the nearest
  station within R, or starts a new one anchored at the element's own
  `{ lat, lon, alt }`. `ownStationOf(element, index)` names an element's
  OWN station: it joins the station of that id if one stands (given, or
  started by an earlier element), else starts it anchored at itself, even
  within R of another (owner decision D8 of the editor round-2 plan, the
  phone's "New station here"; and the M5a review M2 undo, see
  `tour-content.ts.md`).
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
- **An own station is taken in order too.** It exists from its element on:
  an earlier element never joins it (it would be absorbed into a station
  started after it), a later one within R joins it like any station.
- Defensive: a radius that is not a positive finite number throws
  `RangeError`; a new id that is already taken throws, and so does an own
  station naming an id this call minted for another station (two stations
  under one id would merge their items).
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

- `station-assign.test.ts` - `stationHolding`: its own radius itself
  inside and 1 cm beyond it outside (at 25 m and 7 m, and at the exact
  measured distance), a 5 m and a 40 m station, a tie and the nearer of
  two (also against a larger radius), horizontal distance, no stations, a
  broken radius. `assignToStations`: the edges: R itself, a tie, horizontal
  distance, a chain along a path, existing stations first, the order, a
  swept radius, refused radii and ids; an element's own station (D8):
  started within R, never taking an earlier element, joined by a second
  element naming it, and refused when it names a minted id.
- `station-assign.property.test.ts` - for any elements over 200 m and any
  R in 15-40 m: an element within R joins the nearest station, one beyond
  R starts a new station at itself, anchors never move as elements are
  added, every element ends within R of its anchor, and a batch equals
  adding one element at a time; with any elements marked to start their
  own station, each marked one starts it at itself and the rest follow
  the rule against the stations standing before them.
