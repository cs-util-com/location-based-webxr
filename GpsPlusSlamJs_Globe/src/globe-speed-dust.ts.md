# globe-speed-dust.ts

Speed dust: streaks that pour past the camera, faster and longer the faster
it flies, so the user feels how fast the flight rushes at the Earth. Behind
the globe lab's `dust=1`.

Source: round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`
(D1, DEC-R3-2). The owner (2026-10-08) found the first dust (a world-fixed
field, `globe-space-dust.ts`, round 2's R5) buggy and ugly: it clumped over
the city when he zoomed back out (a box that grows with the altitude never
wrapped a single point) and carried no sense of speed (its screen motion
was speed over altitude, nearly constant on a logarithmic descent). He
asked for a screen-space effect tied to the speed in metres per second.

## Public API

- `GLOBE_SPEED_DUST`: `count` 1,500; `loMps` 1 km/s and `hiMps` 5,000 km/s
  (the speed range, measured on a flight: about 4,800 km/s at 44,000 km,
  1.5 km/s at the landing); `driftMin` 0.2 and `driftMax` 6 box units per
  second; `tauMs` 200; `fullM` 2,000 km and `goneM` 300 km; `fadeInShare`
  0.15; `nearFade` 0.05-0.15; `rimFrom` 0.85 and `rimTo` 0.95;
  `maxStepShare` 0.3.
- `startVelocity()`, `stepVelocity(state, position, tMs, altitudeM)`: the
  camera's velocity (m/s, ECEF) from its positions, smoothed with
  alpha = 1 - exp(-dt / tau), so a steady motion reads the same at any
  frame rate. A step of `jumpShare` (1) of the altitude or more in one
  frame is a gross teleport the lab did not announce (the lab resets the
  speed itself where it places the camera: a view, a link's start):
  the velocity resets to 0 rather than spiking. Bad samples are ignored.
- `speedShare(mps, range?)`: 0 up to `loMps`, 1 from `hiMps`, log-linear
  between (0 for a non-number); `range` `{ loMps, hiMps }` replaces the
  defaults (the lab's knobs, D1b), RangeError unless 0 < lo < hi.
- `driftRate(share, range?)`: the field's drift, from `driftMin` to
  `driftMax`, geometric in the share; `range` `{ driftMin, driftMax }`
  replaces the defaults (D1b), RangeError unless 0 < min < max.
- `speedDustOpacity(share, altitudeM)`: faded in over the lowest
  `fadeInShare` of the range (a stopped camera draws nothing) and by the
  altitude (full from `fullM`, gone by `goneM`, smoothstep in its log).
- `createSpeedField(count?, seed?)`: seeds spread through the box
  [-1, 1)^3, deterministic. RangeError for a bad count.
- `advanceField(offset, dir, rate, dtS)`: the field's offset after a step
  of drift along `dir` (the camera's motion, a unit ECEF vector), wrapped;
  one step never moves more than `maxStepShare` of the box.
- `streaks(seeds, offset, dir, rate, exposureS, opacity)`: heads (the seed
  minus the offset, wrapped), tails (the head plus the motion times the
  drift over the exposure: where the particle was) and an alpha per
  particle, faded at the box's rim and right at the camera.

## Invariants (each tested, `globe-speed-dust.test.ts`)

- **It can never clump**: a torus moved by translation alone; the heads are
  exactly the seeds minus the offset, wrapped, after any walk (stops,
  reversals, jumps), and each octant keeps its share.
- **A stopped camera draws nothing**; the opacity is full fast and high,
  gone below `goneM`.
- **Frame-rate independent**: the velocity and the drift over a second are
  the same at 5, 10, 30 and 60 Hz.
- **No spike on a teleport.**
- **Streaks point back along the motion**, longer when faster.

## How it is used

The lab draws the streaks as instanced quads in a pass of their own, with a
camera that has the view's ECEF orientation (so a frame move never spins
the field), behind the Earth, and at `dustOver` weight over it.
