# globe-layer.ts

## Purpose

The editor's objects on the full globe: one group under the globe's
Earth-centred group (`globe.group`, whose matrix is the world frame), each
object placed by its geo pose in ECEF. The globe moves its frame under a
camera flown far from it (`recentreFrame`, every 20 km of drift below
150 km); with the objects in ECEF below the frame, a recentre moves nothing
in the layer and every object stays at its geo pose. This is the placement
GV0 measured and chose (results doc §5: within 0.0007 mm at every drift up
to 6,000 km, where a root baked once moves by the whole drift), the same
the globe's city uses.

## Public API

- `GLOBE_LAYER_NAME` - `"editor-globe-layer"`, the group's name.
- `createGlobeLayer(earth)` -> `GlobeLayer`: a group added to `earth`.
  - `root` - the group (ECEF).
  - `place(object, { ellipsoid, place: { lat, lon }, undulationM })` -
    the object's matrix becomes its own north-up-east frame in ECEF
    (`pointRootMatrix` of `editor3d-tour-root.ts` with the identity frame:
    x north, y up, z east, the file's ellipsoidal height on the up axis,
    drawn N lower), `matrixAutoUpdate` off; added to `root` if it is not
    there yet. RangeError for a place outside [-90, 90] or not finite, or
    an undulation that is not finite; the object is then unchanged.
  - `dispose()` - takes `root` out of `earth`; the objects' geometry and
    materials are the caller's to free.
- Type `GlobeLayer`; its `place` argument `GlobeLayerPlace` is module-local.

## Invariants & assumptions

- **A recentre touches nothing here:** only `earth.matrix` changes; each
  object's matrix stays the same, its world point follows the frame.
- **Doubles until the camera:** an object's matrix holds ECEF translations
  of about 6,400 km. three composes the model-view matrix in doubles and
  uploads that camera-relative product, so nothing large reaches the GPU
  as float32. A buffer of ECEF positions would (about half a metre of
  float32 step); the property test shows that path failing.
- One matrix per object, never one for a tour (a flat tour frame bends a
  station a few hundred metres out; `editor3d-tour-root.ts`).

## Examples

```ts
const layer = createGlobeLayer(view.globe.group);
layer.place(stationMark, { ellipsoid, place: { lat, lon }, undulationM: n });
// a recentre later: nothing to do here
layer.dispose();
```

## Tests

`globe-layer.test.ts`: the group under the globe's and out again; an
object at its geo pose through the frame (against the textbook WGS84 of
`../test-support/wgs84-textbook.ts`); across a recentre the object's own
matrix unchanged, its ECEF point within 1e-6 m and its latitude,
longitude and height read back; re-placing without a second add; a bad
place refused with the object untouched. `globe-layer.property.test.ts`:
any place (latitudes -80 to 80), height, undulation and two frames round
trip within 1 mm; the worst of a fixed sample of 300 holds every
tolerance of a sweep from 1 mm to 1e-6 m (in doubles the error is about
1e-9 m); the same round trip through a float32 copy of the object's
matrix fails the loosest of them.
