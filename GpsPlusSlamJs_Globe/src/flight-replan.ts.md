# flight-replan.ts

The flight's replans: when the target or the landing altitude changes
mid-flight, the flight is replanned from the camera's current state, with
no jump and no kink.

Source: continuous-flight plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-0941-globe-continuous-flight-plan.md`,
CF2, as revised after the CF2 milestone review and CF3. It builds on
`flight-path.ts`.

## Purpose

At the press, the flight's target and landing are often not final:

- the device's fix arrives after the press (DEC-CF-4b holds the flight
  above about 2,000 km until then);
- the landing rises once the target's height tile loads;
- a link can name a new place.

A replan that jumped or bent with a kink would be exactly the "odd
transition" the owner reported.

## Public API

- `FLIGHT_REPLAN`: `joinMs` 1,500, `clearanceM` 300, `minDurationMs`
  2,000, `maxDurationMs` 60,000 (one replanned path's length, as DEC-CF-5's
  cap),
  `clearanceRounds` 6, `clearanceSamples` 960 (at 240 a ridge 2 km wide
  was cleared by 275 m, not 300).
- `Flight` is `{ ellipsoid, path, startedAtMs, endsAtMs, join }`.
  - A replanned flight answers from its replan on and keeps no history: the
    old flight is never evaluated again.
  - `join` is the velocity correction of its replan, or null.
- `FlightJoin` (module-internal, the type of `Flight.join`) is `{ atMs,
spanMs, lnAltitudePerMs, axis, radiansPerMs }`.
- `startFlight(ellipsoid, start, target, options, atMs)` creates a flight
  whose path time 0 is at the clock time `atMs`. RangeError for a time that
  is not finite.
- `retargetFlight(flight, atMs, target, options)` returns the flight
  replanned at `atMs`.
  - It starts from the camera as it is: its direction, its heading (towards
    its view's centre), its distance, pitch and tilt.
  - It starts at the camera's speed, measured by a backward difference.
  - Its timing is described under "How it works".
  - From rest (after the landing) it takes the default duration and has no
    join.
  - RangeError for a time that is not finite, or one before the flight
    began.
- `flightFrameAt(flight, nowMs)` gives the frame with the join applied. The
  end is decided by the flight's own end time.
- `flightCameraAt(flight, nowMs)` gives `obliqueCamera` on that frame, with
  the path's start tilt.
- `clearedLandingM(ellipsoid, start, target, options, groundAt)` returns the
  least landing at which the camera's flight stays `clearanceM` over
  `groundAt`.
  - `groundAt` gives the ground's height under a direction, or null where
    it is unknown; unknown ground is ignored.
  - It only counts samples the landing can move (see "How it works").

## How it works

### The join (DEC-CF-1b's Hermite join, as built)

The new path's first velocity differs from the camera's. The join adds the
difference back and lets it die out over `spanMs`, which is `joinMs` or the
new flight's length if that is shorter:

- d(t) = dv x phi(t), with phi(x) = x (1 - x/T)^3.
- phi(0) = 0 and phi'(0) = 1, so the velocity is continuous at the replan.
- phi(T) = phi'(T) = phi''(T) = 0, so the position, the velocity and the
  acceleration are continuous at the join's end (CF2 review finding 8).

The join moves the CAMERA, not the view:

- The ground part of dv is a rotation about an axis through the Earth's
  centre.
- The radial part is a rate of change of the altitude's logarithm.
- The view is then built from the moved camera with `viewFromCamera`.
- Moving the view instead, and placing the camera behind it at the corrected
  altitude, slid the camera sideways (found while building CF3).

Its size follows the velocity MISMATCH. That is small in the design's own
replans: a slow hold that becomes a fast flight, or the same course with a
new landing. The first CF2 cross-faded the two flights, so its error grew
with how far they drifted apart, and it dipped the speed 14-26 % when a fix
arrived during the hold.

### The timing

Implemented in `replanTiming` (CF2 review finding 1):

- **The cruise** runs at the larger of the OLD flight's cruise and a fresh
  flight's cruise from here, (L + settle) / the default duration.
  - So a replan that changes nothing changes nothing.
  - And a replan out of the hold's slow cruise flies on at a normal pace.
    Copying the instant speed instead crawled at 0.16 e-folds per second,
    about a minute from 8,500 km.
- **The ramp** to that cruise:
  - while the old flight is still ramping to the same cruise, it continues
    exactly the old ramp's tail (`rampMs`, `rampFromShare`);
  - otherwise it lasts the speed gap's share of `FLIGHT_PATH.rampMs`, and
    is none when the speeds already match.
- **The same destination** (the old target within one landing; a new
  landing at most) keeps the old settle's length (`settleLength`), so the
  settle starts where the old one would have (CF3 review finding 3: a
  shorter settle recomputed from the shorter path moved the flight by up
  to 12 % between 8.8 and 11.6 s).
- **In the old flight's settle towards the same destination**, or when the
  path is too short for a cruise, the new path brakes on from the camera's
  speed (`brake`, a cubic Hermite) over 2L / s0. A NEW place reached from
  an old settle (a fix late in the hold) flies a normal cruise instead (CF3
  review finding 2: braking crawled for up to 60 s).
  - A cruise there re-accelerated and settled a second time.
  - Its join could outlive the flight and dip up to 1.6 % below the landing.
- **Velocities** come from backward or forward differences with a step that
  is small against the time each flight has left. A 1 ms difference misread
  the hard braking of a replan in a flight's last milliseconds by about 5 %.

### The clearance

`clearedLandingM` raises the landing by the worst shortfall under the camera,
divided by how much the camera there rises with the landing.

- That rise is measured with a second plan 1 m higher.
- Samples that the landing moves by less than half a metre per metre are
  not counted: they are out of its reach. CF2 set 0.05 (CF2 review finding
  4: a start already too low over a plateau was added again every round);
  on the round-2 travel curve a landing scales the whole descent a little,
  and at 0.05 ground under the early path read as a shortfall over a small
  sensitivity (a 9,800 m ridge under a 10 km start raised a 2 km landing to
  6,020 m, a level pan over a 1.8 km plateau to 3,752 m). A window on the
  final approach instead (the dive's own track) missed ridges just before
  the dive and left the camera 4-19 m inside them (the R1 milestone review).
- Measured: a ridge 100 m under the planned path, anywhere from 5 to 40 km
  out of the landing point, from a 5 or 10 km start, is cleared by at least
  280 m; the 10 km start over a ridge under itself gets 2,100 m; a level
  pan over the plateau gets the 2,205 m that lifts its second half (the
  part the landing governs) clear.
- Known gaps, to settle before it is wired (the R1 re-review): ridges that
  straddle the 0.5 cut are partly cleared (200 m from a 10 km start 70 km
  out; 246-279 m elsewhere), and ground under the first stretch of a low
  start gets no raise (43-96 m of clearance); a call takes 6-16 ms warm on
  a desktop, so it must not run inside a frame on a phone (DEC-PERF).

## Invariants

Each one is tested.

- A replan starts exactly at the camera's frame.
- The camera's velocity is continuous at the replan and where its join
  ends.
  - The property test covers random flights at any moment, from the press
    to after the landing.
  - It uses one-sided differences over a step small against the join and
    the time left, and allows the positions' float64 resolution over that
    step (near the landing the camera is all but at rest, and 1e-9 m over
    1e-4 ms read as a 33 % jump of nothing).
- The view keeps turning across a replan (its turn rate within 20 %): the
  pitch blends the start's offset from the law, not the law itself (CF3
  review finding 5: every replan froze the turn).
- The join ends without a jump in the acceleration, and never outlives its
  flight (both killed their mutants).
- **A replan to the same target and landing leaves the flight unchanged**
  at every moment, sampled every 350 ms and in the last moments: within 5 %
  of the altitude, and ending within 3 %.
- **The "never stops" criterion holds across the replans the design
  makes** (10, 60 and 120 Hz, all three tolerances):
  - a nearby new place (95 and 690 km) while above the band;
  - a new landing, raised or lowered, at any altitude.
  - The fix during the hold, at any distance, is in `pin-flight.test.ts`.
- A replan lands exactly at its new target and altitude, and never goes
  below the lowest of its start and its landings (to rounding: the worst
  over 3,000 random replans was 1.9e-12).
- A replan made while the camera is slow cruises like a fresh flight, and
  a new place reached from an old settle (9, 12, 14 s into a hold) takes
  under 1.5 x a fresh flight's time.
- `clearedLandingM` raises a landing over a 3,000 m ring until the approach
  clears it, and leaves alone a plateau that only the start sits on.

## The documented limit

A new place low down, or far away (a course reversal), can only come from a
new link mid-flight. The design's own fix comes during the hold.

- A moderate turn dips but never stalls (below half its median). Measured
  on the round-2 travel curve (2026-10-08), the lowest speed over the median,
  from a New York to Bern flight: Zurich 1.00 from 618 km, 0.86 from 87 km,
  0.60 from 9.3 km; Rome 0.98 from 618 km, 0.56 from 87 km. (On CF1's van
  Wijk path: 0.79 for Zurich from 79 km, 0.81 for Rome from 609 km.)
- A REVERSAL passes through a near-stop: Rome from 9.3 km drops to 0.10 of
  the median. It no longer climbs (the travel curve pans at its altitude;
  van Wijk dropped to 0.03 and climbed to 345 km). Any velocity correction
  must pass through zero to reverse.
- All of them land exactly.
- The filed follow-up is a turn at a constant speed, should such replans
  become part of the design.

## Tests

- `flight-replan.test.ts`
- `flight-replan.property.test.ts`
