# editor3d-visibility.ts

## Purpose

What the 3D editor shows, by two pure rules that run every frame: the
morph (pins and photos flat looking down, upright tilted) and near-K
(only the stations nearest to the camera's centre, and the selected one,
draw their items). Plus the mapping from the page's selection to the
station near-K must keep.

## Public API

- `MORPH_BAND` - `{ fromDeg: 8, toDeg: 42 }`: flat at 8 degrees of tilt
  from straight down and below, upright at 42 and above.
- `morphStanding(tiltDeg, band = MORPH_BAND)` -> 0..1, a smooth step
  (`3t^2 - 2t^3`) across the band. RangeError for a tilt that is not
  finite, or a band whose ends are not finite with `fromDeg < toDeg`.
- `NEAR_STATIONS` - 5.
- `nearStations(stations, centre, k = 5, selected = null)` -> `Set<string>`:
  the `k` nearest by horizontal distance (`east`, `north`, m), a tie to the
  smaller id, plus `selected` when it is one of `stations`. A station with
  a coordinate that is not finite ranks last. RangeError for a `k` that is
  not a whole number >= 0 or a centre that is not finite.
- `selectedStationOf(selected, manifest)` -> the station id for
  `station:<id>` when the tour has it, or the station holding the
  selected item; null for a code, an unknown id, no selection or no tour.
- Types `MorphBand`, `StationSpot`.

## Invariants & assumptions

- The morph is non-decreasing in the tilt and clamped to 0..1 for any
  valid band.
- Near-K returns at most `k + 1` ids, always the selected one when it
  exists, the same set whatever the input order, and never leaves out a
  station nearer than one it kept.
- **The smooth step is this package's one copy** (a pure one-liner may
  exist once per package): the framework's `utils/smoothstep.ts` is not a
  deep-import entry of its build, and making it one would pull every
  dependent of the framework into this change.
- The band is 8-42 degrees. The tests run the edge rule over
  other bands too (3-22, 15-60); nothing else here depends on its values.

## Examples

```ts
morphStanding(47.7); // 1: the start view stands everything up
morphStanding(8); // 0
nearStations(spots, { east: 0, north: 0 }, 5, "gate"); // Set of <= 6 ids
selectedStationOf("station:gate", manifest); // "gate"
```

## Tests

`editor3d-visibility.test.ts`: flat at and below 8, upright at and above
42, monotonic between; other bands by the same rule; refusals; near-K's
K nearest plus the selection, ties by id, refusals; `selectedStationOf`
for a station, an item, a code and an unknown id.
`editor3d-visibility.property.test.ts`: the morph monotonic and clamped
for any band and tilts; near-K at most K + 1, always the selection,
order-independent, nothing nearer left out.
