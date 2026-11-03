# empty-tour-view.ts

## Purpose

Where the editor on the globe (`editor3d-globe.ts`) opens a tour that has
nothing with a position yet - a new tour, or one of notes alone: the whole
Earth, looking straight down over the creator's own part of the world.
Such a tour used to refuse the 3D view ("nothing with a position"); now
the creator flies down and places the first station by right-clicking the
ground ("New station here").

## Public API

- `EMPTY_TOUR_VIEW` - `lat` 10 (fixed, low enough that the far south -
  Sydney, Auckland, Buenos Aires - lies inside the start height's horizon
  with the far north; at 30 N they lay past it), `pitchDeg` -89 (straight
  down has no heading to keep). At the 50 degree lens and the 8 000 km
  start, a landscape screen's top and bottom edges sit about 47 degrees of
  arc from the centre, so Oslo (50) and Auckland (51) start just off screen
  there, inside the horizon; no one latitude fits both ends on screen.
- `emptyTourCentre(timezoneOffsetMin)` -> `{ lat, lng, altM: 0 }`: the
  longitude from the browser's time-zone offset
  (`new Date().getTimezoneOffset()`, minutes, positive WEST of Greenwich),
  15 degrees an hour, wrapped into -180..180 (180 reads as -180). An
  offset that is not a finite number reads as Greenwich (0).
- `emptyTourView(centre, altitudeKm)` -> `GlobeViewPose`: down at
  `centre` from `altitudeKm`, heading 0. Throws `RangeError` for a place
  that is not finite or a height that is not a positive finite number.

## Invariants & assumptions

- Pure: a type import of the globe's view pose only; no three, no DOM.
- The time zone is a hint, not a location: no permission is asked, and a
  zone spans about 15 degrees, so the view is only "your part of the
  world". The latitude is not guessed.
- The height is the caller's: the globe editor passes the approach's
  start height (`startKm`, 8000 km by default), the whole Earth in its
  lens.

## Examples

```ts
const centre = emptyTourCentre(new Date().getTimezoneOffset());
view.placeView(emptyTourView(centre, knobs.startKm));
```

## Tests

- `empty-tour-view.test.ts`: the zone's longitude (UTC+1, UTC-5, UTC),
  the wrap past the date line (UTC+14, UTC-12), Greenwich for a bad
  offset, the pose looking down from the given height, the refusals.
- `empty-tour-view.property.test.ts`: any offset gives a place on the
  globe; any positive height gives a pose down at the centre.
- e2e `editor3d-globe-default.spec.js`: an empty tour opens on the globe
  and its first station is placed by right-clicking the ground.
