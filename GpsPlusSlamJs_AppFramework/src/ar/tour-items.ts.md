# tour-items.ts

## Purpose

Where a station's blocks stand in `tour.json` version 4: a LOCAL pose
relative to the station, which carries the geo pose. A station moves
rigidly with everything it holds: moving it changes its own geo pose,
never its blocks' local poses (`tour-station-pose.ts` converts both
ways). What a block is lives in `tour-blocks.ts`; this module keeps only
the pose and its sanity bound (the file name is the one version 3 gave
it, when a station held "items").

## Public API

- `TourLocalPose` (= `qr-pose.ts` `Pose`): `position` metres along the
  station's rotated North, Up, East axes; `rotation` a unit quaternion
  `[x, y, z, w]` relative to the station's.
- `TOUR_ITEM_MAX_OFFSET_M` (10 000) - the sanity bound per axis.
- `parseTourLocalPose(value, at, fail): TourLocalPose` - three finite
  offsets within the bound (-0 read as 0) and a unit rotation
  renormalized by the level files' one rule (`renormalizeUnitQuaternion`).
  Throws through `fail` naming `at.position` or `at.rotation`.

## Invariants & assumptions

- The caller's `fail` throws its own error (the manifest's), so this
  module needs no error class and no import of its parent.
- **A pose is structural: a bad one fails at EVERY minor.** Beyond 10 km
  a station's flat frame means nothing, so no later revision can make
  such an offset valid and a lenient reader still refuses it (unlike a
  model's size bound, `tour-blocks.ts`, which a later minor may widen).
- The bound is a sanity check, not a design limit: the editor keeps
  stations far smaller.
- Reading is exact: a pose reads back as the same numbers (no
  recomputation), which the manifest's round-trip property relies on.

## Examples

```ts
const pose = parseTourLocalPose(block.pose, 'stations[0].blocks[1].pose', fail);
// { position: [1, 0.5, -2], rotation: [0, 0, 0, 1] }
```

## Tests

- `tour-items.test.ts` - the local pose: exact, -0 read as 0, a near-unit
  rotation renormalized; each refusal (no object, two offsets, a
  non-finite offset, beyond the bound, a rotation far from unit length or
  of three numbers).
- Through the block, station and manifest tests (`tour-blocks.test.ts`,
  `tour-stations.test.ts`, `tour-manifest.property.test.ts`).
