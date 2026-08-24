# elevation-offset-scenarios.ts (test fixture)

## Purpose

Deterministic synthetic tick-stream generators for the elevation-offset estimator's named test scenarios. Scenarios are synthesised at the SAMPLE level — the estimator is pure over `(t, sample, confidence, position)` streams, so a tower dwell is a generated series, not a synthetic 3D scene. Test-only: not exported by any barrel and not a dist entry.

## Public API

- `ElevationScenario` — `{ name, ticks, baseSampleM }` (`baseSampleM` = the generator's ground-truth steady-state delta).
- `mulberry32(seed)` / `gaussOf(rng)` — seeded PRNG + Box–Muller normal; tests never touch `Math.random`.
- `SCENARIO_TICK_MS` — 1000 (the estimator's ~1 Hz cadence).
- Generators (each `(seed) → ElevationScenario`):
  - `flatWalk` — constant −2 m delta, walking, good confidence.
  - `hillsideWalk` — constant +1 m delta while walking: the field case that must NEVER freeze (terrain mirrors the climb, so the baseline-free delta stays flat).
  - `towerDwell` — stationary; ramps to +20 m (ticks 40..49), holds 150 ticks, returns. The canonical dwell no timer-based unfreeze survives.
  - `stairwellClimb` — stationary, deliberately GENTLE ramp (0.8 m/tick to 6 m, σ 0.05) sized so the halved (small-extent) CUSUM threshold fires one tick earlier than the full threshold — making the strengthened path observable behaviorally.
  - `bridgeCrossing` — full walking speed throughout (extent must never veto), ramps to +8 m and back.
  - `rampWalk` — full walking speed, sampleM ramps SLOWLY (0.4 m/tick for 60 ticks, ticks 40..99) then levels: the DEM-error-gradient field case that must NEVER freeze (a slow coherent ramp is data, not structure).
  - `underpassWalk` — the negative twin of `bridgeCrossing`: full walking speed, ramps DOWN to −8 m, holds, ramps back — the NEGATIVE CUSUM branch's dedicated coverage.
  - `standstill` — no movement, constant delta + noise (confidence-inflation guard).
  - `gpsOutageWalk` — walking, constant delta, confidence decays toward zero (confidence-collapse path).
  - `garbageConfidenceWalk` — 4 good hits at −2 m + 2 garbage hits at +10 m with confidence 0/NaN per tick (floored-never-rejected weighting guard).

## Invariants & assumptions

- Fully deterministic per seed; encoding convention: `sampleM` is baseline-free, so only man-made structure ramps it.
- `cameraYar` is generated as a plausible finite value (1.6 + base); the estimator only validates it.

## Tests

Consumed by `../ar/elevation-offset-estimator.test.ts` and `../ar/elevation-offset-estimator.property.test.ts`. Related: [../ar/elevation-offset-estimator.ts.md](../ar/elevation-offset-estimator.ts.md).
