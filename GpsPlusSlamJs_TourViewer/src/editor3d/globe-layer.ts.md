# globe-layer.ts

## Purpose

The editor's objects on the full globe: one group under the globe's
Earth-centred group (`globe.group`, whose matrix is the world frame), and
in it the tour's frame (x east, y up, z south at the tour's centre, its
origin on the ellipsoid) placed in ECEF, in which the stations layer works
as it does on the flat ground. The globe moves its frame under a camera
flown far from it (`recentreFrame`, every 20 km of drift below 150 km);
with the tour's frame in ECEF below the frame, a recentre moves nothing in
the layer and every station stays at its geo pose. This is the placement
GV0 measured and chose (results doc §5: within 0.0007 mm at every drift up
to 6,000 km, where a root baked once moves by the whole drift), the same
the globe's city uses.

The plan's step 4 named a per-object `place()` (one north-up-east matrix
per object). The editor never used it: the stations layer draws in one
tour frame, so the layer offers exactly that path (`mountTour`) and the
tests pin it.

## Public API

- `GLOBE_LAYER_NAME` - `"editor-globe-layer"`, the group's name.
- `createGlobeLayer(earth)` -> `GlobeLayer`: a group added to `earth`.
  - `root` - the group (ECEF).
  - `mountTour(ellipsoid, { lat, lng })` -> `{ frame, tourFromEcef }`:
    `tourFromEcef` is `worldFromEcefAt` at the centre (ECEF to the tour's
    frame, the stations layer's `worldFromEcef`); `frame` is a group named
    `"tour-frame"` with its inverse as matrix, `matrixAutoUpdate` off,
    added to `root` with its world matrix (and its parents') brought up to
    date. RangeError for a centre outside [-90, 90] or not finite; the
    layer is then unchanged.
  - `dispose()` - takes `root` out of `earth`; the objects' geometry and
    materials are the caller's to free.
- Type `GlobeLayer`; the result type `GlobeTourFrame` is module-local.

## Invariants & assumptions

- **A recentre touches nothing here:** only `earth.matrix` changes; the
  tour frame's matrix stays the same, its points follow the frame.
- **Doubles until the camera:** the frame's matrix holds an ECEF
  translation of about 6,400 km. three composes the model-view matrix in
  doubles and uploads that camera-relative product, so nothing large
  reaches the GPU as float32. A buffer of ECEF positions would (tens of
  centimetres of float32 step); the property test shows that path failing.
- The tour's frame is flat: a station a few kilometres out sits on the
  frame's tangent plane, which is what the stations layer has always
  assumed (`editor3d-tour-root.ts`).

## Examples

```ts
const layer = createGlobeLayer(view.globe.group);
const { frame, tourFromEcef } = layer.mountTour(ellipsoid, { lat, lng });
// the stations layer draws in `frame`; a recentre later: nothing to do
layer.dispose();
```

## Tests

`globe-layer.test.ts`: the group under the globe's and out again; a point
of the tour's frame lands on the globe's frame times its ECEF point
(written out by hand from the textbook WGS84,
`../test-support/tour-frame-points.ts`) within 1e-6 m, and `tourFromEcef`
takes it back; across a recentre the frame's own matrix is unchanged and
its points still land within 1e-6 m; a bad centre is refused with nothing
added. `globe-layer.property.test.ts`: any centre (latitudes -80 to 80),
any point within 5 km and -100..9,000 m, and two frames, within 1 mm; the
worst of a fixed sample of 300 holds every tolerance of a sweep from 1 mm
to 1e-6 m (in doubles about 1e-9 m); the same path through a float32 copy
of the frame's matrix fails the loosest of them.
