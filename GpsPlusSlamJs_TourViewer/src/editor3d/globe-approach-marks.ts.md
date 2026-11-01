# globe-approach-marks.ts

## Purpose

What the arrival draws in the tour's frame: a ring spreading on the ground
under each station as it pops in, and the recorded walk drawing itself
from its first capture to its last. No walk, no line: never straight lines
between stations.

## Public API

- `walkCut(along, share)` - where the first `share` of a walk ends by
  its length (`along` the length up to each point): `{ segment, t }`, the
  first segment whose end reaches it and how far along it; null for fewer
  than two points, a walk of no length or a share not above 0. `drawWalk`
  cuts the line there.
- `createArrivalMarks(parent)` returns:
  - `ring(id, at, ring)` - places, or with nulls removes, a station's
    ring, an accent ring laid flat;
  - `setWalk(points)` - the walk's points in the tour's frame, or null;
    builds the walk's one `Line2` (3 px, the accent at 90 % opacity),
    hidden until drawn;
  - `drawWalk(share)` - draws that share of the same line: its segments
    up to the share (`instanceCount`) with the last one's end written
    where the share ends, the end of the segment cut before put back; no
    new geometry per frame, nothing done when the share is unchanged;
  - `showWalk(on)` - the layer switch;
  - `resize(width, height)` - the line's resolution in CSS px;
  - `stats()` - `{ rings, walkPoints, walkDrawn }`;
  - `dispose()`.

## Invariants and assumptions

- The drawn walk only grows with its share.
- The walk is lifted 5 cm so the ground it lies on does not hide it.

## Tests

- `globe-approach-marks.test.ts` - `walkCut` by length, its monotone
  growth, no line without a walk, the one geometry revealed by its share
  (the cut end, restored ends, share 0 hidden), rings added and removed.
