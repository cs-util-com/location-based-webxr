# station-captures.ts

## Purpose

Which station a walk photo or the ring around a code goes with, for the
visitor (visitor plan 2026-10-18-2349 M2): the station whose presence
shows it (`station-content.ts`).

## Public API

- `capturesByStation(captures, stations) -> { byStation, loose }` -
  `captures` (anything with a `geo` spot and an optional baked `station`)
  grouped by station id, each list in the captures' order; `loose` holds
  the ones no station of this tour takes.
- `nearestStationId(stations, at) -> string | null` - the station nearest
  `at` horizontally among those whose own `foundRadiusM` holds it
  (inclusive; the earlier one on a tie); null outside every station's found
  radius and without stations. A radius that is not a positive finite
  number holds nothing.
- Types: `StationSpot { id, geo }`, `RingStation` (a `StationSpot` with
  `foundRadiusM`), `CaptureSpot { geo, station? }`.

## Invariants & assumptions

- **A baked photo** keeps the station the creator's Finish gave it, when the
  tour has that station.
- **A photo joined live**, or one whose baked station the tour lacks, gets
  the Finish's own rule (`assignToStations`, R = `STATION_RADIUS_M`,
  25 m): the nearest station within R. One the rule would start a NEW
  station for is `loose`: the caller shows it always, as every photo was
  shown before, since no presence can be judged for a station the tour
  does not have.
  - The rule runs in order, as the Finish does, so a photo within R of a
    real station can still end up loose: an earlier loose photo may have
    started a new (minted) station nearer to it, and the photo joins that
    one. "Loose" therefore means "with a station the tour lacks", not
    "beyond R of every station".
- **The ring** goes with the nearest station whose OWN found radius
  (`foundRadiusM`; a station the Finish starts gets `STATION_RADIUS_M`,
  `tour-content.ts`) holds the code; a code outside every found radius has
  none, and the caller shows its ring always. The found radius rather than
  R: presence starts only inside a station's found radius
  (`station-presence.ts` `takesOver`), so a ring given to a 5 m station
  from a code 8 m away would show nowhere a visitor at the code stands.
  Live walk photos keep R (25 m): the Finish groups them by it.
- Pure; minted ids (`loose:N`) carry a ":" so they never equal a tour's id.

## Example

```ts
const { byStation, loose } = capturesByStation(captures, manifest.stations);
const ringStation = nearestStationId(manifest.stations, codeGeo);
```

## Tests

- `station-captures.test.ts` - a baked capture keeps its station; a live
  one goes to the nearest station within R; one beyond R is loose; an
  unknown baked station is judged by the rule; no stations leaves
  everything loose; a property over generated layouts; the ring's nearest
  station whose found radius holds the code (inclusive at 25 m; a 5 m
  station takes a code at 3 m and 4.9 m, not at 5.1 m or 8 m), a nearer
  station whose radius misses the code passed over for a farther one that
  holds it, null outside every radius, the tie, null without stations, and
  no station for a radius that is not a positive number.
