# globe-approach.ts

- Purpose: the globe's approach (globe plan §7.6, round-5 plan
  2026-10-01-0945 §3.1): the intro flight from the globe to the place
  (spin, fly-in, hold), the user's take-over, and the pin's dive or
  continuous flight down to it, as one state machine that returns the
  camera's pose for each frame. Moved out of the globe lab
  (`labs/globe/globe-lab.js`, its former `introFlight`) as a pure
  refactor (editor-on-the-full-globe plan
  `2026-10-27-1850-editor-on-the-full-globe-plan.md`, primary repo, the
  approach slice).
- Public API:
  - `SPIN_DEG_PER_S` (-3): the spin's rate while it waits for a target; the
    view's longitude falls, so the surface moves west to east.
  - `approachRestartKey(params)`: a string that changes with the link's
    target (`url`), `spinMs`, `turnMs`, `intro`, `maxKm` and `turnCap`, and
    with nothing else; the lab restarts the approach when it changes.
  - `poseToward([x, y, z])`: a north-up `OrbitPose` for a direction from
    the centre (looking along the pole: up is +x).
  - `createGlobeApproach(ellipsoid, { sunEcef, fitDistance, zoomOutM,
now? })` returns a `GlobeApproach`. `sunEcef`, `fitDistance` and
    `zoomOutM` are read every frame; `now` is the clock `state()` reads
    (default `performance.now`); every other method takes its time:
    - `restart(now, params)`: a new run from `spin` (`runs` + 1, a fresh
      history, no dive, no pin flight, no blend);
    - `setFix(place, now)`, `noFixComing()`: the permission rule's
      position, or that none will come;
    - `yieldToUser(now)`: phase `user` (once), cancelling a pin flight
      (`pinTouch`); `drives` is false from then until a restart;
    - `dive(now, target, fromPose, { durationMs, toAltitudeM, clock? })`:
      the fixed dive (`planDive`, at `params.pitchLow`) on `clock` (the
      arrival prefetch's; default as it is); drops any pin flight;
    - `flyPin(now, pin, place?)`, `aimPin(place)`, `updatePin(now, apply)`,
      `pinFlight`: the continuous flight (`/globe/pin-flight.ts`);
    - `holdDiveAt(ms | null)`, `diveAltitudeAt(ms)`: the smokes' hold and
      read (null without a dive; the pin flight's own clock when one runs);
    - `pose(now)`: an `ApproachOrbitStep` `{ pose, distanceM, fovDeg }`
      (`distanceM` null: the fitted distance) or, in the dive and the pin
      flight, an `ApproachPlacedStep` `{ position, quaternion, ... }`;
    - `cameraPlaced(distanceM)`: the frame loop's placement of the fly-in's
      first frame (kept once, for the smokes);
    - `state()`: `phase`, `target`, `source`, `history` (each phase or
      source change with `atMs` since the start), `runs`, `spinMs`,
      `turnMs`, `intro`, `fixState` (`fix`, `none`, `waiting`),
      `flyInStart` (null before a target and in the dive), `firstTurn`,
      `firstTurnDistanceM`, `flyInBlendMs` and `flyInSettled`.
- Invariants & assumptions:
  - `restart` comes before any other call (the lab calls it at start).
  - The phases of one run only move forward: `spin`, `turning`, `arrived`
    (then `user`, or `diving` and `landed`); `landed` is noted once.
  - The fly-in starts at `zoomOutM()` and ends at `fitDistance()`; its
    distance never grows; from `turnMs` on the pose IS the target's
    `orbitPose`, at the fitted distance and `fovY`.
  - A target that arrives after a shown spin frame blends from the spin
    over `GLOBE_INTRO.lateFixBlendMs`; a position replacing the fallback
    blends the target over the same time. No jump.
  - The dive never steps past its end: `diveStep` clamps, and the pose
    holds the landing.
  - No validation beyond the moved code's: the times are the frame
    loop's, the knobs the lab's clamped hash values; the intro and dive
    helpers throw `RangeError` on non-finite input as before.
- Example:
  ```ts
  const approach = createGlobeApproach(ellipsoid, {
    sunEcef: () => sun,
    fitDistance: () => view.fitDistance(),
    zoomOutM: () => zoomOutM(),
  });
  approach.restart(performance.now(), params);
  const step = approach.pose(performance.now()); // placed on the camera
  ```
- Tests: `globe-approach.test.ts` (a set clock and a fixed sun: the spin,
  the fallback, a position while spinning and over the fallback, the
  fly-in's first frame and its arrival, the user, the dive with its clock
  and hold, the pin flight and its cancel, the restart key, the pole case
  of `poseToward`); `globe-approach.property.test.ts` (forward-only
  phases, a non-growing fly-in between the fit and the zoom-out limit,
  the exact hold from `turnMs`, a dive that lands exactly once at its
  altitude). The lab's `globe-intro`, `globe-arrival`, `globe-first-look`
  and `globe-navigation` smokes read it through `__globeLab.state()`.
