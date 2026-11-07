# roof-skeleton.js

## Purpose

A roof over any footprint, holes included: a weighted straight skeleton found by
simulating the wavefront. Every wall line moves inwards at its weight; the
surface it sweeps is its roof plane. Weight 1 is a slope, weight 0 a vertical
gable or party wall. Own code, no third-party skeleton (the known JS ports are
GPL or wrap CGAL).

## Public API

- `roofSkeleton(rings, { weights?, maxT? })` -> `{ faces, caps, ridgeT }`.
  `rings`: outer first, oriented by `orientRings`, points `{ x, y }` in metres.
  `weights`: one array per ring, default 1. `maxT`: stop there and close the rest
  with flat `caps` (`{ outer, holes }`). A face is
  `{ ring, at, vertical, nx, ny, dx, dy, points: [{ x, y, t }] }`; height is
  `eave + t * slope`. Throws `RoofFailure` when the simulation cannot finish.
- `orientRings(rings)`: outer counter-clockwise, holes clockwise.
- `ringArea(ring)`: signed shoelace area.
- `triangulateFace(face, triangulate)`, `triangulateCap(cap, triangulate)`:
  triples of points; `triangulate(contour, holes)` returns index triples (three's
  `ShapeUtils.triangulateShape` wrapped with `Vector2`s).
- `planArea(roof, triangulate)`: the plan area covered, equal to the footprint's
  when the roof is sound.
- `hasGable(roof)`, `triangularEnds(roof)`: the outer walls whose slope is a
  single triangle on the wall, the walls a gable can take.

## Invariants and assumptions

- A vertex is always the crossing of two offset lines, never an accumulated
  position, so no error builds up. Brute force, O(n^3) at worst: fine for a
  house, not for a city block of hundreds of corners.
- Exactly parallel neighbouring walls throw; callers jitter rings by millimetres
  first (`prepareRing`), seeded, so the result is stable.
- Edge events and split events, the latter also against a hole (a merge).
  Simultaneous events are processed one after another a hair apart, which can
  leave a zero-area sliver; `house-shell.js` stitches the T-junctions it causes.
- Pure, deterministic, no three.js.

## Example

```js
const rings = orientRings([outer, courtyard]);
const roof = roofSkeleton(rings, {
  weights: [
    [1, 0, 1, 0],
    [1, 1, 1, 1],
  ],
});
```

## Tests

`roof-skeleton.test.mjs`: rectangle ridge, L, T and U filled exactly with no
slope outside, a courtyard left open, `maxT` flat top, a weight-0 gable,
determinism. Run `node --test labs/city-look/v2-closed-roofscape/`.
