# oblique-camera.ts - camera placement on the globe

- Purpose: the pure geometry that places a camera over the globe, shared by
  the flight paths (`flight-path.ts`, `flight-replan.ts`), the meteor
  (`pin-flight.ts`), the landing flight and the lab's test hooks.
- Public API:
  - `surfaceRadiusAlong(ellipsoid, direction)` - the distance from the
    centre to the surface along a direction (the geocentric ray's surface
    point, the one `orbitPose` centres). The direction may have any length
    but zero.
  - `orbitQuaternion(pose, target)` - the rotation of a camera on an orbit
    pose looking at the centre (what `applyOrbitPose` sets); writes into
    `target` and returns it.
  - `obliqueCamera(ellipsoid, pose, altitudeM, pitchDeg)` -> `{ position,
quaternion }`: the camera at the ground point's surface radius plus the
    altitude from the centre, moved back along the meridian (south) by the
    angle the triangle centre-camera-ground gives for the depression, and
    looking at the ground point with the pose's north as the screen's up.
    90 degrees is the orbit view straight down.
- Invariants & assumptions: the altitude is the height above the surface
  along the camera's own geocentric ray (not the geodetic normal; the
  difference is a fraction of a metre at these heights). No validation: the
  callers pass finite poses and altitudes; a zero direction yields NaN.
  The camera-back angle is clamped (`Math.min(1, ...)` inside the
  `asin`): when the ground point lies beyond the horizon at the asked
  depression (`(rs + altitudeM) / rs * cos(pitch) > 1`, a low pitch from
  high up), the camera is placed on the ground point's horizon plane, so it
  still looks at the ground point, at a shallower depression than asked,
  instead of yielding NaN. It stays a clamp, not a `RangeError`, because
  the flight paths and the replan pass pitches from their own laws at any
  height and no audit shows that none of them reaches this case.
  `orbitQuaternion` and `obliqueCamera` share one scratch matrix, so they
  are not re-entrant (they never call each other mid-use).
- Example:

  ```ts
  const pose = orbitPose(WGS84_ELLIPSOID, { lat: 46.5, lng: 9 });
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, 5_000, 45);
  camera.position.copy(cam.position);
  camera.quaternion.copy(cam.quaternion);
  ```

- Tests: `oblique-camera.test.ts` - `obliqueCamera` looks at the ground
  point at the asked depression from the asked altitude (several pitches
  and altitudes that see the ground point); `surfaceRadiusAlong` on the
  equator, at a pole and anywhere (the point lies on the ellipsoid within a
  millimetre). `orbitQuaternion` is covered through `globe-dive.test.ts`
  (an untilted start looks at the centre throughout).
