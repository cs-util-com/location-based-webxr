# code-displacement.ts

## Purpose

How far a printed code has moved from its saved pose, as the visitor's own
device GPS sees it, and the decision rule `moved | consistent | undecided`
on that estimate (Tour Viewer authoring plan 2026-09-28-0953 §3.6, owner
decision D20, measured in milestone M5a). Pure; NOT wired into the viewer
yet - the post-scan veto that uses it is M5c.

## Public API

- `displacementSamples({ gpsPositions, odometryPositions, zero })` - the
  store's GPS history as `DisplacementSample[]`: device fixes only (through
  `visit-log.ts` `deviceSamples`, the one device-only filter), in metres
  from `zero` (`[north, east]`), with their odometry partner (`[north,
east]`, odometry-NUE), their own time and reported accuracy. A fix without
  a finite time or an odometry partner is dropped; no zero: `[]`.
- `pinCode(codeOdomNue, storedNue): CodePin | null` - the code-pinned map of
  the odometry: `codeCorrection` of the code's odometry-NUE pose (the stable
  fused pose through `odomNueFromWebXr`) onto its saved GPS-world NUE pose
  (`objectPoseNue` of the level's geo), horizontal part only, plus the
  saved position. Null where `codeCorrection` is null.
- `type DisplacementEstimator` - `{ kind: "residual", radiusM }` or
  `{ kind: "rigid" }`.
- `EMPTY_DISPLACEMENT_STATS`, `addDisplacementSample(stats, pin,
estimator, sample)`, `displacementEstimate(stats, estimator)` - the
  incremental form: O(1) per fix (what a per-fix check needs).
- `estimateCodeDisplacement(samples, pin, estimator)` - the fold of a list.
- `DisplacementEstimate`: `displacementM` (`[north, east]`: where GPS puts
  the code minus where its saved pose says), `magnitudeM`, `spanS` (first to
  last fix used), `spreadM` (RMS distance of the used fixes' pinned
  positions from their centroid), `samples`, `yawDeg` (the rigid fit's turn,
  0 for `residual`).
- `judgeCodeDisplacement(estimate, { deviceM, storedM }, rule)` -
  `{ verdict, boundM }`, with `CodeMoveRule` = `{ floorM, accuracyFactor,
defaultAccuracyM, agreementM, minSpanS, minSpreadM }`.
- Errors: a residual radius that is not a positive finite number throws
  `RangeError` (a programming error); external data never throws.

## The two estimators

Both compare the device fixes `q` with the pinned odometry `p = pin(o)`,
both relative to the saved code.

- `residual` (radius R): the mean of `q - p` over the fixes whose `p` lies
  within R of the code. A saved heading error (or a turned poster) of theta
  leaks in as `(I - R(theta)) p`: at most `2 sin(theta/2) R` (property
  test), about 10 m at 50 m for a "Good" 12 degrees (§7j #1).
- `rigid`: the closed-form 2D least-squares fit `q = R(psi) p + t` over
  every device fix, evaluated at the code: `t`. A heading error or a turn
  alone reads as no move at the code (property test). Without spread
  (`spreadM` under 1 micrometre, a numerical guard) the yaw is 0 and the
  estimate is the residual mean.
- Neither can tell a constant GPS bias from a move: both add it exactly
  (property test). This is why the rule's bound has a floor.

## The decision rule

`boundM = max(floorM, correctionBoundM(deviceM, storedM, { accuracyFactor,
defaultAccuracyM }))` - the authoring correction's bound
(`visit-settle.ts`), never under the floor, because reported accuracy is
not bias (§7j #2). Then:

- `undecided` - no estimate, `spanS < minSpanS` or `spreadM < minSpreadM`,
  or a magnitude between `agreementM` and the bound;
- `moved` - magnitude above the bound;
- `consistent` - magnitude at or under `agreementM`.

`deviceM` must be the median accuracy of DEVICE fixes, never of stored
points (the votes carry 5 m; §7j #3).

## Invariants & assumptions

- Horizontal only (north, east): GPS altitude is not judged.
- Order-independent (property test); a non-finite sample is skipped.
- Evidence is counted in time span and spatial spread, never in fixes
  (§7j #7): GPS error is autocorrelated.
- Frames: GPS fixes and the saved pose relative to the same zero
  (GPS-world NUE); odometry in odometry-NUE (`odomNueFromWebXr`).

## M5a measurements (what the parameters rest on)

Harness: the M5a block of `viewer-vote-strength.test.ts` (opt-in
`VOTE_STRENGTH_SWEEP=m5a-detect`, `m5a-breakdown`, `m5a-bias`, `m5a-two`,
`m5a-recovery`; the default run keeps the frame sanity and the store pin).
Full numbers: the results doc
`GpsPlusSlamJs_Docs/docs/2026-09-28-1433-viewer-vote-strength-results.md`,
section "M5a".

- **Model.** GPS = truth + constant bias B (0, 8, 15 m, at 0/90/180
  degrees from the move) + Gauss-Markov error per axis (tau 30-300 s,
  sigma 3-10 m, seeded); odometry drift 1 % of the distance walked; a
  visitor who opens the tour at the code (10 s) or walks 58 m to it, then
  loops (radius 3, 10, 25 m) for 600 s; moves 5-50 m, turns 0/90/180
  degrees, saved heading errors 0-18 degrees; one and two codes.
- **Noise sets the floor, not the estimator.** On an UNMOVED code the
  worst |D| over 600 s is about B + 3 sigma for every estimator (rigid,
  60 s, 2 m: 8.9 / 15.7 / 22.4 m at B 0/8/15 for tau 30 s sigma 3 m; 36-48
  m at sigma 10 m). No floor up to 30 m is free of false alarms over the
  whole swept range; sigma 10 m alone defeats it.
- **`CODE_MOVE_RULE`** (rigid, 60 s, 2 m, floor 30 m, factor 3, default
  5 m, agreement 10 m): no false alarm while sigma <= 3 m and B < 22.5 m
  (tau 300 s) or < 25 m (tau 30 s), nor at sigma 5 m (tau 100 s) for
  B < 15 m. With the floor binding, factor and default accuracy matter
  only at a reported 5 m (factor 4 or default 8 m lift the bound to
  33-43 m).
- **Detection** (reported accuracy 3 m): 100 % of 50 m moves (median
  under 20 s after the scan), 75 % of 30 m, 34 % of 20 m, 12 % of 10 m,
  5 % of 5 m - mostly where the bias adds to the move. A move that is
  detected at all is detected within 240 s (the share by 240 s equals the
  share by 600 s in every cell; medians 20-60 s), so the veto lands during
  the hold and fade, not only on re-scans. The detection limit is the bound: a move
  smaller than about 30 m minus the bias along it is not seen.
- **Heading error and turn**: the rigid fit's detection is identical at
  every saved heading error (0-18 degrees) and turn (0-180); the residual
  estimator's is not (R = 20 m: 75 % of 30 m moves unturned, 46 % turned
  90 degrees).
- **`consistent`** (agreement 10 m) is read by 100 % of unmoved codes
  at B = 0 but also, first, by 54 % of 5 m and 16 % of 20 m moves: it is
  no reason to stop checking.
- **Two codes**: each code is judged on its own pin and the same device
  fixes, so the unmoved one of a pair never read `moved` at sigma 3 m.
  The GPS-free code-to-code check (one code through the other's pin)
  reads 2.0 m with nothing moved, 9.6 m with a 12 degree saved heading
  error (39 m apart) and about 55 m when one poster turned 90 degrees: it
  shows that one of the two is wrong, never which.
- **Recovery after a veto** (real store, the viewer's sink and
  keep-alive; distance at the physical code from a GPS-only shadow store;
  20 m move, 8 m bias along it, tau 30 s sigma 3 m, veto 30 s after the
  scan, 29.3 m apart at the veto), at +120 / +600 s:
  - nothing done (today): 27.4 / 19.4 m;
  - keep-alive stopped, votes age out: 8.3 / 5.2 m, never within 2 m;
  - also soft keys off (the hard trim back): 12.8 / 9.2 m, with a 7.2 m
    jump in one fix (bistable, as M0b found);
  - `resetGpsSessionData` and re-feed of the kept device fixes (256 per
    batch), soft keys kept: 0.4-1.3 m from the first fix on - but the
    content moves by the whole 29 m in that one step; with the soft keys
    off as well it IS the GPS answer (0 m).
  - A veto after the keep-alive has ended (240 s) makes stopping it a
    no-op: age-out equals doing nothing.

## Examples

```ts
const pin = pinCode(odomNueFromWebXr(stablePose), {
  position: stored.positionNue,
  rotation: stored.rotationNue,
});
const samples = displacementSamples({
  gpsPositions: selectGpsPositions(state),
  odometryPositions: selectOdometryPositions(state),
  zero: selectZeroReference(state),
});
const est = estimateCodeDisplacement(samples, pin!, { kind: "rigid" });
const { verdict } = judgeCodeDisplacement(
  est,
  {
    deviceM: medianDeviceAccuracy,
    storedM: level.qr.mintQuality?.gpsAccuracyM,
  },
  rule,
);
```

## Tests

- `code-displacement.test.ts` - the pin, each estimator on hand-built
  geometry (a translated code, a heading error near and far, a moved and
  turned code, a bias), the evidence (span from times, spread from the
  odometry, a standing visitor's rigid fit equal to the residual mean),
  skipped samples, the fold equal to the list, `displacementSamples`
  dropping the votes, and the rule's three verdicts and bound.
- `code-displacement.property.test.ts` - for any frame, saved pose,
  heading error, turn, move, walk and bias: the rigid fit reads exactly
  move plus bias; the residual estimator leaks at most `2 sin(theta/2) R`;
  the order of the fixes does not matter.
- `viewer-vote-strength.test.ts` (M5a block) - the default run pins the
  harness frames (exact data reads 0 or exactly the move) and that the
  real store's history, votes present, gives the same estimate as the
  device fixes alone (and that keeping the votes would hide the move).
