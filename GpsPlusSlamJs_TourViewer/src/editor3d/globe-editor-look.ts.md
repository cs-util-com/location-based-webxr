# globe-editor-look.ts

## Purpose

The editor on the globe view (`editor3d-globe.ts`), its look and its
per-frame rules, kept pure (no WebGL): the view's settings, the first view
at street level, which carrier draws the ground at an altitude, which
objects the visibility rules hide this frame, an aimed view at an object,
and a camera pose read back as a view.

## Public API

- `GLOBE_EDITOR_LOOK` (frozen): `fovYDeg` 50, `backM` 30, `eyeM` (the
  globe's eye height), `reliefCeilingM` 25,000 and `reliefBandM` 5,000 (the
  carrier switch; declared, not measured), `aimPitchDeg` -30, `aimRadii` 3.
- `globeEditorSettings()`: the view's settings, the same frozen object
  every call (world frame follows the target, sky on, the lab's navy space,
  no debug hole colour, the globe's cloud drift law).
- `streetView(centre, groundM)`: `backM` south of the centre, `eyeM` over
  `groundM`, facing north and down at the centre's ground. RangeError for a
  value that is not finite.
- `reliefCarries(altitudeM, wasRelief)`: whether the relief carries the
  ground; the carrier changes only `reliefBandM` past the ceiling. NaN keeps
  the carrier.
- `globeHidden(objects, was, knobs, selected)`: the hidden stations and
  codes. Size first (`sizeShown`, with hysteresis through `was`), then
  crowding over the stations still shown and on screen (`crowdedPins`). The
  selected station never hides. RangeError from the rules for a knob out of
  range.
- `aimView(place, heightM, radiusM)`: a view looking down at the place from
  the south at `aimPitchDeg`, `aimRadii` x radius away (`backM` at least).
  RangeError for a value that is not finite or a negative radius.
- `viewPoseOf(ellipsoid, pose)`: the inverse of the globe's `viewPoseEcef`;
  heading in [0, 360), 0 when looking straight down.
- Types `GlobeObjectOnScreen`, `GlobeHiddenSet`.

## Invariants & assumptions

- The stand-back uses a mean metres-per-degree of latitude; fine for tens
  of metres to kilometres.
- The carrier thresholds are a look to tune on screen, not a measurement.

## Example

```ts
view.placeView(streetView({ lat: 48.1, lng: 11.6 }, 515));
relief = reliefCarries(altitudeM, relief);
hidden = globeHidden(onScreen(), hidden, knobs, selectedStation);
```

## Tests

`globe-editor-look.test.ts`: the street view's geometry, the settings, the
carrier's band, the size and crowding rules with their hysteresis and the
selected station, the aimed view on its line of sight, and the pose round
trip through `viewPoseEcef`.
