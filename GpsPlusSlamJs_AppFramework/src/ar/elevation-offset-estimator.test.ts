/**
 * Elevation-Offset Estimator scenario tests.
 *
 * Why this test matters:
 * The estimator is what keeps GPS-anchored content at a stable height while
 * the user moves through the world — and the freeze layer inside it is what
 * keeps that world from riding up with the user on towers, stairs and
 * bridges. Each test pins one corpus-derived scenario intent:
 * - a flat walk must converge on the true delta and never freeze;
 * - a standstill must not inflate confidence (correlated re-observations
 *   carry almost no new information);
 * - climbs of man-made structure (tower, stairwell, bridge) must freeze
 *   BEFORE the offset follows the climb, stay frozen for arbitrarily long
 *   dwells (unfreeze is state-based, never a timer), and unfreeze when the
 *   samples return to the frozen band;
 * - a hillside walk must NEVER freeze (terrain mirrors the climb, so the
 *   baseline-free delta stays flat — only man-made structure ramps it);
 * - zero/NaN-confidence samples are down-weighted, never divided by, and
 *   cannot dominate;
 * - the slew-rate limit bounds how fast the published offset may move.
 */

import { describe, it, expect } from 'vitest';
import {
  createElevationOffsetEstimator,
  DEFAULT_ELEVATION_OFFSET_OPTIONS,
  type ElevationOffsetOptions,
  type ElevationOffsetState,
  type ElevationOffsetTick,
} from './elevation-offset-estimator';
import {
  bridgeCrossing,
  flatWalk,
  garbageConfidenceWalk,
  gpsOutageWalk,
  hillsideWalk,
  standstill,
  stairwellClimb,
  towerDwell,
  type ElevationScenario,
} from '../test-utils/elevation-offset-scenarios';

function run(
  scenario: ElevationScenario,
  options?: ElevationOffsetOptions
): ElevationOffsetState[] {
  const est = createElevationOffsetEstimator(options);
  return scenario.ticks.map((t) => est.update(t));
}

function firstFrozenIndex(states: readonly ElevationOffsetState[]): number {
  return states.findIndex((s) => s.frozen);
}

/** Max |offsetM − baseM| over all non-null outputs (0 when all null). */
function maxDeviationFromBase(
  states: readonly ElevationOffsetState[],
  baseM: number
): number {
  return states.reduce(
    (m, s) =>
      s.offsetM == null ? m : Math.max(m, Math.abs(s.offsetM - baseM)),
    0
  );
}

function lastState(
  states: readonly ElevationOffsetState[]
): ElevationOffsetState {
  const last = states[states.length - 1];
  if (last == null) {
    throw new Error('empty scenario');
  }
  return last;
}

/** Uniform tick builder for the hand-rolled (non-scenario) streams. */
function makeTick(
  i: number,
  sampleM: number,
  confidence = 0.8,
  count = 6
): ElevationOffsetTick {
  const posE = i * 1.4;
  return {
    tMs: i * 1000,
    posE,
    posN: 0,
    cameraYar: 1.6,
    samples: Array.from({ length: count }, () => ({
      sampleM,
      confidence,
      posE,
      posN: 0,
    })),
  };
}

describe('createElevationOffsetEstimator', () => {
  it('outputs null until the window has minimal sample mass', () => {
    const est = createElevationOffsetEstimator();
    // A lone floored-confidence hit carries almost no weight: no output.
    const first = est.update({
      tMs: 0,
      posE: 0,
      posN: 0,
      cameraYar: 1.6,
      samples: [{ sampleM: 5, confidence: 0, posE: 0, posN: 0 }],
    });
    expect(first.offsetM).toBeNull();
    expect(first.confidence).toBe(0);
    expect(first.frozen).toBe(false);
    // One full-confidence tick clears the mass gate — and the garbage hit
    // cannot outvote it.
    const second = est.update(makeTick(1, -2));
    expect(second.offsetM).not.toBeNull();
    expect(second.offsetM).toBeCloseTo(-2, 6);
  });

  it('converges on a flat walk and never freezes', () => {
    const scenario = flatWalk(21);
    const states = run(scenario);
    expect(states.some((s) => s.frozen)).toBe(false);
    const last = lastState(states);
    expect(last.offsetM).not.toBeNull();
    expect(Math.abs((last.offsetM ?? 0) - scenario.baseSampleM)).toBeLessThan(
      0.3
    );
    // A moving window accumulates real information → confidence saturates.
    expect(last.confidence).toBeGreaterThan(0.9);
  });

  it('standstill does not inflate confidence (correlated samples carry ~no new information)', () => {
    const still = run(standstill(22));
    expect(still.some((s) => s.frozen)).toBe(false);
    const stillConfidence = lastState(still).confidence;
    expect(stillConfidence).toBeLessThan(0.3);
    // The same duration WALKED saturates: novelty weighting is what
    // separates the two, not elapsed time.
    const walked = lastState(run(flatWalk(22))).confidence;
    expect(walked).toBeGreaterThan(stillConfidence);
  });

  it('tower dwell freezes before the offset moves >1.5 m, stays frozen for the whole dwell, and unfreezes on return', () => {
    const scenario = towerDwell(23);
    const states = run(scenario);
    const iFreeze = firstFrozenIndex(states);
    // The climb starts at tick 40; the freeze must land inside the ramp.
    expect(iFreeze).toBeGreaterThanOrEqual(40);
    expect(iFreeze).toBeLessThan(50);
    // The published offset never followed the climb.
    expect(
      maxDeviationFromBase(states, scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
    // Still frozen deep into the 150-tick dwell — proves the unfreeze is
    // state-based, not a timer (no window length survives this dwell).
    expect(states[195]?.frozen).toBe(true);
    // After the ramp back down the samples re-enter the band: unfrozen and
    // re-converged.
    const last = lastState(states);
    expect(last.frozen).toBe(false);
    expect(Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)).toBeLessThan(
      1
    );
  });

  it('bridge crossing freezes at full walking extent (extent never vetoes)', () => {
    const scenario = bridgeCrossing(24);
    const states = run(scenario);
    const iFreeze = firstFrozenIndex(states);
    // The generator walks at full speed throughout, so the horizontal
    // extent is far above the small-extent bound the whole time — the
    // freeze inside the ramp proves the samples alone triggered it.
    expect(iFreeze).toBeGreaterThanOrEqual(40);
    expect(iFreeze).toBeLessThan(50);
    expect(
      maxDeviationFromBase(states, scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
    // Back on ground the layer unfreezes and re-converges.
    const last = lastState(states);
    expect(last.frozen).toBe(false);
    expect(Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)).toBeLessThan(
      1
    );
  });

  it('stairwell climb freezes via the STRENGTHENED (small-extent) path', () => {
    const scenario = stairwellClimb(25);
    const strengthened = run(scenario);
    const iStrengthened = firstFrozenIndex(strengthened);
    // Ramp is ticks 40..47.
    expect(iStrengthened).toBeGreaterThanOrEqual(40);
    expect(iStrengthened).toBeLessThan(48);
    // Behavioral proof the halved threshold is what fired: with the
    // strengthening disabled (smallExtentM: 0 → the extent is never
    // "small"), the same stream freezes strictly LATER on the gentle ramp.
    const unstrengthened = run(scenario, { freeze: { smallExtentM: 0 } });
    const iUnstrengthened = firstFrozenIndex(unstrengthened);
    expect(iUnstrengthened).toBeGreaterThan(iStrengthened);
    // And the offset still never follows the climb.
    expect(
      maxDeviationFromBase(strengthened, scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
    const last = lastState(strengthened);
    expect(last.frozen).toBe(false);
  });

  it('hillside walk with constant sample NEVER freezes', () => {
    const scenario = hillsideWalk(26);
    const states = run(scenario);
    expect(states.some((s) => s.frozen)).toBe(false);
    const last = lastState(states);
    expect(Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)).toBeLessThan(
      0.3
    );
  });

  it('zero/NaN-confidence samples cannot dominate the estimate', () => {
    const scenario = garbageConfidenceWalk(27);
    const states = run(scenario);
    expect(states.some((s) => s.frozen)).toBe(false);
    // The +10 m garbage never drags the offset off the good samples' base.
    expect(
      maxDeviationFromBase(states, scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
  });

  it('freezes via confidence collapse when sample confidence decays', () => {
    const scenario = gpsOutageWalk(28);
    const states = run(scenario);
    const iFreeze = firstFrozenIndex(states);
    // The decay starts at tick 30; the collapse freeze fires once the mean
    // confidence over the coverage window drops below the floor.
    expect(iFreeze).toBeGreaterThan(30);
    // Confidence never recovers in this scenario, so it stays frozen — at a
    // value still near the pre-outage estimate.
    const last = lastState(states);
    expect(last.frozen).toBe(true);
    expect(
      Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
  });

  it('slew limit bounds the output rate to slewRatePerSecondM', () => {
    // Freeze disabled via an unreachable threshold: this isolates the slew
    // behavior on a hard 0 → +10 m step in the sample stream.
    const est = createElevationOffsetEstimator({
      freeze: { thresholdM: 1_000_000 },
    });
    const states: ElevationOffsetState[] = [];
    for (let i = 0; i < 120; i++) {
      states.push(est.update(makeTick(i, i < 40 ? 0 : 10)));
    }
    const slew = DEFAULT_ELEVATION_OFFSET_OPTIONS.slewRatePerSecondM;
    const maxStepPerTick = states.reduce((m, s, i) => {
      const prev = i > 0 ? states[i - 1] : undefined;
      if (prev?.offsetM == null || s.offsetM == null) {
        return m;
      }
      return Math.max(m, Math.abs(s.offsetM - prev.offsetM));
    }, 0);
    // Ticks are 1 s apart, so the per-tick step is bounded by the rate.
    expect(maxStepPerTick).toBeLessThanOrEqual(slew + 1e-9);
    // ...and the output still gets there (damped, not stuck).
    expect(lastState(states).offsetM).toBeCloseTo(10, 6);
  });

  it('skips non-finite ticks without corrupting state', () => {
    const est = createElevationOffsetEstimator();
    const before = est.update(makeTick(0, -2));
    const duringGlitch = est.update({
      tMs: 1000,
      posE: Number.NaN,
      posN: 0,
      cameraYar: 1.6,
      samples: [{ sampleM: -2, confidence: 0.8, posE: 0, posN: 0 }],
    });
    expect(duringGlitch).toEqual(before);
    const glitchedCamera = est.update({
      tMs: 2000,
      posE: 2.8,
      posN: 0,
      cameraYar: Number.NaN,
      samples: [{ sampleM: -2, confidence: 0.8, posE: 2.8, posN: 0 }],
    });
    expect(glitchedCamera).toEqual(before);
    const after = est.update(makeTick(3, -2));
    expect(after.offsetM).toBeCloseTo(-2, 6);
  });

  it('rejects malformed options with RangeError', () => {
    expect(() => createElevationOffsetEstimator({ windowSeconds: 0 })).toThrow(
      RangeError
    );
    expect(() =>
      createElevationOffsetEstimator({ slewRatePerSecondM: -1 })
    ).toThrow(RangeError);
    expect(() =>
      createElevationOffsetEstimator({ distanceCapM: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      createElevationOffsetEstimator({ freeze: { lowConfidence: 2 } })
    ).toThrow(RangeError);
    expect(() =>
      createElevationOffsetEstimator({ freeze: { thresholdM: Number.NaN } })
    ).toThrow(RangeError);
    expect(() =>
      createElevationOffsetEstimator({ freeze: { driftPerTickM: -0.1 } })
    ).toThrow(RangeError);
  });
});
