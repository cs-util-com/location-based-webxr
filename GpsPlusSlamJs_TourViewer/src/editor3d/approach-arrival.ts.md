# approach-arrival.ts

## Purpose

The arrival after the approach, as pure timing: the stations pop in one
after another (a grow with a slight overshoot, and a ring spreading on the
ground under each), then the recorded walk draws itself, only when the
tour has one.

## Public API

- `ARRIVAL` - the timings (ms): `delayMs` 150, `staggerMs` 160, `popMs`
  900, `ringDelayMs` 450, `ringMs` 1200, `walkGapMs` 400, `walkMs` 1400.
- `ARRIVAL_REDUCED` - the same under reduced motion: no stagger, no
  rings, a 200 ms pop and a 300 ms walk.
- `ARRIVAL_RING` (module-internal) - the ring's radius from 0.15 to 1.2 of the station's
  found radius (at least 1 m).
- `stationPop(elapsedMs, index, timing)` - `{ scale, ring }`: the scale is
  0 before its turn and eases with an overshoot to 1; the ring
  `{ radius, opacity }` while it spreads, else null.
- `walkStartMs(stations, timing)`, `walkShare(elapsed, stations, t)` (0 to 1, eased) and `arrivalDone(elapsedMs, stations, timing)`.
- `walkDrawShare(elapsedMs, timing)` - the share of a walk drawn `elapsedMs` after it began drawing (0 to 1, eased over `walkMs`), for a walk that came after the stations popped in; the same curve as `walkShare` from its start.

## Invariants and assumptions

- A time that is NaN reads as the end (everything shown); shares are
  clamped to [0, 1].
- The walk starts only after the last station's pop.

## Tests

- `approach-arrival.test.ts` - the late walk's share (both timings), the order, the end, reduced motion, swept
  over 1, 3, 12 and 60 stations and the stagger at 0.5, 1 and 2 times.
