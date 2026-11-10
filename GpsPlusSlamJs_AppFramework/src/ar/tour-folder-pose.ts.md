# tour-folder-pose.ts

## Purpose

A plain folder's frame in `tour.json` version 5: turns a pose given in a
plain folder (its children's local poses) into the folder holder's frame
and back, through nested folders, in double precision. Also the
double-precision quaternion arithmetic the station frame
(`tour-station-pose.ts`) uses.

## Public API

- `composeTourFolderPose(folder, pose): TourLocalPose` - a pose in the
  folder's frame, in its holder's: `p = p_f + R_f p_c`, `q = R_f q_c`.
  `folder` is a `TourFolderFrame` (`{ pose? }`); no pose returns `pose`
  itself (the same object).
- `decomposeTourFolderPose(folder, pose): TourLocalPose` - the inverse.
- `composeTourFolderPath(folders, pose): TourLocalPose` - through a chain
  of folders, outermost first, composed innermost first; an empty chain
  returns `pose` itself.
- `decomposeTourFolderPath(folders, pose): TourLocalPose` - the inverse:
  a pose in the frame holding the outermost folder, given in the
  innermost's frame, decomposed outermost first. What an editor writes an
  item back into its folder with.
- `quaternionProduct(a, b)`, `quaternionInverse(q)` (of a unit
  quaternion), `unitQuaternion(q)` (renormalized, the identity for a
  degenerate one), `IDENTITY_QUATERNION`. Not on the package's root
  surface: shared with `tour-station-pose.ts` only.

## Invariants & assumptions

- **A folder is a rigid frame.** Its `scale` is not applied: the reader
  takes only `scale: 1` (`tour-story.ts`) until a renderer scales a whole
  group. Scaling positions alone would move a group's blocks apart while
  their sizes (a model's `sizeM`, a sound's radius, a picture's width)
  stay, so the later work applies the scale once, to the group, not on
  top of scaled positions.
- **Double precision throughout**: `qr-pose.ts`'s `composePose` uses
  gl-matrix's float32 arrays, centimetres at an absolute altitude of
  500 m.
- `-0` is canonicalized to `0` on every computed position, so JSON round
  trips are exact.
- Its own module, apart from `tour-station-pose.ts`, so the children
  reader can bound a composed offset (`TOUR_ITEM_MAX_OFFSET_M`) without an
  import cycle (`check:cycles`).

## Examples

```ts
const inHolder = composeTourFolderPose({ pose: folderPose }, block.pose);
const back = decomposeTourFolderPose({ pose: folderPose }, inHolder);
const inStation = composeTourFolderPath([outer, inner], block.pose);
```

## Tests

- `tour-station-pose.folders.property.test.ts` - compose then decompose
  returns the pose within declared tolerances, swept over offset reaches;
  a quarter-turn example; no pose is the identity by reference; two nested
  folders with non-commuting rotations against a hand-computed result; a
  path of up to three folders through `composeTourFolderPath` and back
  through `decomposeTourFolderPath`, swept over the same reaches.
- `tour-folders.test.ts` - the reader's bound on a composed offset, which
  goes through `composeTourFolderPath`.
