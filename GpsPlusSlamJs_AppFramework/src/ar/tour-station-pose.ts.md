# tour-station-pose.ts

## Purpose

A station's frame in `tour.json`: converts a block's LOCAL pose to its
world geo pose and back, and gives the WORLD VIEW of a tour (every FREE
block - a pin, a picture's plane, a placed model - with its geo pose and
its station) - what a viewer places and a creator's drafts hold.

## Public API

- `geoPoseRotation(geo): Quaternion` - a geo pose's rotation against north:
  its quaternion, else the rotation of -heading about Up (the QR geo-pose
  convention), else the identity.
- `localPoseOf(geo, stationGeo): TourLocalPose` - where `geo` stands in the
  station's frame.
- `itemGeoPose(pose, stationGeo): QrGeoPose` - the geo pose of a block at
  `pose` in the station, minted by `mintQrGeoPose` (so a near-vertical
  rotation also carries the compat `headingDeg`, as every minted pose).
- `tourFreeBlocks(station): TourBlock[]` - the station's free blocks: the
  block children of the station and of its plain folders at any depth, not
  those of its stories, in the file's order, each with its folders' poses
  composed in (`composeTourFolderPose`, from `tour-folder-pose.ts`). The
  ONE place plain folders are flattened.
- `tourFreeEntries(station): TourFreeEntry[]` - the same blocks, each as
  `{ block, folder }`: `folder` the ids of the plain folders holding it,
  outermost first (empty at the station's top).
- `tourObjects({ stations, assets }): TourObject[]` - every free block in
  the world, with `station` set and `folder` set for a block inside plain
  folders (absent at the top), in station order; a picture carries its
  image asset inline (`imageAsset`, looked up in `assets`).
- `tourObjectBlock(object, pose): TourBlock` - the free block an object
  is, at `pose` in its holder (its station, or the innermost folder
  holding it): the object without its geo pose, its station, its folders
  and a picture's inline asset (the tour lists the asset).

## Invariants & assumptions

- **The frame:** origin at the station's latitude and longitude, axes
  North, Up, East (Up the absolute altitude, the stack's NUE convention),
  turned by the station's rotation. A block at `(p, q)` stands at
  `station + R_s p`, rotated `R_s q`.
- **Same geodesy as the rest of the stack**
  (`calcRelativeCoordsInMeters`, `mintQrGeoPose`). The core works in
  float32 for north and east here, so a conversion carries micrometres of
  noise; up is the altitude difference taken in double precision, so a
  height reads back exactly. The round-trip properties bound it at a
  millimetre (geo->local->geo and
  local->geo->local, stations at latitudes -60..60, blocks within 1 km).
- **Double precision quaternion arithmetic**, shared with
  `tour-folder-pose.ts`: `qr-pose.ts` `composePose` uses gl-matrix's
  float32 arrays.
- **A plain folder is a frame.** Its children's poses are given in it;
  a folder with no pose returns the pose itself, bit for bit. Nested
  folders compose innermost first. A folder's scale multiplies its
  children's offsets, and `tourFreeEntries` gives each block the product
  of its folders' scales (`scale`, 1 at the top) for a renderer to draw
  it that much larger. The reader (`tour-story.ts`) bounds a composed offset by
  `TOUR_ITEM_MAX_OFFSET_M`, so a flattened block's pose is one a writer
  accepts.
- **Nothing here writes a local pose back.** A local pose changes only when
  an editor sets a new one; a station's move changes the station's geo
  pose, and every block follows by construction.
- The world view of a manifest and the session-zero placement differ by
  the curvature between the station's tangent plane and the session
  zero's. It grows linearly with the distance between them: measured
  0.7 mm at 100 m, 6.9 mm at 1 km, 3.4 cm at 5 km (the Tour Viewer's
  playback test, `content-placement.test.ts`, asserts 1 mm + 12 mm per
  km).

## Examples

```ts
const local = localPoseOf(pinGeo, station.geo); // at Finish
const geo = itemGeoPose(local, station.geo); // what the viewer places
const all = tourObjects(manifest); // [{ id, kind, geo, station, ... }]
```

## Tests

- `tour-station-pose.test.ts` - the station's own spot is the identity,
  heights relative to the station, a heading-90 station sees east as +x
  (by rotation and by heading), turns relative to the station's, a local
  pose placed in the world; properties: geo->local->geo and
  local->geo->local within a millimetre, a station's move keeps the
  distances between its blocks; the world view (free blocks only, in
  station order, a picture with its asset) and `tourObjectBlock` back.
- `tour-station-pose.folders.property.test.ts` - compose then decompose
  returns the pose within 1e-6 m and 1e-12 on 1 - |q.q'|, swept over
  offsets 0.01 m to 10 km; a quarter-turn example; no pose (and an empty
  folder path) is the identity by reference; nested folders flattened
  innermost first in document order; two nested folders whose turns do not
  commute against a position and rotation worked out by hand; a path of
  one to three folders composed then decomposed (`decomposeTourFolderPath`)
  within the same tolerances per level, swept over the same reaches; the
  world view naming each block's folders (`tourFreeEntries`,
  `tourObjects`) and `tourObjectBlock` writing a block without them.
