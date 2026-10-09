# flight-path.ts

The pin's continuous flight: from wherever the camera is to a landing above
the target, in one movement that never stops in between.

- Source: the continuous-flight plan
  `GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
  milestone CF1; its curve since the round-2 plan
  `2026-10-07-2350-globe-flight-round-2-owner-feedback-plan.md` (R1:
  `flight-travel.ts`).
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
- `rampMs`: 800.
- `settleFactor`: 3.
- `startBlendShare`: 0.2.
- `radiusM`: 6,371 km.

The pitch law and its constants (DEC-CF-2's shallow entry, retired by the
owner's round-2 "look where it flies") live in `flight-travel.ts`.

### `planFlight(ellipsoid, start, target, options)`

Returns a `FlightPath`.

- `start` is `{ pose, distanceM, quaternion?, pitchDeg? }`.
  - `pose` is the camera's direction from the centre and its screen's up.
  - `pitchDeg` is the start's view depression. It defaults to 90 (straight
    down). CF2's replan passes the current one.
- `target` is an orbit pose. Only its direction is used.
- `options` is `{ landingM, durationMs?, startSpeed?, settleFactor?,
settleLength?, viewLandingM?, rampMs?, rampFromShare?, brake? }`.
  - `startSpeed` is in geodesic length per ms.
  - `viewLandingM` is the landing the view's law refers to (default
    `landingM`). A path that stops short of the real landing (CF3's
    hold at 2,000 km) passes the real one, so it looks there as the whole
    flight would; its end pitch is that law's (straight down above the
    bend), not 45.
  - `rampMs` (default `FLIGHT_PATH.rampMs`) and `rampFromShare` (0-1,
    default 0): a replan continuing an old ramp passes its remaining time
    and the share of the smoothstep it had reached, so the speed follows
    the old ramp's tail exactly.
  - `settleLength` (geodesic length, at most the path's): the settle's
    length, given instead of the one from `settleFactor`. A replan towards
    the same destination keeps its old flight's settle with it, so the
    settle starts where it would have (CF3 review finding 3).
  - `brake`: brake from `startSpeed` to rest over the whole flight (a
    cubic Hermite), no cruise: a replan in the final settle.
- RangeError for any of:
  - a landing, duration or start distance that is not positive;
  - a pitch outside (0, 90];
  - a negative start speed;
  - a settle factor not above 1;
  - a negative ramp, or a ramp share outside [0, 1);
  - a negative settle length;
  - an up parallel to the direction.
- Also exposed, for CF2 and the tests:
  - `cruise`: `{ fromMs, toMs }`, between the ramp and the settle. It is
    null for a short path.
  - `travelledAt(t)`: the clock.
  - `cruiseSpeed` (0 for a short path), `rampFromShare` and `settleLength`.
  - `viewLandingM` and `endPitchDeg`.
  - `geodesicLength` (the travel curve's length; the name is CF1's),
    `geodesicAt` and `pitchAt` (the curve by path length) and
    `diveArcRad` (the dive's own track: a nearer start backs off).
  - `cameraStart`, `cameraEnd`, `courseNormal`, and the camera's motion
    in the course's plane: `planeStart`, `offPlaneRad` and the signed
    `cameraArcRad`.

### `flightAt(path, tMs)`

Returns a `FlightFrame`:

- `centre`, `up`, `camera` (the camera's direction), `heading` (a
  tangent at the camera), `altitudeM`.
- `arcRad`: the angle from the view's centre to the target.
- `pitchDeg`.
- `startWeight`: from 1 down to 0.
- `done`.

The ends are exact and held outside [0, durationMs]. A NaN time throws a
RangeError.

### `viewFromCamera(ellipsoid, camera, heading, altitudeM, pitchDeg)`

Returns `{ centre, up }`: the ground point a camera looks at, ahead along
its heading, and the screen's up there. `flightAt` builds its view with
it, and so does a replan's join, which moves the camera and never the
view.

### `rampCruiseShare(fromShare)`

The share c of a ramp's span flown at the cruise speed, for the clock's
formula: a ramp from s0 to v over T covers T (s0 (1 - c) + v c). A full
ramp has c = 1/2.

### `flightCamera(path, tMs)`

Returns `{ position, quaternion, altitudeM, done }`. It is `obliqueCamera`
on the frame, with the start's tilt fading out.

## How it works

### The camera flies the travel curve; its view looks where it goes

The camera flies `flight-travel`'s curve, along the great circle from its
start to its own landing point (behind the target, so it ends looking at the
target 45 degrees down):

- high up it turns first while looking straight down, the turn done by the
  bend (100 km, or 25 landings) for a start at least 1.65 x the bend up (a
  big turn from just above the bend continues below it, the view by the
  law there);
- below the bend it dives along the law's track, bending into 45 degrees at
  the landing, its view the direction of travel (never shallower than the
  dive's own angle);
- a start nearer than the dive's own track backs off first; a start below
  the bend and far away pans at its own altitude (it gave up van Wijk's
  climb, one path family; the documented limit);
- the path length is the measure the flight is judged by, v = sqrt((d ln
  h/dt)^2 + (ground speed / h)^2), so at a constant ds/dt the camera's
  speed is constant.

It replaced van Wijk and Nuij's zoom-and-pan (CF1): its descent ends nearly
vertical (its geodesics are circles meeting the ground at right angles), so
it could not end at 45 degrees, and its view tilted to the shallow entry
long before the camera did (the owner's round-2 point 1). The camera, not
its view's centre, flies it: the CF1 milestone review measured a
centre-flown path sliding the camera backwards at up to 137 km/s. The
curve's share is not clamped: a back-off is a negative share, and clamped
it stood still and only descended (found in R1).

The camera moves in the course's plane, from the start's point in it by
the curve's SIGNED angle about the course's normal. An unsigned arc to an
end behind the start (the pin's ordinary press over its own fix: the end
lies one landing behind the target) flew the whole dive backwards (the R1
milestone review, finding 1). A start within one landing of the target can
lie off the plane, which runs along its own heading there; that offset
fades out with the curve's residual, so both ends stay exact.

The course's normal is made exactly perpendicular to the target, in every
branch. From a start a hair off the target's antipode the cross product is
about 1e-12 long, its normal was off by about 1e-4, the target and the
camera's end lay off the plane, and the curve's last moment missed the end
by 6.4 micrometres, a snap at the landing (a property counterexample,
2026-10-08; tested from 180, 179.99999999994273, 179.9999 and 179.9
degrees).

### The clock

- A ramp from `startSpeed` to the cruise speed over `rampMs`. The speed
  follows a smoothstep.
- A constant cruise.
- One settle over the last ln(`settleFactor`) of the path, starting at about
  `settleFactor` x the landing. That is 3.3 s of the default flight.
- The cruise speed is v = (L + settle - startSpeed x ramp (1 - c)) /
  (duration - ramp (1 - c)), with c from `rampCruiseShare` (1/2 for a full
  ramp).
- A path too short for a cruise uses a cubic Hermite, from the start's speed
  to rest.
  - Its start speed is capped at 3 x the length over the duration. Faster
    than that, the curve would pass the end.
  - This cap is the one case where the start's speed is not kept. CF2's
    replans brake over 2L / s0, where the speed is 2L / D, inside the cap;
    a pinned test holds the cap itself.

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
- The view's centre is ahead of the camera along the heading, at the
  curve's pitch (`pitchAt`).
  - Its altitude is measured over the surface under the centre, as
    `obliqueCamera` places it. `centreAhead` finds it with a four-step fixed
    point.
- The start's pitch, roll and tilt blend out over the first fifth of the
  flight.
  - The pitch blends the start's OFFSET from the curve's (`startLawDeg`,
    its pitch at the start), so a replan whose start already follows
    the law keeps turning with it. Blending the start's pitch itself held
    it fixed and froze the view's turn at every replan (CF3 review
    finding 5).

## Invariants

Each one is tested, on the camera.

- The ends are exact.
  - At the press, the camera is the start camera, including oblique starts.
  - At the end, it is at the landing above the target, at the landing
    pitch. The frame before the end is within a metre of it.
- The camera never goes below the lower of its start and its landing.
- The camera never moves away from its landing point, but to make room for
  the dive: a start nearer than the dive's own track backs off, never
  further than that track.
- From a start at least 1.65 x the bend up (e^0.5, the largest margin a turn
  takes), below the bend the camera's remaining ground
  distance is at most 2 x the height above the landing, plus one landing
  altitude. A start below the bend never climbs.
- The view looks straight down above the bend and lands 45 degrees down;
  never less than 5 degrees below the horizon; no step or corner in its
  pitch at 60 Hz.
- The view never turns more than 3 degrees in one 60 Hz frame on the tested
  flights: approaches from all four sides and along meridians, starts just
  above the bend (101-200 km from Rome, Zurich and 60 degrees west), and a
  replan in the last half second (a start low and far away, the documented
  limit, is not covered).
- The camera travels the way it looks below the bend: from a start over the
  target or 0.5-3 km off it (the view's heading and the ground travel
  within 5 degrees); from 200-600 km with turns of 6-90 degrees (its view
  within 2 degrees of its 3D velocity below the bend); and, over random
  flights, never against it where the view clearly looks ahead after the
  start's blend (a property: it cannot see a turn that spills below the
  bend, the example tests do). Limits, documented: a press 3-10 km up
  within one landing of its target backs off about 4.7 km looking straight
  down (view and travel 53-67 degrees apart for about half the flight);
  a start just over one landing out, its target behind its screen's up,
  rolls its heading 180 degrees over the first fifth.
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
  - It checks the ends, the floor, the arc bound below the bend, no climb
    from a low start, and that the camera moves backwards only to make
    room for the dive.
  - It checks criteria (a) and (b) at 60 Hz.
- `src/test-utils/flight-speed.ts`: the shared criterion.
  - It uses the chord form for small angles. `angleTo` goes through acos,
    which reads anything under 9.5 cm on the Earth as 0.
- Hand mutants, each killed by its own test:
  - the clock as a single smoothstep;
  - no course heading;
  - a view that does not look ahead.
  - (CF1's "no climb" mutant no longer applies: the travel curve does
    not climb.)

## The meteor (F1, F1b)

`planFlight`'s `meteorDeg` (default 90, R1) and `meteorLandDeg` (absent:
the law's default, beta for a line and 45 for R1; DEC-R3-12) are passed to
the travel curve and kept on the path (`path.meteorDeg`,
`path.meteorLandDeg`); the end view is the law at the landing (the landing
angle). `retargetFlight` keeps both unless its caller passes others, so a
landing raise never changes the law mid-flight.
