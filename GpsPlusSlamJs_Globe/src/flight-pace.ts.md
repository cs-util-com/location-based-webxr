# flight-pace.ts - the fly-in's clock, paced by the OSM prefetch

- Purpose: round-5 plan 2026-10-01-0945 §3.6 (G6) and DEC-GL5-6. The
  owner: the flight "may take its time while data loads (e.g. 20 s when
  nothing is cached); when everything is already in local storage, the
  camera can fly in quickly", and the cap is 30 s. This module turns the
  prefetch's progress (0-1) into the flight's path fraction `s` (0-1). The
  flight's own pose function maps `s` to the camera and eases its ends.
- Public API:
  - `FLIGHT_PACE_DEFAULTS` - `{ minMs: 8_000, capMs: 30_000,
smoothingMs: 800 }`.
  - `startPace(params)` -> `FlightPaceState` `{ s: 0, rate: 1 / capMs,
elapsedMs: 0, progress: 0, done: false }`: the cold pace before the
    first signal.
  - `stepPace(state, progress, elapsedMs, params)` -> the next state. The
    frame since `state` is flown towards the target of the progress known
    then; this frame's `progress` is ratcheted in for the next frame.
  - `paceTargetRate(progress, params)` - the rate the clock steers to,
    per ms: `1 / capMs` at 0, `1 / minMs` at 1, linear between.
  - All three refuse an invalid parameter set with a RangeError: `minMs`
    not positive, `capMs` not finite or not above `minMs`, `smoothingMs`
    not positive.
- Invariants (each one a property test):
  - `s` is monotone, in [0, 1], and reaches 1 by `capMs` on any network
    (the cold pace alone gets there; the cap is also enforced so rounding
    cannot leave the camera short).
  - The rate stays in [cold, warm], so no flight ends before `minMs`.
  - One frame of `dt` moves the rate by at most
    (warm - cold) x (1 - e^(-dt / smoothingMs)): velocity-continuous, a
    tile landing never jerks the camera.
  - Frame-rate independent: the frame is integrated exactly for its held
    target, and a progress value acts from the frame after the one that
    reports it, so 16 ms and 48 ms frames agree on `s`.
  - Once the progress reaches 1 at a state with path fraction `s_d`, the
    flight ends within `(1 - s_d) x minMs + smoothingMs` (plus one frame).
  - Defensive: a NaN or negative progress is "no signal" (0); above 1 is 1;
    a progress that falls is ignored (ratchet); time that stands still or
    runs back moves nothing; a 10 s frame (a hidden tab) is integrated
    exactly, so it cannot overshoot.
- Why a state rather than `pace(progress, elapsed)`: the progress comes in
  steps (one 21 MB Overpass tile is one signal), and any pure function of
  (progress, elapsed) jumps its speed with them. The plan asked for
  velocity continuity, which needs the lag, which is state.
- Examples:

  ```js
  import {
    FLIGHT_PACE_DEFAULTS,
    startPace,
    stepPace,
  } from "/globe/flight-pace.js";

  let clock = startPace(FLIGHT_PACE_DEFAULTS);
  // each frame:
  clock = stepPace(
    clock,
    prefetch.progress(),
    now - flightStart,
    FLIGHT_PACE_DEFAULTS,
  );
  applyFlightPose(clock.s); // the flight's own eased path
  if (clock.done) handOver();
  ```

- The sweep (owner rule 2026-09-13): minMs {4, 6, 8, 12} s x capMs {20,
  30, 45} s x smoothingMs {250, 500, 800, 1,500, 3,000} ms x landing {0, 3,
  8, 15, 25 s, never} x {one step, two halves}: no flight ended before
  `minMs` or after the cap in 720 runs. At the defaults a warm flight takes
  8.6 s, data at 8 s ends at 14.5 s, at 15 s ends at 19.6 s, never ends at
  30 s. The table is in the round-5 globe-arrival-prefetch results.
- Tests: `flight-pace.test.ts` (worked timelines, validation) and
  `flight-pace.property.test.ts` (the invariants over random parameters,
  progress histories and frame steps).
