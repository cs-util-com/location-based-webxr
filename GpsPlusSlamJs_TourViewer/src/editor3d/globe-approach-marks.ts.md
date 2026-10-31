# globe-approach-marks.ts

## Purpose

What the arrival draws in the tour's frame: a ring spreading on the ground
under each station as it pops in, and the recorded walk drawing itself
from its first capture to its last. No walk, no line: never straight lines
between stations.

## Public API

- `walkPrefix(points, share)` - the polyline cut at `share` of its length
  (empty for fewer than two points, a walk of no length or a NaN share).
- `createArrivalMarks(parent)` returns:
  - `ring(id, at, ring)` - places, or with nulls removes, a station's
    ring, an accent ring laid flat;
  - `setWalk(points)` - the walk's points in the tour's frame, or null;
  - `drawWalk(share)` - draws that share (a `Line2`, 3 px, the accent at
    90 % opacity; rebuilt only when the share changes);
  - `showWalk(on)` - the layer switch;
  - `resize(width, height)` - the line's resolution in CSS px;
  - `stats()` - `{ rings, walkPoints, walkDrawn }`;
  - `dispose()`.

## Invariants and assumptions

- The drawn walk only grows with its share.
- The walk is lifted 5 cm so the ground it lies on does not hide it.

## Tests

- `globe-approach-marks.test.ts` - the prefix by length, the monotone
  growth, no line without a walk, rings added and removed.
