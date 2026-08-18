# `ar-elevation-auto.ts`

## Purpose

The automatic elevation offset: every ~1 s, estimate the floor from the depth
grid (framework `estimateFloor`), pair each floor hit with the DEM height at
the hit's **own** horizontal position, stream the baseline-free deltas into
the framework's `createElevationOffsetEstimator`, and publish
`baselineY + estimator.offsetM` for the manual nudge's `applyElevation`
channel.

## The arithmetic (owned by the sign test)

All heights ellipsoidal metres; scene `y = 0` is the WGS84 ellipsoid.

```
sample_i = hitYar_i − terrain(hitENU_i)      // baseline-free, slow, physical
autoM    = baselineY + robust(sample_i)      // baselineY = alignment[13]
applied  = autoM + manualTrimM               // composeElevationM, one place
```

- **Sign:** a measured floor ABOVE the DEM surface ⇒ positive ⇒ the city
  RISES to meet it. Derived from the demo's own frames in the dedicated sign
  test (`ar-elevation-auto.test.ts` — this feature's `fieldMatchesArDatum`);
  getting it backwards moves the city the wrong way by twice the error and
  reads as a fusion bug.
- **No extra geoid term:** in AR the terrain field is sampled with
  `absoluteDatum = −N` (`absoluteDatumFor`), so `heightAt` already returns
  ellipsoidal DEM+N — the same datum the baseline and the scene live in.
- **Baseline decomposition (plan §2.3):** the estimator's window stores only
  `hitYar − terrain`; the live baseline is re-added at read time. A baseline
  jump (one GPS fix re-owning the vertical solve) then moves camera and
  content **together instantly** instead of replaying through the smoother as
  a multi-second world slide. `sampleM` deliberately uses the RAW AR height
  (`hit.y`), never the scene-frame height, which would fold the baseline in.
- **Two smoothing stages, with disjoint jobs** (cold-review F4 revised the
  earlier one-stage rule): the estimator's slew limiter (0.5 m/s on the
  baseline-free component) shapes the signal between ticks, but the
  cold-start FIRST value and the re-added baseline reach this module's output
  as steps. `ar-mode.ts` therefore eases the APPLIED value toward the
  composed target at `AUTO_APPLY_RATE_M_PER_S` (1.5 m/s — 3× the estimator's
  rate, so the ease adds little lag on top of the corpus-tuned smoothing),
  and the manual trim stays instant (owner-driven, DEC-E1).
- **Slope-correct sampling (plan §2.4):** the DEM is sampled per hit at the
  hit's own ENU, not once at the camera — on a hillside "the floor height" is
  position-dependent and the freshest cells sit metres ahead of the phone.

## Public API

- `autoElevationEnabled(search)` / `AUTO_ELEVATION_PARAM` — the URL kill
  switch (`?autoElevation=off|0|false`); ON by default, unrecognised values do
  NOT disable (a typo must not silently kill the feature under test).
- `AUTO_TICK_INTERVAL_MS` (1000) — the tick cadence; `sample()` self-throttles
  so the cadence has one owner and is testable.
- `arPointToSceneNue(alignment, arPoint)` — raw WebXR (X=East, Y=Up, Z=South)
  → odometry NUE (`−z, y, x`) → through the column-major alignment matrix →
  scene NUE. `undefined` on any non-finite input (tracking glitch ⇒ no
  sample, never NaN).
- `composeElevationM(autoM, manualTrimM)` — the ONE composition of the
  applied offset; `null` auto contributes zero, so the manual nudge behaves
  exactly as before this feature existed (kill-switch/cold-start contract).
- `createArElevationAuto({ grid, terrainHeightM, anchorOffsetNue })` →
  `{ sample(input): ArElevationAutoState, reset(): void }`.
  - `reset()` (cold-review F2) — back to a true cold start: fresh estimator,
    no held value, throttle re-armed. Wired by `ar-mode.ts` into the SAME
    `onRestarted` callback that clears the grid and dispatches
    `odometryTrackingRestarted`: the estimator window's samples were measured
    in the odometry frame that just died, and without the reset its hold
    branch keeps publishing a dead-frame value for up to 45 s while the
    cleared grid refills.
  - `terrainHeightM` must be **AR-datum-gated** (the caller passes
    `terrainReadout(...)`'s height — undefined while the held field is the
    desktop one). An ungated relief-datum sample would be wrong by the whole
    ellipsoidal height.
  - `anchorOffsetNue` is `sceneAnchorOffsetNue`'s result — the DEM field is
    sampled about the scene anchor while the alignment is about `zero`, and
    subtracting this reconciles the two. `ar-mode.ts` passes the SAME value it
    attaches the city with, so they cannot disagree.
  - `ArElevationAutoState.autoM` is `null` only on a TRUE cold start (never
    had a value, or `reset()` after a tracking restart) or with the kill
    switch — those contribute 0.
  - **A pose/alignment GAP holds the last value instead** (cold-review F3
    revised the earlier flap-to-null rule): a tracking blip that composes as
    0 teleports the city by the full offset and back, while the physical
    floor-vs-DEM disagreement did not change because ARCore blinked. The held
    confidence decays at `POSE_GAP_CONFIDENCE_TAU_S` (10 s e-folding, the
    framework estimator's own "absence of evidence" hold rate), so a long
    outage still advertises itself; the estimator receives no tick during
    the gap, keeping its own window semantics for when data returns.

## Invariants & assumptions

- **Vertical frame-invariance:** `hitYar` is used as the baseline-free
  vertical, valid iff the alignment rotation is yaw-only and unscaled — true
  under `DefaultAlignmentConfig` and pinned by the framework's own M1 tests
  (invariance property + config-default assertion in the same file).
- The caller owns the identity-matrix gate: `alignment` must be `undefined`
  until a real alignment exists, because identity's element 13 is a plausible
  real 0 (the `worldBaselineY` trap).
- No tick reaches the estimator without pose+alignment, so its window keeps
  its own hold/decay semantics across gaps.
- The estimator's freeze layer (tower/stairs/bridge) passes through as
  `frozen` and is surfaced on the HUD line.
- Deep framework subpaths, never the `/ar` barrel — `ar-mode.test.ts` mocks
  the barrel wholesale and this module must keep the REAL estimators there.
- **Far-field limitation (known, accepted):** the published offset is a
  SINGLE SCALAR, measured at the user's feet, applied to the whole city. It
  corrects the height where the user stands; on a slope where the DEM's
  error varies with position, content hundreds of metres upslope or
  downslope can end up WORSE than uncorrected — the one measurement cannot
  serve two places whose DEM errors differ. Distance-tapered application
  (full correction near the user, fading with range) is future work; until
  then, judge the correction by the ground at the user's feet, not by a
  building on the horizon.

## Examples

```ts
const auto = createArElevationAuto({
  grid: pipeline.grid,
  terrainHeightM: (enu) => terrainReadout(terrain, enu, arN).terrainHeightM,
  anchorOffsetNue: geometricOffset,
});
// per frame (ar-mode.ts eases appliedAutoM toward state.autoM ?? 0 at
// AUTO_APPLY_RATE_M_PER_S before composing — see the two-stage note above):
const state = auto.sample({ nowMs, cameraPosAr, alignment });
applyElevation(composeElevationM(appliedAutoM, manualTrimM));
// on odometryTrackingRestarted (same callback as pipeline.clear()):
auto.reset();
```

## Tests

`ar-elevation-auto.test.ts` — the **sign test** (both directions, plus a
yawed-alignment variant that a translation-only fixture cannot see), per-hit
DEM sampling at the hit's own ENU, the AR-datum gate, null on cold start /
empty grid, the pose-gap hold with decaying confidence (F3), `reset()`
returning to a true cold start (F2), the tick throttle, the compose
contract, and the kill-switch parser.
`ar-elevation-auto.property.test.ts` — `arPointToSceneNue` against the
`THREE.Vector3.applyMatrix4` oracle over random yaws/translations/points,
plus the undefined-never-NaN contract (F9). The chain into the scene
(`attachContentTo`, including the application-time ease) and the HUD is
pinned in `ar-mode.test.ts`; real-depth behaviour is an M5 field item (see
`ar-depth-pipeline.ts.md`).
