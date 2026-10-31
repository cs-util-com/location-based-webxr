# globe-approach-flight.ts

## Purpose

The approach on opening a tour in the globe editor, as pure maths: the
camera starts high above the Earth, turns the globe towards the tour and
falls to the street view, and a progress bar follows the camera's height.
Time in, a view pose and the bar's value out. A station picked in the list
mid-flight retargets the flight from wherever the camera is.

## Public API

- `GLOBE_APPROACH` - the constants:
  - `startHeightKm` 8 000 (over the tour's ground);
  - `startOffsetLngDeg` 35 and `startOffsetLatDeg` 12 (the start lies
    west and south of the goal, so the globe visibly turns);
  - `durationMs` 13 000 (inside the owner's 10 to 20 s);
  - `reducedDurationMs` 2 000 (under `prefers-reduced-motion`);
  - `turnShare` 0.4 (place and heading move over the first 40 %);
  - `pitchShare` 0.7 (straight down until 70 %, then tips to the goal's);
  - `retargetMinMs` 1 500 (a retarget never flies for less).
- `ApproachFlight` - `{ from, to, groundM, durationMs, pitchShare, barFromM }`.
- `approachFlight(goal, groundM, { reducedMotion?, durationMs? })` - the
  flight to `goal`; `durationMs` overrides the length (the page's checks).
- `retargetFlight(flight, now, elapsedMs, goal, groundM)` - a flight from
  `now` to a new goal: what is left of the old one (at least
  `retargetMinMs`), the pitch turned evenly, the bar's scale kept.
- `flightDone(flight, elapsedMs)`.
- `flightPoseAt(flight, elapsedMs)` - the pose; the ends exact and held.
- `barValue(flight, altitudeKm)` - 0 to 1 on a log scale of the height
  over the ground.

## Invariants and assumptions

- The height over the ground falls evenly in its logarithm, eased at both
  ends (smoothstep): it never rises and never pauses, so the flight never
  looks stuck. A property test checks that every stretch of the flight
  falls by a visible share.
- Longitudes go the short way round and stay in [-180, 180); the start's
  latitude is clamped to +-80.
- The bar's value never runs back across a retarget: `barFromM` keeps the
  higher of the old start and the camera's height then.
- Defensive: a goal or ground that is not finite, a length that is not a
  positive number, or a retarget from a pose that is not finite throws a
  RangeError. A time that is NaN reads as the end; a height that is not
  finite reads as a bar of 0. Heights are clamped to at least 1 cm for the
  logarithm.

## Examples

```ts
const flight = approachFlight(streetPose, groundM);
const pose = flightPoseAt(flight, performance.now() - startMs);
const bar = barValue(flight, pose.altitudeKm);
```

## Tests

- `globe-approach-flight.test.ts` - the ends, the turn, the pitch, the
  retarget, reduced motion, the errors.
- `globe-approach-flight.property.test.ts` - a monotone fall, a rising
  bar, longitudes in range, and a visible fall per stretch swept over 10,
  20 and 40 stretches.
