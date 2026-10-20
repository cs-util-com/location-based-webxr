# tour-station-pose.ts

## Purpose

A station's frame in `tour.json` version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3): converts an item's LOCAL pose to its world geo pose and back, and gives
the WORLD VIEW of a tour (every pin, photo and model with its geo pose and
its station) - what a viewer places and a creator's drafts hold.

## Public API

- `geoPoseRotation(geo): Quaternion` - a geo pose's rotation against north:
  its quaternion, else the rotation of -heading about Up (the QR geo-pose
  convention), else the identity.
- `localPoseOf(geo, stationGeo): TourLocalPose` - where `geo` stands in the
  station's frame.
- `itemGeoPose(pose, stationGeo): QrGeoPose` - the geo pose of an item at
  `pose` in the station, minted by `mintQrGeoPose` (so a near-vertical
  rotation also carries the compat `headingDeg`, as every minted pose).
- `tourObjects(manifest): TourObject[]` - every item in the world, with
  `station` set, in station order.

## Invariants & assumptions

- **The frame:** origin at the station's latitude and longitude, axes
  North, Up, East (Up the absolute altitude, the stack's NUE convention),
  turned by the station's rotation. An item at `(p, q)` stands at
  `station + R_s p`, rotated `R_s q`.
- **Same geodesy as the rest of the stack**
  (`calcRelativeCoordsInMeters`, `mintQrGeoPose`). The core works in
  float32 for north and east here, so a conversion carries micrometres of
  noise; up is the altitude difference taken in double precision, so a
  height reads back exactly. The round-trip properties bound it at a
  millimetre (geo->local->geo and
  local->geo->local, stations at latitudes -60..60, items within 1 km).
- **Double precision quaternion arithmetic** of its own: `qr-pose.ts`
  `composePose` uses gl-matrix's float32 arrays.
- **Nothing here writes a local pose back.** A local pose changes only when
  an editor sets a new one; a station's move (D17) changes the station's
  geo pose, and every item follows by construction.
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
  distances between its items; the world view of items.
