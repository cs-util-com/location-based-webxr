# film-park.ts

## Purpose

The made-up model park the hero film shows ("Mill Park"): one data set for
the 3D scene and the flat drawing. World units are about 2.5 m; x east,
y up, z south (towards the viewer).

## Public API

- The path type `MeasuredPath` (`pts`, `cum`, `len`, `at(s)`,
  `nearest(x, z)`), built in the module by a Catmull-Rom spline and an arc
  length table (module-private helpers).
- The walk: `ROUTE`, `ROUTE_LEN`, `STATIONS` (five, with their arc length
  `s`), `STREAM`.
- The people: `SPOT`, `LOOK`, `EYES` (the phone's eye per view), `S_FIG`,
  `START`, `LEAD_IN`.
- The model: `PARK` (slab, buildings, pond, oak, lookout, poster, wheel,
  widths, pin heights, colours), `LIGHT` (sun direction), `REGIONS` (what
  each close view must show), `TREES` (37, a seeded scatter kept off
  paths, buildings, water and every sight line the story needs).
- Angles: `AZ` (overview azimuth, 72 deg), `AZ2` (close views, 4 deg).

## Invariants

- Deterministic: the same numbers every load (the tree scatter has a fixed
  seed); `film-story.test.ts` pins them against the prototype's.
- Constant data only; nothing here touches the DOM.

## Tests

`film-story.test.ts` (route length, station positions, tree count and
first and last tree).
