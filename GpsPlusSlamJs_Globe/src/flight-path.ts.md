# flight-path.ts

The pin's continuous flight: from wherever the camera is to a landing
above the target, as one movement that never stops in between
(continuous-flight plan `GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
CF1). It replaces today's dive (`globe-dive.ts`) behind the lab's
`flight=2` until the owner's phone run.

## Purpose

The owner (2026-10-07, r790 on a phone): the dive "stops again near the
Earth, and only then flies in"; it should be "one continuous, clean
flight, diving into the atmosphere at an angle". Today's dive starts and
ends at rest on one smoothstep, finishes all turning by 40 %, and brakes
for its last third, where the street-level detail first appears.

## Public API

- `FLIGHT_PATH`: the constants (frozen).
  - `durationMs` 15,000; `entryPitchDeg` 22.5 (DEC-CF-2, 20-25);
    `landingPitchDeg` 45; `orbitM` 5,000 km (90 above), `entryM` 100 km,
    `landingBand` 5.
  - `arcPerAltitude` 2: the bound on the remaining ground distance over
    the height above the landing, on the way down.
  - `rampMs` 800, `settleFactor` 3, `startBlendShare` 0.2.
  - `horizonMarginDeg` 5, `floorBlendDeg` 2, `radiusM` 6,371 km.
- `descentPitchDeg(altM, { landingM, entryDeg?, landingDeg? })`: the
  view's depression below the horizontal, in degrees.
  - 90 above `orbitM`, the entry pitch from `entryM` down to
    `landingBand` x the landing, and the landing pitch at the landing.
  - Each band is a smoothstep in the log of the altitude.
  - It is floored at the horizon's dip + 5 degrees, through a smooth
    maximum, so there is no kink.
  - The landing pitch is exact for landings up to `entryM`.
  - RangeError for a non-finite altitude or a non-positive landing.
- `planFlight(ellipsoid, start, target, { landingM, durationMs?,
entryPitchDeg?, landingPitchDeg?, startSpeed? })` returns a `FlightPath`.
  - `start` is `{ pose, distanceM, quaternion? }`, as `DiveStart`.
  - `target` is an orbit pose; only its direction is used.
  - `startSpeed` is the path's speed at the press (geodesic length per
    ms; default 0, from rest). CF2's replan passes the current one.
  - RangeError for a non-positive landing or duration, or a negative
    start speed.
- `flightAt(path, tMs)` returns `FlightFrame`: `centre` (a unit vector on
  the great circle), `up`, `altitudeM`, `arcRad` still to go, `pitchDeg`,
  `startWeight` (from 1 at the press to 0) and `done`. The ends are exact
  and held outside [0, durationMs].
- `flightCamera(path, tMs)` returns `{ position, quaternion, altitudeM,
done }`: `obliqueCamera` on the frame, with the start's own tilt fading
  out.

## How it works

- **The path** is van Wijk and Nuij's smooth zoom-and-pan (InfoVis 2003;
  d3's `interpolateZoom`) with rho = 1.
  - In (ground distance u, altitude h) it is a geodesic of
    ds^2 = (du^2 + dh^2) / h^2. That is the measure the flight is judged
    by: the cold review's v = sqrt((d ln h/dt)^2 + (ground speed / h)^2).
  - Travelled at a constant ds/dt, its speed is constant by that measure.
  - A high start only descends. A low, far start climbs first (the
    geodesic's arch, about half the ground distance high).
  - Near the end the remaining ground distance shrinks with the square of
    the altitude.
  - Formulas: b0, b1 from the ends; r = -asinh(b), the stable form of
    van Wijk's ln(sqrt(b^2 + 1) - b); then
    share(s) = h0/d (cosh r0 tanh(s + r0) - sinh r0) and
    h(s) = h0 cosh r0 / cosh(s + r0), over s in [0, r1 - r0].
  - A ground distance under a thousandth of the lower altitude is flown as
    a pure zoom. Van Wijk's terms grow as 1/d and cancelled to NaN for a
    press right above the target (found by the property test).
- **The clock** maps time to path length:
  - a ramp from `startSpeed` to the cruise speed over `rampMs` (a
    smoothstep in the speed);
  - a constant cruise;
  - one settle over the last ln(3) of the path (about 3 x the landing
    down), a smoothstep down to 0.
  - The cruise speed v = (L + settle - startSpeed x ramp / 2) /
    (duration - ramp / 2) ends the path at the duration. A path too short
    for a cruise falls back to one smoothstep.
- **The view:**
  - The view's centre travels the great circle from the start's centre to
    the target. At antipodes it goes over the start's up, as `turnPose`
    does.
  - The camera is `obliqueCamera`'s, behind the centre along `up`, and up
    is the course (the great circle's tangent towards the target). So it
    flies forwards, never backwards or crabbing (cold review finding 2).
  - Over the first fifth the start's own pitch (90), roll (its up carried
    along the arc) and tilt (its offset from its orbit view) blend out.

## Invariants

Each one has a test.

- The ends are exact: at 0 it is the start camera (to a micrometre per
  metre of distance), and at the duration it is the landing above the
  target at the landing pitch.
- It never goes below the lower of the start and the landing.
- On the way down, the remaining ground distance is at most
  `arcPerAltitude` x the height above the landing, plus one landing
  altitude (a target nearer than the altitude is flown near the
  geodesic's top, where the height barely falls).
- The view's centre stays on the great circle.
- The camera is behind the centre along its course.
- **The cold review's "never stops in between" criterion holds.** It is
  measured from 0.5 s after the press to the final descent through 3 x the
  landing, at 30, 60 and 120 Hz:
  - (a) no stall: v is at least half its median;
  - (b) no stop-and-go: v_j >= 0.8 x min(v_i, v_k) for every i < j < k
    (the tolerances 0.1, 0.2 and 0.3 are swept, and 0.2 is asserted);
  - (c) no late surge: v below 100 km is at most 1.25 x the largest v
    above 100 km.
  - It holds for starts from the landscape fit, the portrait fit, the spin
    and low-and-far, for arcs of 0-179 degrees, and for landings at 2 and
    12 km.
- The positive control: today's dive on the paced clock fails (c) when the
  data is released at 100, 30 or 10 km (measured 2026-10-07). A release at
  500 km passes, because it surges above 100 km, where no criterion looks.

## Example

```ts
const path = planFlight(
  WGS84_ELLIPSOID,
  { pose, distanceM, quaternion },
  orbitPose(WGS84_ELLIPSOID, target),
  { landingM: 2_000 },
);
const { position, quaternion, done } = flightCamera(path, now - pressedAt);
```

## Tests

- `flight-path.test.ts` (examples): the pitch law, the ends, the arc
  bound, the great circle, the heading, the descent, the climb, the
  near-zero arc, the criterion sweep, and the positive control.
- `flight-path.property.test.ts`: random starts, targets, landings and
  durations, checking the ends, the floor, the arc bound, and criteria (a)
  and (b) at 60 Hz.
- The lab wiring (`flight=2`), the replan (CF2) and the pace (CF3) come
  in later milestones.
