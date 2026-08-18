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
  MAX_SLEW_DT_S,
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
  rampWalk,
  standstill,
  stairwellClimb,
  towerDwell,
  underpassWalk,
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

/** Max |Δ offsetM| between consecutive non-null outputs (0 when none). */
function maxStepPerTick(states: readonly ElevationOffsetState[]): number {
  return states.reduce((m, s, i) => {
    const prev = i > 0 ? states[i - 1] : undefined;
    if (prev?.offsetM == null || s.offsetM == null) {
      return m;
    }
    return Math.max(m, Math.abs(s.offsetM - prev.offsetM));
  }, 0);
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
  it('a long tick GAP buys no extra step budget (slew dt is clamped)', () => {
    // Why this test matters: the slew budget is `rate × dt`, and `dt` is
    // wall-clock. A caller that withholds ticks — a pose gap, a suspended
    // tab, a consumer that skips `update` while tracking is lost — could
    // therefore hand the estimator a 20 s dt and license a 10 m single-tick
    // jump of the whole world, against a window that has meanwhile evicted
    // and holds only the FIRST post-gap tick's samples. A gap must only
    // DELAY progress, never buy it, and that has to be enforced HERE so no
    // consumer can opt out of it by withholding ticks.
    const options: ElevationOffsetOptions = {
      windowSeconds: 10,
      // Isolate the slew: the freeze layer would otherwise snapshot the
      // output on the post-gap step and hide the budget entirely.
      freeze: { thresholdM: 1e6, lowConfidence: 0 },
    };
    const est = createElevationOffsetEstimator(options);
    let last: ElevationOffsetState | undefined;
    for (let i = 0; i < 5; i++) {
      last = est.update(makeTick(i, 0));
    }
    expect(last?.offsetM).toBeCloseTo(0, 6);

    // 20 s of silence, then a tick whose window (all older samples evicted)
    // medians at +10 m.
    const gapped = est.update({
      ...makeTick(5, 10),
      tMs: 4000 + 20_000,
    });
    const budgetM =
      DEFAULT_ELEVATION_OFFSET_OPTIONS.slewRatePerSecondM * MAX_SLEW_DT_S;
    expect(Math.abs(gapped.offsetM ?? 99)).toBeLessThanOrEqual(budgetM + 1e-9);
  });

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

  it('normalizes confidence per TICK — hit count cannot inflate it (F6 recalibration)', () => {
    // Why this test matters: the 88-recording corpus measured a median 28
    // FloorEstimate hits per production tick (p90 72) against the "~6
    // hits/tick" the old per-HIT saturation mass was sized on — so the
    // published confidence pegged at ~1.0 on 72% of recordings and carried
    // no signal. A tick's hits are intra-tick CORRELATED (one floor patch,
    // one shared estimate confidence): thirty of them are not five times
    // the evidence of six. Confidence must therefore accumulate per tick
    // (novelty × mean hit quality), so the same walk reported with a denser
    // depth grid yields the SAME confidence.
    const sparse = createElevationOffsetEstimator();
    const dense = createElevationOffsetEstimator();
    let sparseState: ElevationOffsetState | undefined;
    let denseState: ElevationOffsetState | undefined;
    for (let i = 0; i < 3; i++) {
      sparseState = sparse.update(makeTick(i, -2, 0.8, 6));
      denseState = dense.update(makeTick(i, -2, 0.8, 30));
    }
    expect(denseState?.confidence).toBeCloseTo(
      sparseState?.confidence ?? -1,
      6
    );
    // And the early-window confidence keeps headroom instead of saturating:
    // three ticks of one walk are NOT full certainty, however dense the grid.
    expect(denseState?.confidence).toBeLessThan(0.5);
    expect(denseState?.confidence).toBeGreaterThan(0);
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

  it('a slow coherent ramp (0.4 m/tick while walking) never freezes and is tracked within the slew bound', () => {
    // Why this test matters: a DEM error gradient on a hill makes the
    // baseline-free sample ramp slowly and coherently while the user walks.
    // That ramp is DATA — an estimator that freezes on it parks the offset
    // and (on a one-way walk) never re-enters the unfreeze band, so the
    // world stays wrong for the rest of the session.
    const scenario = rampWalk(31);
    const states = run(scenario);
    expect(states.some((s) => s.frozen)).toBe(false);
    // The output follows the ramp within the slew bound per tick...
    const slew = DEFAULT_ELEVATION_OFFSET_OPTIONS.slewRatePerSecondM;
    expect(maxStepPerTick(states)).toBeLessThanOrEqual(slew + 1e-9);
    // ...and after the post-ramp level stretch it has caught up.
    const last = lastState(states);
    expect(Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)).toBeLessThan(
      0.5
    );
  });

  it('underpass walk freezes via the NEGATIVE CUSUM branch and unfreezes on return', () => {
    // Why this test matters: a downward structure ramp (underpass, sunken
    // walkway) can only accumulate on the negative CUSUM side — this is that
    // branch's only scenario coverage. The offset must not follow the user
    // down, and the return to ground must unfreeze it.
    const scenario = underpassWalk(32);
    const states = run(scenario);
    const iFreeze = firstFrozenIndex(states);
    // The down-ramp is ticks 40..49; the freeze must land inside it.
    expect(iFreeze).toBeGreaterThanOrEqual(40);
    expect(iFreeze).toBeLessThan(50);
    expect(
      maxDeviationFromBase(states, scenario.baseSampleM)
    ).toBeLessThanOrEqual(1.5);
    const last = lastState(states);
    expect(last.frozen).toBe(false);
    expect(Math.abs((last.offsetM ?? 99) - scenario.baseSampleM)).toBeLessThan(
      1
    );
  });

  it('an alternating outlier/good tick stream keeps the output advancing (never wedges frozen)', () => {
    // Why this test matters: with an unweighted per-tick aggregate, a tick
    // whose zero-confidence garbage hits form the numeric majority yields a
    // garbage aggregate, freezing the estimator; the next good tick then
    // unfroze it with a zero slew budget, so the output was permanently
    // wedged while flapping frozen/unfrozen. Confidence-weighting the
    // aggregate (same floors as the window median) makes garbage ticks
    // harmless and the output must keep tracking the good hits' slow rise.
    const est = createElevationOffsetEstimator();
    const states: ElevationOffsetState[] = [];
    for (let i = 0; i < 40; i++) {
      const baseM = i < 10 ? 0 : 0.2 * (i - 9); // slow coherent rise (DATA)
      const posE = i * 1.4;
      const good = (n: number) =>
        Array.from({ length: n }, () => ({
          sampleM: baseM,
          confidence: 0.8,
          posE,
          posN: 0,
        }));
      const garbage = (n: number) =>
        Array.from({ length: n }, (_, k) => ({
          sampleM: baseM + 10,
          confidence: k % 2 === 0 ? 0 : Number.NaN,
          posE,
          posN: 0,
        }));
      const samples =
        i >= 10 && i % 2 === 1 ? [...good(2), ...garbage(4)] : good(6);
      states.push(
        est.update({ tMs: i * 1000, posE, posN: 0, cameraYar: 1.6, samples })
      );
    }
    expect(states.some((s) => s.frozen)).toBe(false);
    const atStart = states[10]?.offsetM;
    const atEnd = states[39]?.offsetM;
    expect(atStart).not.toBeNull();
    expect(atEnd).not.toBeNull();
    // Net movement over the alternating stretch: the output tracked the
    // rise instead of being wedged at its pre-outlier value.
    expect((atEnd ?? 0) - (atStart ?? 0)).toBeGreaterThan(2);
  });

  it('unfreezes only after 3 consecutive in-band ticks (a lone in-band tick cannot unfreeze)', () => {
    // Why this test matters: with a single-tick unfreeze, one lucky in-band
    // aggregate in an otherwise out-of-band stream (noise, an outlier tick)
    // unfreezes the estimator mid-climb and lets the next tick re-freeze it
    // at a corrupted snapshot. Requiring a streak makes the unfreeze a
    // state decision, not a coin flip.
    const est = createElevationOffsetEstimator();
    const states: ElevationOffsetState[] = [];
    const push = (i: number, v: number) =>
      states.push(est.update(makeTick(i, v)));
    for (let i = 0; i < 10; i++) push(i, 0); // establish output ≈ 0
    push(10, 8); // structure step → freeze
    expect(states[10]?.frozen).toBe(true);
    push(11, 0); // in-band tick 1 — must NOT unfreeze yet
    expect(states[11]?.frozen).toBe(true);
    push(12, 8); // out-of-band: resets the streak
    expect(states[12]?.frozen).toBe(true);
    push(13, 0);
    push(14, 0);
    expect(states[14]?.frozen).toBe(true); // streak 2 — still frozen
    push(15, 0);
    expect(states[15]?.frozen).toBe(false); // streak 3 → unfreeze
  });

  it('re-anchors the slew clock on unfreeze: the first unfrozen tick has a full step budget', () => {
    // Why this test matters: anchoring the slew clock to the unfreeze tick
    // itself made dt = 0, so the unfreeze tick could not move at all — in
    // an alternating stream that zero budget was what wedged the output.
    // The anchor must be the PREVIOUS tick, giving the resume a normal
    // one-tick budget while still never granting retroactive dwell credit.
    const est = createElevationOffsetEstimator();
    const states: ElevationOffsetState[] = [];
    const push = (i: number, v: number) =>
      states.push(est.update(makeTick(i, v)));
    for (let i = 0; i < 10; i++) push(i, 0); // establish output = 0
    for (let i = 10; i < 70; i++) push(i, 8); // long dwell → frozen, window ages out
    for (let i = 70; i < 73; i++) push(i, -1); // in-band (|−1 − 0| ≤ 1.5)
    const iUnfreeze = states.findIndex((s, i) => i > 10 && !s.frozen);
    expect(iUnfreeze).toBe(72); // third consecutive in-band tick
    // The unfreeze tick itself moves toward the new median (−1) with a full
    // 1 s budget: 0.5 m — not pinned at the frozen value by a dt of 0.
    expect(states[72]?.offsetM).toBeCloseTo(-0.5, 6);
  });

  it('holds an established output through an estimate-less gap and slews on recovery (never null, never a jump)', () => {
    // Why this test matters: a 50 s stretch without floor estimates (bad
    // tracking, featureless ground) empties the window. Flapping to null
    // would yank anchored content away and then snap it back; the correct
    // behavior is to hold the last output with decaying confidence and
    // SLEW toward the new median when data returns.
    const est = createElevationOffsetEstimator();
    const states: ElevationOffsetState[] = [];
    for (let i = 0; i < 15; i++) states.push(est.update(makeTick(i, 0)));
    expect(states[14]?.offsetM).toBeCloseTo(0, 6);
    const confBefore = states[14]?.confidence ?? 0;
    for (let i = 15; i < 65; i++) {
      states.push(est.update(makeTick(i, 0, 0.8, 0))); // ticks, no samples
    }
    const gapStates = states.slice(15, 65);
    // The gap must hold the output — never flap to null...
    expect(gapStates.every((s) => s.offsetM != null)).toBe(true);
    // ...and a data gap is not a freeze.
    expect(gapStates.some((s) => s.frozen)).toBe(false);
    // Confidence decays through the gap instead of staying stale.
    expect(states[64]?.confidence).toBeLessThan(confBefore / 2);
    // Recovery at a shifted base: the output slews, it never jumps.
    for (let i = 65; i < 80; i++) states.push(est.update(makeTick(i, 1)));
    const slew = DEFAULT_ELEVATION_OFFSET_OPTIONS.slewRatePerSecondM;
    expect(maxStepPerTick(states)).toBeLessThanOrEqual(slew + 1e-9);
    expect(lastState(states).offsetM).toBeCloseTo(1, 1);
  });

  it('confidence collapse still freezes at a degraded 0.5 Hz tick rate', () => {
    // Why this test matters: the old coverage gate required the retained
    // ticks to SPAN ≥ 90% of the 5 s window — at 0.5 Hz the retained ticks
    // can only ever span 4 s, so the collapse branch was structurally dead
    // exactly when the tick source was degraded. The gate must be an
    // absolute evidence count (≥3 ticks spanning ≥2.5 s), not a fraction.
    const est = createElevationOffsetEstimator();
    const states: ElevationOffsetState[] = [];
    for (let i = 0; i < 26; i++) {
      const posE = i * 2.8; // walking, 2 s per tick
      const confidence = i < 10 ? 0.8 : 0.05;
      states.push(
        est.update({
          tMs: i * 2000,
          posE,
          posN: 0,
          cameraYar: 1.6,
          samples: Array.from({ length: 6 }, () => ({
            sampleM: 0,
            confidence,
            posE,
            posN: 0,
          })),
        })
      );
    }
    const iFreeze = firstFrozenIndex(states);
    expect(iFreeze).toBeGreaterThan(10);
    expect(lastState(states).frozen).toBe(true);
    // The freeze parked the offset at its pre-collapse value.
    expect(Math.abs(lastState(states).offsetM ?? 99)).toBeLessThanOrEqual(0.5);
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
    // While frozen the PUBLISHED confidence must decay toward the collapsed
    // tick-stream confidence — a frozen offset advertising its healthy
    // freeze-time confidence would keep consumers trusting a parked value.
    expect(last.confidence).toBeLessThan(0.3);
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
    // Ticks are 1 s apart, so the per-tick step is bounded by the rate.
    expect(maxStepPerTick(states)).toBeLessThanOrEqual(slew + 1e-9);
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
