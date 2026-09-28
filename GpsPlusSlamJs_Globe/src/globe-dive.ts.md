# globe-dive.ts - the pin's dive

- Purpose: round-2 plan 2026-09-26-2055 M3g (DEC-FB2-2/3; the owner: "turns
  the globe towards me and zooms in over about 15 s"). The curve of the dive
  from wherever the camera is to the hand-over altitude over the user's
  position. Pure: elapsed time in, a turn fraction and an altitude out; the
  lab turns them into a pose (`turnPose` from `globe-camera.ts`, the distance
  = the target's surface radius + the altitude).
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
- Invariants & assumptions: the altitude is along the geocentric ray through
  the target's surface point (the orbit pose's axis), not the geodetic
  normal; the difference is a fraction of a metre at these heights.
- Known limit (for the owner's eye): the turn and the descent overlap, so a
  dive that starts LOW and far from the target (the controls zoomed in on
  another continent) sweeps across the globe while still low. A real
  fly-to would rise first; not built, because the dive normally starts from
  the fitted view.
- Tests: `globe-dive.test.ts` - exact ends and held outside, for any
  altitudes and durations; the altitude monotone and within its ends, the
  turn forward only; the geometric mean at half way; the turn done at its
  share and eased; no jump (under 0.5 % of the altitude per millisecond on
  a 10,000 km to 20 km dive); the refusals.
