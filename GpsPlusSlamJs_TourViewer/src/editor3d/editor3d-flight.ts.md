# editor3d-flight.ts

## Purpose

The 3D editor's camera flights, pure: a click on a card flies the orbit to
a station or an item, Frame fits the tour, the compass turns north up,
plus and minus zoom, Top view looks straight down. Each is a short flight
from the orbit's pose now to a goal pose.

## Public API

- `OrbitPose` - `{ target, distanceM, polarRad, azimuthRad }` (x east, y
  up, z south; azimuth 0 puts the camera south of its centre).
- `FLIGHT` - the rules and timings: `flatCapRad` (acos 0.35, about 70
  degrees of tilt), `topPolarRad` 0.0006, `untopPolarRad` 0.83,
  `itemMaxM` 60, `minFrameM` 4, `stationMargin` 1.05, `zoomStep` 1.6,
  and the flights' times (fly 700, frame 600, zoom 350, turn 600, top
  550 ms).
- `orbitPoseOf(position, target)`, `orbitPosition(pose, out)` - to and
  from a camera position.
- `clampedPose(pose)` - within `EDITOR_CAMERA`'s distance and tilt limits.
- `orbitPoseBetween(from, to, k)` - the pose at `k` (clamped to 0..1) on
  an ease-in-out cubic: the centre in a straight line, the distance on a
  log scale, the tilt evenly, the turn the short way; exactly `to` at 1.
- `frameDistanceM(radiusM)` - the distance that fits a sphere in the lens,
  at least `minFrameM`.
- `flightGoal(now, { at, radiusM, kind })` - a station framed by its
  radius and margin; an item or a code at the distance now, but at least
  three frames of it and at most `itemMaxM`; the turn kept, the tilt
  capped at `flatCapRad`. RangeError for a radius that is not a finite
  number >= 0.
- `tourFrame(points)` - `{ centre, radiusM }` holding every point's
  circle, or null without a point.

## Invariants & assumptions

- A flight starts where the camera is and ends exactly at its goal; no
  flight ends looking along the ground.
- Pure apart from `three`'s vector maths; the scene runs the flight per
  frame (`editor3d-scene.ts`), and a drag by the creator ends it.

## Examples

```ts
const from = orbitPoseOf(camera.position, controls.target);
const goal = flightGoal(from, {
  at: stationPoint,
  radiusM: 25,
  kind: "station",
});
placeOrbit(orbitPoseBetween(from, goal, elapsedMs / FLIGHT.flyMs));
```

## Tests

`editor3d-flight.test.ts`: the pose round trip, a flight's ends, the
short turn, the log distance, the property that every point stays between
its ends, the station and item goals (and the 60 m cap), the bad radius,
and `tourFrame`. In the page: `playwright-tests/editor3d-shell.spec.js`.
