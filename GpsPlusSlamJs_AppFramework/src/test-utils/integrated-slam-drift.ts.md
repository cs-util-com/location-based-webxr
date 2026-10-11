# Integrated SLAM drift and correlated GPS noise (test-only helper)

## Purpose

The synthetic odometry and GPS models behind the "code left behind" sweeps: SLAM drift INTEGRATED along a walk (a yaw error that grows with the distance walked, plus a translation bias proportional to it) and GPS errors as a Gauss-Markov wander plus white noise. Extracted from the Recorder's `ar/qr/qr-anchor-mint.start-at-code.test.ts` (the `left` sweep that decided D28 revised) so the Tour Viewer's authoring-settle sweep (`GpsPlusSlamJs_TourViewer/src/visit-settle.left-behind.test.ts`) measures the SAME drift instead of a copy of it.

## Public API

- **`mulberry32(seed) → () => number`**, **`gaussian(rng) → number`**: the seeded PRNG and a Box-Muller normal draw every walk here is built from.
- **`rotY(a, v) → Nue`**: rotation about Up (NUE y) by `a` radians.
- **`Waypoint { tS, at: NE, walkedM }`** and **`positionOnRoute(waypoints, tS) → { at, walkedM }`**: a timed route and where the walker is on it (linear between waypoints, clamped at both ends). Throws on an empty route.
- **`IntegratedDrift { yawDegPer100m, transPct }`** and **`driftedYaw(yaw0, sign, yawDegPer100m, walkedM)`**: the odometry frame's yaw after `walkedM` metres.
- **`integrateOdometry({ waypoints, endS, start, frameYawAt, biasDirRad, transPct, stepS? }) → OdomTrack`**: integrates the walker's odometry every `stepS` (default `DEFAULT_TRACK_STEP_S` = 0.05 s): each step is the true step plus `transPct` % of its length along `biasDirRad`, turned by `-frameYawAt` at the step's midpoint. Throws on a non-positive step or a non-finite end.
- **`trackAt(track, tS) → Nue`**: the integrated position at `tS`, linear between samples.
- **`gaussMarkovGpsErrors(rng, count, accuracyM, { wanderFrac = 0.25, whiteFrac = 0.15, tauS = 60 }) → NE[]`**: 1 Hz horizontal GPS errors.

## Invariants & assumptions

- Deterministic: every random draw comes from the `rng` the caller passes, in a fixed order. The extraction was checked bit for bit (`Object.is` on every sample) against the Recorder harness's inline code before it was replaced, so the D28 numbers in that file's header still describe it.
- Frames: `NE` is (North, East) metres in the world; `Nue` is (North, Up, East). `integrateOdometry` keeps Up at `start[1]`: the model drifts horizontally only.
- A pose recorded early stays where the frame was at that moment, so an alignment fitted to the END of the walk sees it displaced by all the drift after it. That is the property the left-behind sweeps measure.
- With `transPct = 0` and a constant `frameYawAt` the track is the true route turned once (the pivot model); the Recorder harness pins that.
- Test-only: lives in `src/test-utils/`, is a tsdown entry only so a sibling package's tests can deep-import it through the `./test-utils/*` export, and must never be imported by production code.

## Examples

```ts
const waypoints: Waypoint[] = [
  { tS: 0, at: [0, 0], walkedM: 0 },
  { tS: 100, at: [120, 0], walkedM: 120 },
];
const drift: IntegratedDrift = { yawDegPer100m: 1, transPct: 1 };
const track = integrateOdometry({
  waypoints,
  endS: 100,
  start: [0, 1.4, 0],
  frameYawAt: (tS) =>
    driftedYaw(
      0,
      1,
      drift.yawDegPer100m,
      positionOnRoute(waypoints, tS).walkedM
    ),
  biasDirRad: 0,
  transPct: drift.transPct,
});
const odomAtEnd = trackAt(track, 100);
const gps = gaussMarkovGpsErrors(mulberry32(7), 101, 5);
```

## Tests

`integrated-slam-drift.test.ts` (translation drift is the stated share of the distance, the yaw drift turns the track by the stated angle, the GPS model is deterministic per seed). Exercised end to end by `../ar/qr/qr-anchor-mint.start-at-code.test.ts` (its pins: integrated without drift is the pivot model; 2 % over 200 m out and back leaves 4 m) and by the Tour Viewer's `visit-settle.left-behind.test.ts`.
