# flight-replan.ts

The flight's replans: when the target or the landing altitude changes in
mid-flight, the flight is replanned from the camera's current state. The
camera never jumps or kinks.

- Source: the continuous-flight plan
  `GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
  milestone CF2.
- It builds on `flight-path.ts`.

## Purpose

At the press, the flight's target and landing are often not final:

- The device's fix arrives after the press. DEC-CF-4b makes the flight
  wait above about 2,000 km until it does.
- The landing altitude rises once the target's height tile loads.
- A link can name a new place.

A replan that jumped, or bent with a kink, would be exactly the "odd
transition" the owner reported.

## Public API

### `FLIGHT_REPLAN`

Frozen settings:

- `blendMs` 1,500: how long the old flight cross-fades into the new one.
- `clearanceM` 300: the least height over the ground under the camera.
- `minDurationMs` 2,000 and `maxDurationMs` 60,000: the bounds on a
  replanned flight's length. The upper one is DEC-CF-5's safety cap.
- `clearanceRounds` 6 and `clearanceSamples` 240: the effort
  `clearedLandingM` spends.

### `Flight`

`{ ellipsoid, path, startedAtMs, endsAtMs, previous }`. `previous` is the
flight this one is still blending from, together with the time the blend
ends.

### `startFlight(ellipsoid, start, target, options, atMs)`

A flight whose path time 0 is at the clock time `atMs`. The other arguments
are as for `planFlight`. Throws a RangeError for a time that is not finite.

### `retargetFlight(flight, atMs, target, options)`

The flight replanned at `atMs`.

- It starts from the camera as it is: its direction, its heading (towards
  its view's centre), its distance, its pitch and its tilt.
- It starts at the camera's current speed, a central difference of the
  flight's own measure.
- Without `options.durationMs`, the new duration makes the cruise run at
  that same speed: D = (L + settle) / v. It is clamped to 2-60 s.
- From rest (after the landing), it takes the default duration and does not
  blend.
- Throws a RangeError for a time before the flight began.

### `flightFrameAt(flight, nowMs)`

The frame at a clock time, cross-faded across a replan.

- The centre, up and camera direction are blended by slerp.
- The altitude is blended in its logarithm.
- The pitch is blended linearly.
- The weight is a smoothstep over `blendMs`.
- The end is decided by the flight's own end time.

### `flightCameraAt(flight, nowMs)`

`obliqueCamera` applied to the blended frame, with the tilt offsets blended
the same way.

### `clearedLandingM(ellipsoid, start, target, options, groundAt)`

The least landing at which the camera's whole flight stays `clearanceM`
over `groundAt`.

- `groundAt` gives the ground's height under a direction, in metres, or
  null where it is not known yet. Unknown ground is ignored.
- Each round raises the landing by the worst shortfall and replans.

## Invariants

Each one is tested.

- A replan starts exactly at the camera's current frame.
- The camera's velocity is continuous across a replan, also within 5 % for
  random flights.
- **The "never stops" criterion holds across the replans the design
  makes.** It is checked at 10, 60 and 120 Hz with all three tolerances:
  - a new place while at or above 2,000 km, any distance away (the test
    asserts the altitude);
  - a new landing at any altitude, both raised and lowered.
- A replan lands exactly at the new target and altitude.
- A replan within a blend nests without a jump.
- A replan after the landing flies from the landed frame.
- The camera never goes below the lowest of its start and its two landings.
- `clearedLandingM` raises a landing over a ring of 3,000 m high ground,
  1-8 km around the target, until the whole approach clears it. It keeps a
  landing whose approach already clears the ground, and ignores unknown
  ground.

## The documented limit

A new PLACE low down can only come from a new link in mid-flight; the
design's own fix arrives above the band. Such a replan turns the course, or
the descent into a climb (the van Wijk arch).

- The 1.5 s cross-fade then dips and surges the speed. Measured on
  2026-10-07: between 0.62 and 0.84 of the speed before, and up to 2.74 x
  it.
- A test holds that it never stalls and lands exactly.
- A C1 turn in place of the cross-fade is a filed follow-up, should such
  replans become part of the design.

A raised landing close to the end brings the settle forward. For example,
3 km at 10 km up puts the camera inside its settle zone at once, so it
slows down for the landing (to 0.28 of its speed). That is the settle the
owner accepted, not a stall in mid-flight.

## Tests

- `flight-replan.test.ts`: the examples, the criterion across the designed
  replans, the limit, and the clearance.
- `flight-replan.property.test.ts`: random flights, replan times, new
  nearby places and new landings.
