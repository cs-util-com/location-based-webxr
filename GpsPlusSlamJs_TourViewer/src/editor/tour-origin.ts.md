# tour-origin.ts

## Purpose

The tour's origin, pure: the middle of the tour the 3D view centres its
frame and first orbit on, and where a point stands as metres east and
north of it, exactly as the 3D view's frame draws it. The inspector says a
station's or a code's place in these metres (as the plan and the studio
prototype do: "E -45.0 N -12.0"), so the number it shows is where the 3D
view draws the point.

## Public API

- `tourCentre(stations, codes)` -> `{ lat, lng, altM }`: the mean of the
  stations' points, else of the codes'; null with neither. Points with a
  coordinate that is not finite are left out.
- `eastNorthOf(point, origin)` -> `{ eastM, northM }`, or null when the
  point or the origin is not a place (a coordinate not finite, a latitude
  past a pole). Both on the WGS84 ellipsoid (height 0); the metres are the
  east and north axes of the plane touching the ellipsoid at the origin.
- `placeAtEastNorth({ eastM, northM }, origin)` -> `{ lat, lon }`: the
  inverse, the place `eastNorthOf` reads back as those metres (to well
  under a millimetre over a tour's reach): the inspector's typed east and
  north become a station's place by it. Null for metres that are not
  finite or an origin that is not a place.

## Invariants & assumptions

- **The 3D view's frame:** `editor3d-scene.ts` centres the globe's
  `worldFromEcefAt` on `tourCentre`; `eastNorthOf` is that frame's x and
  -z for a point on the ellipsoid, to the millimetre (checked against the
  globe's function).
- **The centre is a plain mean of degrees:** right for a tour of a few
  hundred metres; a tour across the antimeridian is not handled.
- Heights are left out of the metres: a point's height is said apart (the
  file's ellipsoidal height).
- Pure, and free of the 3D view's code: the shell and the inspector import
  it on the page's first load; the 3D view imports it too.

## Examples

```ts
const centre = tourCentre(manifest.stations, codeGeos);
const at = centre === null ? null : eastNorthOf(station.geo, centre);
// at: { eastM: -45.0, northM: -12.0 }
```

## Tests

`tour-origin.test.ts`: the centre of the stations, else the codes, else
none, and points that cannot be placed left out; the metres against the
3D view's frame (the globe's `worldFromEcefAt` on a textbook WGS84) at
three latitudes and up to about 1.2 km out; null for a point or an origin
that is not a place; `placeAtEastNorth` read back by `eastNorthOf` within
a millimetre (property, 2 km either way, latitudes to 80 degrees), and
null for metres or an origin that are no place.
