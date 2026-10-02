# globe-dive.ts - the pin's dive

- Purpose: round-2 plan 2026-09-26-2055 M3g (DEC-FB2-2/3; the owner: "turns
  the globe towards me and zooms in over about 15 s"). The curve of the dive
  from wherever the camera is to the hand-over altitude over the user's
  position. Pure: elapsed time in; a turn fraction and an altitude
  (`diveAt`), or the camera's position and rotation (`planDive`,
  `diveStep`), out.
- Public API:
  - `GLOBE_DIVE` - `durationMs` 15,000 (the owner's number), and
    `handOverAltitudeM` 150,000 (round-2 §6 Q1's default: the least soft of
    the {20, 50, 150} km sweep with the committed z4 imagery), `turnShare`
    0.4. The lab exposes the first two as `diveMs` and `handOverKm`.
  - `diveAt(elapsedMs, { durationMs, fromAltitudeM, toAltitudeM, turnShare? })`
    -> `{ turnT, altitudeM, done }`:
    - the altitude moves from `fromAltitudeM` to `toAltitudeM` evenly in its
      logarithm, eased by `smoothstep` over the whole dive: every halving of
      the height takes as long as the one before (in the middle), so the fall
      reads as steady, and half way in time is the geometric mean;
    - the turn runs over the first `turnShare` of the dive, eased, so it is
      done while the camera is still high and the last stretch only descends;
    - the ends are exact (`fromAltitudeM`, turn 0 at 0 ms; `toAltitudeM`,
      turn 1, `done` at `durationMs`) and held outside the dive;
    - a start below the hand-over altitude (the controls zoomed in) rises to
      it by the same curve;
    - RangeError for a duration or an altitude that is not a positive number,
      or a `turnShare` outside (0, 1].
  - `surfaceRadiusAlong(ellipsoid, direction)` - the distance from the
    centre to the surface along a direction (the geocentric ray's surface
    point, the one `orbitPose` centres).
  - `orbitQuaternion(pose, target)` - the rotation of a camera on an orbit
    pose looking at the centre (what `applyOrbitPose` sets).
  - `planDive(ellipsoid, start, target, { durationMs, toAltitudeM,
pitchLowDeg? })` ->
    `Dive`: `start` is `{ pose, distanceM, quaternion }` (the camera as it
    is), `target` an orbit pose. The start's altitude is its own height
    above the surface along its own direction, at least 1 m; its tilt is
    kept as its offset from its own orbit view.
  - `diveStep(dive, elapsedMs)` -> `{ position, quaternion, altitudeM,
done }`: since round-5 F1 the OBLIQUE approach (plan §3.5): the pose
    turned by `turnPose`, the camera `obliqueCamera` at the dive's
    altitude over the ground point under it, looking at that point with
    the pitch law's depression (`pitchAtDeg` in `globe-flight.ts`, the
    dive's `pitchLowDeg`, 45 by default; 90 is the old straight-down dive),
    eased in from 90 over the first fifth so a start below 5,000 km begins
    exactly where the camera is; times the start's offset slerped from
    itself to identity over the same fifth (`1 - smoothstep(t / 0.2)`).
  - Internal: `obliqueCamera(ellipsoid, pose, altitudeM, pitchDeg)` -> `{ position,
quaternion }`: the camera at the ground point's surface radius plus the
    altitude from the centre, moved back along the meridian (south) by the
    angle the triangle centre-camera-ground gives for the depression, and
    looking at the ground point with the pose's north as the screen's up.
- Invariants & assumptions: the altitude is the height above the surface
  along the camera's own geocentric ray (not the geodetic normal; the
  difference is a fraction of a metre at these heights).
- Milestone review of the pin (2026-09-28), two corrections:
  - m2: the start's height was first taken above the TARGET's surface
    radius; the radii of a pole and the equator differ by 21 km, so a
    camera 1 km over a pole diving to the equator was placed at 1 m and
    jumped at the start. Now the height is along the current direction
    throughout, so the camera is never lower than the lower of the two
    altitudes.
  - m3: the camera's whole start rotation was first blended in, which
    pulled even an untilted start back towards its old look direction
    mid-turn (up to 14° on a half turn). Now only the start's offset from
    its own orbit view fades, so an untilted start looks at the centre all
    the way.
- Known limit (for the owner's eye): the turn and the descent overlap, so a
  dive that starts LOW and far from the target (the controls zoomed in on
  another continent) sweeps across the globe while still low. A real
  fly-to would rise first; not built, because the dive normally starts from
  the fitted view.
- Tests: `globe-dive.test.ts` - exact ends and held outside, for any
  altitudes and durations; the altitude monotone and within its ends, the
  turn forward only; the geometric mean at half way; the turn done at its
  share and eased; no jump (under 0.5 % of the altitude per millisecond on
  a 10,000 km to 20 km dive); the refusals; `surfaceRadiusAlong` on the
  equator, at a pole and anywhere (the point lies on the ellipsoid within a
  millimetre); a camera 1 km over the north pole diving to the equator
  starts exactly where it is and stays at least 1 km above the surface
  (fails with the target's radius, a checked mutant); an untilted start
  looks at the centre throughout; a tilted start begins at its own
  rotation and looks at the centre from a fifth in (a residual tilt
  mutant fails both).
