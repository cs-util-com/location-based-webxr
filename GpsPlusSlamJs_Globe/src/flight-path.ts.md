# flight-path.ts

The pin's continuous flight: from wherever the camera is to a landing above
the target, in one movement that never stops in between.

- Source: the continuous-flight plan
  `GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
  milestone CF1.
- It replaces today's dive (`globe-dive.ts`) behind the lab's `flight=2`
  until the owner's phone run.

## Purpose

The owner, testing r790 on a phone on 2026-10-07, reported that the dive
"stops again near the Earth, and only then flies in". It should be "one
continuous, clean flight, diving into the atmosphere at an angle".

What today's dive does wrong:

- It starts and ends at rest on one smoothstep.
- It finishes all turning by 40 % of the flight.
- It brakes for its last third, which is where the street-level detail
  first appears.

## Public API

### `FLIGHT_PATH`

The constants, frozen:

- `durationMs`: 15,000.
- `entryPitchDeg`: 22.5 (DEC-CF-2 allows 20-25).
- `landingPitchDeg`: 45.
- `orbitM`: 5,000 km (the pitch is 90 above it).
- `entryM`: 100 km.
- `landingBand`: 5.
- `rampMs`: 800.
- `settleFactor`: 3.
- `startBlendShare`: 0.2.
- `horizonMarginDeg`: 5.
- `floorBlendDeg`: 2.
- `radiusM`: 6,371 km.

### `descentPitchDeg(altM, { landingM, entryDeg?, landingDeg? })`

The view's depression, in degrees:

- 90 above `orbitM`.
- The entry pitch from `entryM` down to `landingBand` x the landing.
- The landing pitch at the landing. This is exact for landings up to
  `entryM`.
- Each band is a smoothstep in the logarithm of the altitude.
- Floored at the horizon's dip + 5 degrees, through a smooth maximum.
- RangeError for a non-finite altitude, a landing that is not positive, or
  a pitch outside (0, 90].

### `planFlight(ellipsoid, start, target, options)`

Returns a `FlightPath`.

- `start` is `{ pose, distanceM, quaternion?, pitchDeg? }`.
  - `pose` is the camera's direction from the centre and its screen's up.
  - `pitchDeg` is the start's view depression. It defaults to 90 (straight
    down). CF2's replan passes the current one.
- `target` is an orbit pose. Only its direction is used.
- `options` is `{ landingM, durationMs?, entryPitchDeg?, landingPitchDeg?,
startSpeed?, settleFactor? }`.
  - `startSpeed` is in geodesic length per ms.
- RangeError for any of:
  - a landing, duration or start distance that is not positive;
  - a pitch outside (0, 90];
  - a negative start speed;
  - a settle factor not above 1;
  - an up parallel to the direction.
- Also exposed, for CF2 and the tests:
  - `cruise`: `{ fromMs, toMs }`, between the ramp and the settle. It is
    null for a short path.
  - `travelledAt(t)`: the clock.
  - `geodesicLength`.
  - `cameraStart`, `cameraEnd`, `courseNormal`.

### `flightAt(path, tMs)`

Returns a `FlightFrame`:

- `centre`, `up`, `camera` (the camera's direction), `altitudeM`.
- `arcRad`: the angle from the view's centre to the target.
- `pitchDeg`.
- `startWeight`: from 1 down to 0.
- `done`.

The ends are exact and held outside [0, durationMs]. A NaN time throws a
RangeError.

### `flightCamera(path, tMs)`

Returns `{ position, quaternion, altitudeM, done }`. It is `obliqueCamera`
on the frame, with the start's tilt fading out.

## How it works

### The camera flies the path; its view looks ahead

The camera flies van Wijk and Nuij's smooth zoom-and-pan (InfoVis 2003; d3's
`interpolateZoom`), with rho = 1.

- In (ground distance u, altitude h) the path is a geodesic of
  ds^2 = (du^2 + dh^2) / h^2.
- That is the same measure the flight is judged by:
  v = sqrt((d ln h/dt)^2 + (ground speed / h)^2).
  - So when the path is travelled at a constant ds/dt, the camera's speed is
    constant.
- A high start only descends.
- A low, far start climbs first. The arch rises to about half the ground
  distance.

It is the CAMERA that flies the geodesic, from its start to its own landing
point. That point is behind the target, so the camera looks at the target
at the landing pitch.

- The CF1 milestone review measured a path flown by the view's centre
  instead:
  - its camera slid backwards at up to 137 km/s as the view tilted;
  - it ran 2.7 times faster below 100 km than above.

The geodesic's formulas:

- b0 and b1 come from the two ends.
- r = -asinh(b). This is van Wijk's ln(sqrt(b^2 + 1) - b) without the
  cancellation.
- share(s) = (h0 / d) sinh(s) / cosh(s + r0). This is
  cosh r0 tanh(s + r0) - sinh r0 without the cancellation.
- h(s) = h0 cosh r0 / cosh(s + r0), for s in [0, r1 - r0].
- A ground distance under 1e-9 of the lower altitude is flown as a pure
  zoom.

### The clock

- A ramp from `startSpeed` to the cruise speed over `rampMs`. The speed
  follows a smoothstep.
- A constant cruise.
- One settle over the last ln(`settleFactor`) of the path, starting at about
  `settleFactor` x the landing. That is 3.3 s of the default flight.
- The cruise speed is v = (L + settle - startSpeed x ramp / 2) / (duration -
  ramp / 2).
- A path too short for a cruise uses a cubic Hermite, from the start's speed
  to rest.
  - Its start speed is capped at 3 x the length over the duration. Faster
    than that, the curve would pass the end.
  - This cap is the one case where the start's speed is not kept. CF2
    chooses its duration so that it never reaches the cap.

### The view

- The heading is the course along the great circle to the target, taken at
  the camera.
  - A target nearer than one landing keeps the start's heading. A start
    1 m north of the target used to roll the view 180 degrees (CF1 review
    finding 5).
- The heading blends from the start's up through a single roll, fixed when
  the path is planned.
  - It was recomputed every frame from a cross product of two near-opposite
    vectors. That product was rounding noise, its sign flipped, and the view
    turned by up to 179 degrees in one frame (finding 1).
- The view's centre is ahead of the camera along the heading, at
  `descentPitchDeg`.
  - Its altitude is measured over the surface under the centre, as
    `obliqueCamera` places it. `centreAhead` finds it with a four-step fixed
    point.
- The start's pitch, roll and tilt blend out over the first fifth of the
  flight.

## Invariants

Each one is tested, on the camera.

- The ends are exact.
  - At the press, the camera is the start camera, including oblique starts.
  - At the end, it is at the landing above the target, at the landing
    pitch. The frame before the end is within a metre of it.
- The camera never goes below the lower of its start and its landing.
- The camera never moves away from its landing point.
  - A start that is already nearer than that point, such as a climb over
    the target, correctly moves away from the target itself.
- On the way down, the camera's remaining ground distance is at most 2 x the
  height above the landing, plus one landing altitude.
- The view never turns more than 3 degrees in one 60 Hz frame. This holds
  for approaches from all four sides and along meridians.
- After the start's blend, the view looks ahead along the course.
- The start's speed is kept, except at the documented cap.
- **The "never stops in between" criterion** holds on the camera over the
  cruise:
  - (a) no stall: v is at least half its median;
  - (b) no stop-and-go, at tolerances 0.1, 0.2 and 0.3;
  - (c) no late surge: v below 100 km is at most 1.25 x the largest v above
    100 km.
  - It is checked at 4-120 Hz, i.e. with difference windows from 250 ms down
    to 8 ms.
  - It is checked for:
    - starts from the landscape fit, the portrait fit, the spin, and low and
      far away;
    - arcs of 0-179 degrees;
    - landings at 2 and 12 km;
    - settles starting at 2, 3 and 5 x the landing;
    - a pure climb.
- Each of the criterion's checks catches a synthetic example of its own
  failure shape.
- The positive control: today's paced dive fails (c) when the data is
  released at 100, 30 or 10 km.

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

- `flight-path.test.ts`: the examples and the criterion sweep.
- `flight-path.property.test.ts`: properties over random flights of 0.5 to
  60 s.
  - It checks the ends, the floor, the arc bound, and that the camera never
    moves backwards.
  - It checks criteria (a) and (b) at 60 Hz.
- `src/test-utils/flight-speed.ts`: the shared criterion.
  - It uses the chord form for small angles. `angleTo` goes through acos,
    which reads anything under 9.5 cm on the Earth as 0.
- Hand mutants, each killed by its own test:
  - the clock as a single smoothstep;
  - no course heading;
  - a view that does not look ahead;
  - no climb.
