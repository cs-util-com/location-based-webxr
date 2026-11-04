# empty-tour-view.ts

## Purpose

Where the editor on the globe (`editor3d-globe.ts`) opens a tour that has
nothing with a position yet - a new tour, or one of notes alone: the whole
Earth, looking straight down over the creator's own part of the world.
Such a tour used to refuse the 3D view ("nothing with a position"); now
the creator flies down and places the first station by right-clicking the
ground ("New station here").

## Public API

- `EMPTY_TOUR_VIEW` - `lat` 10 (the latitude where the zone's name names
  no region: low enough that the far south - Sydney, Auckland, Buenos
  Aires - lies inside the start height's horizon with the far north),
  `pitchDeg` -89 (straight down has no heading to keep).
- `zoneLatitude(timeZone)` -> a rough latitude for an IANA zone's region
  (its first part: Europe 50, Asia 30, Africa 5, America 40, Australia
  -28, Pacific 15, Atlantic 40, Indian -12, Antarctica -75, Arctic 78),
  with the southern places of the regions that straddle the equator
  (South America -20, including every `America/Argentina/...` zone and
  the older aliases such as `America/Buenos_Aires`; southern Africa -22;
  the South Pacific -25, Auckland among them; the South Atlantic -40).
  `undefined` for a name that names no region (`UTC`, `Etc/GMT+5`, an
  unknown or empty string, `undefined`).
- `emptyTourCentre(timezoneOffsetMin, timeZone?)` -> `{ lat, lng, altM: 0 }`:
  the longitude from the time-zone offset (`getTimezoneOffset()` minutes,
  positive WEST of Greenwich), 15 degrees an hour, wrapped into -180..180
  (180 reads as -180); an offset that is not a finite number reads as
  Greenwich (0). The latitude is `zoneLatitude(timeZone)`, else
  `EMPTY_TOUR_VIEW.lat`.
- `browserZoneHint(source?)` -> `{ offsetMin, timeZone }`: the engine's
  STANDARD offset (the larger of January's and July's offsets: summer time
  is the smaller in either hemisphere and would move the view 15 degrees
  east for half the year) and its zone's name
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`), `undefined` when
  the name is empty or `Intl` throws. `source` (`ZoneSource`) is injected
  by the tests; the default reads the engine's clock.
- `emptyTourView(centre, altitudeKm)` -> `GlobeViewPose`: down at
  `centre` from `altitudeKm`, heading 0. Throws `RangeError` for a place
  that is not finite or a height that is not a positive finite number.

## Invariants & assumptions

- Pure but for `browserZoneHint`'s default source; a type import of the
  globe's view pose only; no three, no DOM.
- The time zone is a hint, not a location: no permission is asked, and a
  zone spans about 15 degrees, so the view is only "your part of the
  world". The region's latitude is where most of its people live, not its
  middle; it only needs to put the creator's home inside the first view.
- The height is the caller's: the globe editor passes the approach's
  start height (`meteorStartAltitudeM`: the link's `startKm`, else the
  globe lab's intro distance at the page's aspect, about 43 600 km on a
  landscape screen), the whole Earth in its lens. From there the whole
  visible half of the Earth is in the picture, so the region's latitude
  decides where the creator's part of the world sits in it (near the
  centre rather than at the rim), not whether it is shown. At the 8 000 km
  start used before, a landscape screen showed about 47 degrees of arc
  either way, and on the offset alone Oslo and Auckland started just off
  it.

## Examples

```ts
const zone = browserZoneHint();
const centre = emptyTourCentre(zone.offsetMin, zone.timeZone);
view.placeView(emptyTourView(centre, startAltitudeM / 1000));
```

## Tests

- `empty-tour-view.test.ts`: the zone's longitude (UTC+1, UTC-5, UTC),
  the latitude by the zone's name (north and south of each straddling
  region, an alias, names that name no region), the wrap past the date
  line, Greenwich for a bad offset, the standard offset in both
  hemispheres, no name where `Intl` throws, the pose, the refusals.
- `empty-tour-view.property.test.ts`: any offset and any zone (arbitrary
  strings and every zone the engine knows) give a place on the globe; for
  33 real zones checked against their cities' real places (ground truth
  independent of the table), the city lies inside the start height's cap
  with the standard or the summer offset, and inside a landscape picture
  of any shape (aspect 1.2-2.4) with the standard one, each at the
  approach's start height for that aspect (`meteorStartAltitudeM`); the
  picture check can fail (a city on the far side of the Earth is not in
  it); the six named
  cities (Oslo, Edinburgh, Sydney, Auckland, Buenos Aires, Los Angeles) on
  a 1440x900 screen and a 390x844 phone; and the check failing for Oslo
  and Auckland on the offset alone.
- e2e `editor3d-globe-default.spec.js`: an empty tour opens on the globe
  over Tokyo's zone and its first station is placed by right-clicking the
  ground.
