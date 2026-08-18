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
- **One smoothing stage total:** the estimator's slew limiter (0.5 m/s on the
  baseline-free component). The apply side is a plain set at the tick cadence
  — adding easing there would double-smooth and only add lag.
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
  `{ sample(input): ArElevationAutoState }`.
  - `terrainHeightM` must be **AR-datum-gated** (the caller passes
    `terrainReadout(...)`'s height — undefined while the held field is the
    desktop one). An ungated relief-datum sample would be wrong by the whole
    ellipsoidal height.
  - `anchorOffsetNue` is `sceneAnchorOffsetNue`'s result — the DEM field is
    sampled about the scene anchor while the alignment is about `zero`, and
    subtracting this reconciles the two. `ar-mode.ts` passes the SAME value it
    attaches the city with, so they cannot disagree.
  - `ArElevationAutoState.autoM` is `null` whenever nothing can honestly be
    published (cold estimator, no alignment, no pose, all-gated terrain).
    **Null means "contribute 0", never "hold the last value"** — the
    `ar-measurements.ts` honesty rule applied to a control signal.

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

## Examples

```ts
const auto = createArElevationAuto({
  grid: pipeline.grid,
  terrainHeightM: (enu) => terrainReadout(terrain, enu, arN).terrainHeightM,
  anchorOffsetNue: geometricOffset,
});
// per frame:
const state = auto.sample({ nowMs, cameraPosAr, alignment });
applyElevation(composeElevationM(state.autoM, manualTrimM));
```

## Tests

`ar-elevation-auto.test.ts` — the **sign test** (both directions), per-hit
DEM sampling at the hit's own ENU, the AR-datum gate, null on empty grid / no
alignment / no pose, the tick throttle, the frame conversion against a
three.js oracle, the compose contract, and the kill-switch parser. The chain
into the scene (`attachContentTo`) and the HUD is pinned in
`ar-mode.test.ts`; real-depth behaviour is an M5 field item (see
`ar-depth-pipeline.ts.md`).
