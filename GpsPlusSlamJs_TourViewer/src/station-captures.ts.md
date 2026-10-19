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
  `at` horizontally (the earlier one on a tie); null without stations.
- Types: `StationSpot { id, geo }`, `CaptureSpot { geo, station? }`.

## Invariants & assumptions

- **A baked photo** keeps the station the creator's Finish gave it, when the
  tour has that station.
- **A photo joined live**, or one whose baked station the tour lacks, gets
  the Finish's own rule (`assignToStations`, R = `STATION_RADIUS_M`,
  25 m): the nearest station within R. One the rule would start a NEW
  station for is `loose`: the caller shows it always, as every photo was
  shown before, since no presence can be judged for a station the tour
  does not have.
- **The ring** goes with the station nearest the code, however far.
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
  station, the tie, and null without stations.
