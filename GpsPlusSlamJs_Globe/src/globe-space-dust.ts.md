# globe-space-dust.ts

Space dust: faint points that give a sense of speed on the way in from far
out. An experiment behind the globe lab's `dust=1`, off by default.

Source: round-2 plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-2350-globe-flight-round-2-owner-feedback-plan.md`,
DEC-FR2-7 (milestone R5). The owner (2026-10-07): from 65,000 km towards
the Earth, light particles would give a feel for how fast the camera is
coming in, and might hold the eye while the map data loads; "let us try
whether it looks good".

## Public API

- `GLOBE_SPACE_DUST`: `count` 4,000, `boxShare` 1 (the box's half size as
  a share of the altitude), `fullM` 2,000 km, `goneM` 300 km.
- `createDustField(camera, altitudeM, count?, seed?)`: a `Float32Array` of
  xyz in metres, spread evenly through the box around `camera`;
  deterministic for a seed. RangeError for a count that is not a positive
  integer or an altitude that is not positive.
- `wrapDust(points, camera, altitudeM)`: keeps every point within the box
  (half size `boxShare` x the altitude): a point that left it through a face
  comes back through the opposite one; a point inside stays. In place. A
  non-finite camera or a non-positive altitude leaves the points alone.
- `dustShare(altitudeM)`: the dust's opacity, 1 from `fullM` up, 0 from
  `goneM` down, a smoothstep in the altitude's logarithm between (0 for a
  non-number).

## How it works

- The points are still in the world. Their motion on screen is the camera's
  own, so a faster camera passes them faster; the box in altitude units is
  the measure the flight is judged by, so their apparent speed is its
  perceived speed.
- As the camera descends, the box shrinks: the points kept are the ones
  nearer the view, so they stream outward from its centre (the classic
  warp look) without any motion of their own.
- They fade out by 300 km, where the sky begins to show, so they never
  hang in the atmosphere.

## Invariants

Each one is tested (`globe-space-dust.test.ts`): a repeatable field inside
its box; a box reaching at least three times as far as the camera's near
plane (`GLOBE_CLIP.nearFraction` of the altitude; a box of 0.3, the first
draft, would have been clipped away almost whole); nothing moves while the camera holds still; only points outside
the box wrap, to the opposite face; every point stays in the box as the
camera descends; bad input changes nothing; the opacity is full high up,
gone before the sky, and monotone between.

## How it is used

The globe lab draws them as additive points when `dust=1`, wrapping them
each frame around the camera at its altitude, their opacity `dustShare`.
