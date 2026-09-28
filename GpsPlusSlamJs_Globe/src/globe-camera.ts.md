# globe-camera.ts - the globe's camera

- Purpose: globe plan 2026-09-26-0539 §7.6, M2. The orbit pose that puts a
  target at the exact centre of the frame with north up, the distance that
  fits the whole Earth on screen, and the turn between two poses. Pure
  math on unit ECEF vectors (z north); no scene.
- Public API:
  - `OrbitPose` - `{ direction, up }`: unit ECEF vectors, `direction` from
    the Earth's centre towards the camera, `up` the screen's up,
    perpendicular to it. The distance is kept apart because it follows the
    viewport and the pose does not.
  - `orbitPose(ellipsoid, target)` - `direction` through the target's
    SURFACE point (geocentric): that ray meets the surface only there, so
    the target lands exactly at the centre. (The geodetic normal would miss
    by up to 0.19°.) `up` is the geodetic north at the target, written out
    as (-sinφ cosλ, -sinφ sinλ, cosφ). At a pole it therefore points along
    the target's own meridian; the library's `getEastNorthUpAxes` only
    survives a pole because `cos(π/2)` is not exactly 0 in floating point.
    The north is then made perpendicular to the view.
  - `applyOrbitPose(camera, pose, distance)` - places the camera and looks
    at the centre. East appears on the right, not mirrored.
  - `orbitDistanceToFit({ fovYRad, aspect, margin, radius })` - the distance
    from the centre at which a sphere of `radius` fills `1 - margin` of the
    narrower half-frame: tan α = (1 - margin) · tan(fovY/2) · min(1, aspect),
    and d = radius / sin α. Pass the ellipsoid's largest radius. Throws
    `RangeError` for a field of view outside (0, 180°), a non-positive or
    non-finite aspect or radius, or a margin outside [0, 1).
  - `turnPose(from, to, t)` - the pose a fraction `t` of the way (pass an
    eased `t`; outside [0, 1] it returns copies of the ends, exactly):
    - The direction follows the shorter great circle. Between EXACT
      antipodes (cross product below 1e-9) it turns towards `from.up`, so a
      north-up start goes via north, deterministically. A near-antipode
      follows the one great circle through both points, wherever its tiny
      offset puts it (the lab's antipode target turns that way, via the
      equator).
    - The up is carried along the arc (a rotation about the same axis), then
      rolled onto `to.up` in step with `t`. A north-up camera would spin
      half a turn at once when the arc crosses a pole; this one spreads that
      half turn over the whole turn (so the up turns about three times faster
      than the view moves on a 60° arc over a pole: continuous, and for the
      owner to judge on the phone).
  - `smoothstep(t)` - the Hermite ease, clamped (the package's one copy,
    DEC-H3's per-package rule).
  - `clipPlanes(ellipsoid, position)` and `GLOBE_CLIP` (round-2 plan
    2026-09-26-2055 M3b) - the near and far planes while the intro drives
    the camera, for a position in the ellipsoid's frame, whatever the
    camera looks at:
    - near: `nearFraction` (0.3) of the height above the ellipsoid (the
      shortest distance to it), at least `minNearM` (1 m). Every surface
      point is at least that height away and a point seen at θ off the axis
      has depth distance x cos θ, so no ground is clipped in a view whose
      half-diagonal is within acos(0.3) = 72.5° (fovY 80° at 2.5:1 is 66°);
    - far: the horizon distance of a sphere of the polar radius plus the
      difference of the radii (the ellipsoid's limb needs that margin: the
      property test fails without it), at least twice the near plane.
      Nothing beyond it is visible, and past it the tiles renderer culls
      the far side of the Earth, which it otherwise loaded (globe plan §15);
    - RangeError for a position at the centre or not finite.
      The controls (`GlobeControls`) set their own planes while they own the
      camera.
- Deviation from the plan: §7.6 named `turnDirection(from, to, t)`; the turn
  also needs the up (the pole case above), so it is `turnPose` over poses.
- Tests: `globe-camera.property.test.ts` (the clip planes against the
  geometry, cameras from 1 km to ten radii: every surface point beyond
  `near / nearFraction`, every visible point and the limb in every
  direction within `far`; the limb check fails with the margin removed or
  the equatorial radius used), and `globe-camera.test.ts`, with fast-check through three's own camera
  and projection:
  - any target (poles, ±180°, south) projects to NDC (0, 0) within 1e-9,
    for fovY 20-70° and aspect 0.4-2.5;
  - 0.1° north projects with y > 0 (the south pole included), and away
    from the poles exactly onto the vertical (|x| < 1e-7 |y|: any roll shows)
    with 0.1° east at x > 0;
  - poses are orthonormal everywhere;
  - the fitted silhouette stays within `1 - margin` and touches it;
  - the turn: exact ends; continuous up to and including both ends (per
    unit of t, the direction moves at most π and the up at most 2π, which is
    what catches a wrong roll sign); orthonormal, closing in monotonically,
    half the angle at half way, exact antipodes via `from.up`, and the
    half-turn roll over a pole spread at every step count;
  - `smoothstep`: ends, clamping, monotonic, symmetric.
  - `clipPlanes`: the near plane's scale and floor, the fitted view's far
    plane short of the centre, the 150 km horizon, the refusals.
  - Mutants checked 2026-09-26, each failing one test: the geodetic normal
    for the direction, the roll removed, the roll's sign flipped, a 10°
    roll on the north, the antipode turn via south.
