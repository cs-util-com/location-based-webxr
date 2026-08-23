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
    timezone. Defaults to `describeEventTime`.
- `describeEventTime(at, today?) -> string` — the RESOLVED slot: `hh:mm` today,
  `"9 Aug 18:15"` otherwise.
  - **The date is conditional, and that is the W6 requirement.** A time-only
    label was fine while every search meant "now" and could only be today; a
    picker makes "next Tuesday at 18:00" expressible, and `18:15` for it is
    indistinguishable from today's.
  - **It shows the RESOLVED slot, not the requested instant.** `nextEventTime`
    quantises to the next quarter-hour, so a request for 18:07 legitimately
    produces an 18:15 event; showing what was asked for would make the label and
    the marker disagree about the same thing.
  - `map-view.ts` uses it for the marker tooltip too. That was a second inline
    `toLocaleTimeString`, which would have had the button saying "9 Aug 18:15"
    while the marker beside it said "18:15:00".
- `GEO_EVENT_IDLE_LABEL` / `GEO_EVENT_BUSY_LABEL` — the button's other two
  states, exported so `index.html`, the unit tests and the e2e name one string.
- `geoEventButtonLabel(view, busy, formatTime?) -> string` — the WHOLE of what
  the button displays, as a pure function of `(busy, position, geoEvent)`. It
  used to be written at the call site on success and reset on failure, so it
  could describe markers that were no longer there; deriving it also makes the
  distance re-read as the user walks, which a frozen string could not.
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

## Round two rewrote most of this (F4a, F4b, F4c, F4e — 2026-08-19)

**Everything above that describes the button as carrying the description is
stale.** It did, and that is exactly why it resized on every press.

- `GEO_EVENT_IDLE_LABEL` is now **"Show Quests"** (DEC-U11 — a UI string only;
  the store, the worker protocol and this module still say `geoEvent`).
- `geoEventButtonLabel(busy)` takes **only `busy`** and returns one of two
  constants. It no longer sees the position or the held quest, and no longer
  takes a time formatter.
- **`geoEventReadout(view)` is new, and it is where F56's win went.** The label
  used to re-read as the user walked — "640 m NE" becoming "210 m NE" — because
  it was derived from the current position rather than frozen when the search
  returned. A constant label deletes that, and neither replacement restores it:
  a toast fades and a map pan does not restate. This returns distance and
  bearing only (no time, no tile count — those do not change as you move), and
  the empty string when there is no quest, so the caller hides the element
  rather than reserving space.
- **`describeGeoEvent` drops the tile count on the SUCCESS path** and keeps it
  when nothing was found (F4e). On success there is a marker on the map, which
  answers the question the count was helping with; in the empty case it is the
  only thing separating "there is none here" from "you have not loaded enough
  to know" (F57), and the second reads as a bug. Its wording is now "Quest at …"
  and "No quest nearby · searched N tiles".
- **The module header's F56 argument is reversed** (DEC-U12): the map DOES move
  now, on an explicit press, at the current zoom. F56 objected to an _uninvited_
  takeover, which a button press is not.
