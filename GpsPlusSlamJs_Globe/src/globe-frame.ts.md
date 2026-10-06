# globe-frame.ts

- Purpose: the globe's world frame (F2 plan 2026-10-03-1922 F2a, M3). The
  framework's sky, haze and cloud slab read the zenith from world y and
  the altitude from the camera's world y, so below the band the globe must
  be drawn in a local frame at the target: x east, y up, the origin on the
  ground there. The page puts the frame's matrix on the group that holds
  both carriers and the sun, and converts every camera pose through the two
  functions here, never by assuming world = ECEF.
- Public API:
  - `worldFromEcefAt(ellipsoid, { lat, lng }, out)`: the ECEF-to-world
    matrix at the target, written into `out`. It puts the target's ground
    point at the origin, east on +x, up on +y and north on -z. The axes
    are written out (east along the parallel, up the geodetic normal,
    north = up x east), because the library's ENU axes are NaN at a pole.
    RangeError for a latitude outside [-90, 90] or a non-finite longitude.
  - `applyEcefPose(camera, { position, quaternion }, worldFromEcef)`:
    places the camera at an ECEF pose through the frame and updates its
    world matrix. It is the one way the page writes a camera pose.
  - `ecefPoseOf(camera, worldFromEcef)`: the camera's ECEF pose (fresh
    vectors), the one way it is read.
  - `GLOBE_FRAME` and `frameRecentreTarget(ellipsoid, frame, nadir,
altitudeM)` (volume-cloud plan 2026-10-05-0016 §14): where the frame
    should move, the camera's ground point `nadir` once it is further than
    `recentreDriftM` (20 km: 31 m off the curved ground and 0.18 degrees
    off its vertical) from the frame's origin and the camera is below
    `recentreBelowM` (150 km), else null (and null without a frame). The
    distance is the chord between the two ground points, within metres of
    the arc at this range. RangeError for a non-finite position or
    altitude.
- Invariants & assumptions:
  - The frame is a rigid transform (rotation and translation, no scale).
  - The identity frame is ECEF: before any target the page's world equals
    ECEF, as before F2a.
  - The library's own controls (`GlobeControls.setEllipsoid(ellipsoid,
group)`) and the tiles read the group's world matrix, so they follow
    the frame without a conversion.
- Example:

  ```ts
  worldFromEcefAt(ellipsoid, { lat: 46.5, lng: 9 }, frame);
  globe.group.matrix.copy(frame);
  globe.group.updateMatrixWorld(true);
  const before = ecefPoseOf(camera, frame); // any time
  applyEcefPose(camera, before, frame); // the view unchanged
  ```

- Tests: `globe-frame.test.ts` covers the axes at a target, 1 km up
  landing at y = 1,000, the refusals, a fast-check round trip over any
  target and camera (the poles and the antimeridian included), and the
  identity; `frameRecentreTarget`'s far and near cases, its altitude cap
  and no-frame case, its refusals, and a property that it moves the frame
  exactly when the ground distance exceeds the drift. In the browser the globe lab's `globe-frame.smoke.spec.mjs`
  checks the view and the ECEF pose across a switch at the hold (0.00
  levels, 0 m) and that a dive lands in the target's frame.
