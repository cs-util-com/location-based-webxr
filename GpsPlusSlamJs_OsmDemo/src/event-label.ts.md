# `src/event-label.ts`

## Purpose

Turns a computed `GeoEvent` into the geo-event button's terminal label —
`Event at 14:15 · 640 m NE` — plus the distance/bearing helpers it is built
from.

## Why it exists (F56)

An event tile is ~900 m across and the demo opens at zoom 18, showing a couple
of hundred metres. So the winner marker is **frequently outside the viewport**,
and without a label a successful search is indistinguishable from a button that
did nothing.

Moving the camera to the event was the alternative and was **declined** (owner
decision, 2026-08-04): this demo does not take over the viewport uninvited. A
wayfinding HUD in the 3D `building-view` is scoped as its own round — the
framework's `wayfinding-hud` is three.js/`PerspectiveCamera`-bound and cannot be
pointed at the Leaflet map, so it is a new feature rather than reuse.

## Public API

- `describeGeoEvent(user, event, formatTime?) -> string` — the label. Returns
  `"No event nearby"` when `event.picks` is empty, which is a legitimate
  outcome (a tile that is all water has no event), not an error.
  - `formatTime` is injectable so tests do not depend on the runner's locale or
    timezone. Defaults to `toLocaleTimeString()`.
- `distanceMetres(from, to) -> number` — great-circle metres (haversine).
- `bearingDegrees(from, to) -> number` — initial great-circle bearing, in
  `[0, 360)`.
- `compassPoint(bearing) -> string` — one of the eight points.
- `formatDistance(metres) -> string` — `"640 m"` below a kilometre, else
  `"1.2 km"`.

## Invariants & assumptions

- **It measures to `pick.position`, the SETTLED position — never
  `pick.candidate`.** `candidate` is the raw seed the climb started from (the
  C#'s `RawStartEventPos`); the event is where the climb ended. Reading the
  wrong one reports a distance to a place no event is at. This is the same
  confusion that had the map drawing its winner marker at the seed.
- **`picks[0]` is the nearest**, guaranteed by `newGeoEventFor`'s ordering,
  which sorts by settled position for the same reason.
- **Haversine here, planar in `newGeoEventFor`, and both are correct.** The
  sort only has to decide an ORDER over tiles a kilometre apart, where any
  monotonic function of true distance does and a `sqrt` per comparison is
  waste. This number is shown to a person, so it must be right rather than
  merely monotonic.
- **Bearing uses the `atan2` form, which handles the antimeridian for free.**
  Subtracting longitudes reports "west" for a target just east of the date
  line.
- **Compass buckets are CENTRED on their bearing**, so N owns 337.5°–22.5°. A
  bare `floor(bearing / 45)` labels a target 40° east of north as due north.
- Distances under a kilometre are rounded to 10 m: the underlying H3 cell is
  ~4 m across, so a bare metre count would imply precision that is not there.

## Examples

```ts
describeGeoEvent({ lat: 50.9375, lng: 6.9603 }, event);
// "Event at 14:15 · 640 m NE"

describeGeoEvent(user, { eventTime: 0, picks: [] });
// "No event nearby"
```

## Tests

`src/event-label.test.ts`. Beyond the happy path it pins the three things that
are easy to get wrong and impossible to see:

- the antimeridian bearing (a longitude subtraction points backwards),
- compass bucket centring (a bare floor mislabels due north for half its arc),
- and that the label measures to `position` rather than `candidate` — a fixture
  whose seed sits exactly at the user, so the wrong field would read `0 m`.

No fixtures or test data required; every case is a literal coordinate pair.
