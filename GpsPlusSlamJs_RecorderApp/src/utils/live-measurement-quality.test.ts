import { describe, expect, test } from 'vitest';
import {
  computeLateralBaselineM,
  decideCoachingPrompt,
  evaluateMeasurementQuality,
  reduceLiveMeasurementDraft,
  updateLateralBaselineCache,
  validateThresholds,
  type CoachingPrompt,
  type LiveMeasurementDraft,
  type QualityInputs,
  type QualityThresholds,
} from './live-measurement-quality';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_THRESHOLDS: QualityThresholds = {
  thresholdProfileId: 'default-v1',
  thresholdVersion: 1,
  minInliers: 2,
  minBaselineM: 5,
  targetUncertainty: 0.05,
  maxUncertaintyHard: 0.2,
  maxRmsError: 0.1,
  maxObservationAgeMs: 2000,
  maxPoseDepthSkewMs: 100,
  readyEnterScore: 0.75,
  readyExitScore: 0.6,
};

function makeInputs(overrides: Partial<QualityInputs> = {}): QualityInputs {
  return {
    uncertainty: 0.02,
    rmsError: 0.01,
    baselineM: 6,
    rayCount: 5,
    inlierCount: 4,
    hasSolvedPoint: true,
    solverDegenerate: false,
    observationAgeMs: 10,
    poseDepthTimeSkewMs: 5,
    ...overrides,
  };
}

// score = .45u + .30b + .15r + .10i
// u=0.9 (uncertainty=0.02), b=1 (baselineM=5), r=0.9 (rmsError=0.01), i=1 (inlierCount=2)
const HIGH_QUALITY_INPUTS = makeInputs({
  uncertainty: 0.02,
  baselineM: 5,
  rmsError: 0.01,
  inlierCount: 2,
}); // score ~0.94

// u=0.7 (uncertainty=0.06), b=0.5 (baselineM=2.5), r=0.8 (rmsError=0.02), i=1
const MID_QUALITY_INPUTS = makeInputs({
  uncertainty: 0.06,
  baselineM: 2.5,
  rmsError: 0.02,
  inlierCount: 2,
}); // score ~0.685 (between readyExitScore .6 and readyEnterScore .75)

// u=0.3 (uncertainty=0.14), b=0.2 (baselineM=1), r=0.5 (rmsError=0.05), i=1
const LOW_QUALITY_INPUTS = makeInputs({
  uncertainty: 0.14,
  baselineM: 1,
  rmsError: 0.05,
  inlierCount: 2,
}); // score ~0.37

function makeIdleDraft(
  thresholds: QualityThresholds = BASE_THRESHOLDS
): LiveMeasurementDraft {
  return {
    status: 'idle',
    prompt: 'none',
    canConfirm: false,
    lastQualityScore: 0,
    thresholdProfileId: thresholds.thresholdProfileId,
    thresholdVersion: thresholds.thresholdVersion,
  };
}

function makeDraft(
  overrides: Partial<LiveMeasurementDraft>
): LiveMeasurementDraft {
  return { ...makeIdleDraft(), ...overrides };
}

// ---------------------------------------------------------------------------
// evaluateMeasurementQuality
// ---------------------------------------------------------------------------

describe('evaluateMeasurementQuality', () => {
  test('returns hardBlocked when hasSolvedPoint is false', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ hasSolvedPoint: false }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('no_solved_point');
  });

  test('returns hardBlocked when solverDegenerate is true', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ solverDegenerate: true }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('solver_degenerate');
  });

  test('fails fast when thresholds violate config constraints', () => {
    const invalidThresholds: QualityThresholds = {
      ...BASE_THRESHOLDS,
      readyEnterScore: 0.5,
      readyExitScore: 0.6, // violates readyEnterScore > readyExitScore
    };
    expect(() =>
      evaluateMeasurementQuality(makeInputs(), invalidThresholds, false)
    ).toThrow(/readyEnterScore/);

    expect(() => validateThresholds(invalidThresholds)).toThrow();

    const invalidUncertaintyBand: QualityThresholds = {
      ...BASE_THRESHOLDS,
      maxUncertaintyHard: 0.04, // must be > targetUncertainty (0.05)
    };
    expect(() => validateThresholds(invalidUncertaintyBand)).toThrow(
      /maxUncertaintyHard/
    );

    const invalidMinInliers: QualityThresholds = {
      ...BASE_THRESHOLDS,
      minInliers: 0,
    };
    expect(() => validateThresholds(invalidMinInliers)).toThrow(/minInliers/);

    const nonFiniteThreshold: QualityThresholds = {
      ...BASE_THRESHOLDS,
      maxRmsError: Number.NaN,
    };
    expect(() => validateThresholds(nonFiniteThreshold)).toThrow(
      /finite and non-negative/
    );
  });

  test('blocks confirmation when observationAgeMs > maxObservationAgeMs', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ observationAgeMs: 5000 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('stale_observation');
  });

  test('blocks confirmation when poseDepthTimeSkewMs > maxPoseDepthSkewMs', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ poseDepthTimeSkewMs: 500 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('pose_depth_time_skew');
  });

  test('blocks confirmation when inlierCount < minInliers', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ inlierCount: 1 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('insufficient_inliers');
  });

  test('blocks confirmation when uncertainty > maxUncertaintyHard', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ uncertainty: 0.5 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.ready).toBe(false);
    expect(evaluation.reasons).toContain('uncertainty_too_high');
  });

  test('blocks confirmation when uncertainty is null', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ uncertainty: null }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.reasons).toContain('uncertainty_too_high');
  });

  test('blocks confirmation when rmsError > maxRmsError', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ rmsError: 0.5 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.reasons).toContain('residual_too_high');
  });

  test('rmsError == null is neutral (does not hard-block)', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ rmsError: null }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.reasons).not.toContain('residual_too_high');
  });

  test('returns hardBlocked with invalid_input for non-finite values', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ baselineM: Number.NaN }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.reasons).toEqual(['invalid_input']);
  });

  test('returns hardBlocked with invalid_input for negative values', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ inlierCount: -1 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.hardBlocked).toBe(true);
    expect(evaluation.reasons).toEqual(['invalid_input']);
  });

  test('score increases when baseline grows and uncertainty drops', () => {
    const weak = evaluateMeasurementQuality(
      makeInputs({ baselineM: 1, uncertainty: 0.15 }),
      BASE_THRESHOLDS,
      false
    );
    const stronger = evaluateMeasurementQuality(
      makeInputs({ baselineM: 3, uncertainty: 0.08 }),
      BASE_THRESHOLDS,
      false
    );
    const strongest = evaluateMeasurementQuality(
      makeInputs({ baselineM: 6, uncertainty: 0.02 }),
      BASE_THRESHOLDS,
      false
    );
    expect(stronger.score).toBeGreaterThan(weak.score);
    expect(strongest.score).toBeGreaterThan(stronger.score);
  });

  test('score decreases when rmsError rises above target', () => {
    const good = evaluateMeasurementQuality(
      makeInputs({ rmsError: 0.01 }),
      BASE_THRESHOLDS,
      false
    );
    const worse = evaluateMeasurementQuality(
      makeInputs({ rmsError: 0.04 }),
      BASE_THRESHOLDS,
      false
    );
    const worst = evaluateMeasurementQuality(
      makeInputs({ rmsError: 0.09 }),
      BASE_THRESHOLDS,
      false
    );
    expect(worse.score).toBeLessThan(good.score);
    expect(worst.score).toBeLessThan(worse.score);
  });

  test('hysteresis: ready enters at readyEnterScore and exits only below readyExitScore', () => {
    const entered = evaluateMeasurementQuality(
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      false
    );
    expect(entered.ready).toBe(true);

    // Mid-band score: below readyEnterScore but above readyExitScore.
    const staysReady = evaluateMeasurementQuality(
      MID_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      entered.ready
    );
    expect(staysReady.ready).toBe(true);

    const exits = evaluateMeasurementQuality(
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      staysReady.ready
    );
    expect(exits.ready).toBe(false);

    // Same mid-band score, but now coming from a not-ready state: must NOT
    // re-enter until it clears readyEnterScore.
    const staysNotReady = evaluateMeasurementQuality(
      MID_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      exits.ready
    );
    expect(staysNotReady.ready).toBe(false);
  });

  test('remains O(1) with respect to observation count', () => {
    const iterations = 2000;

    const start1 = performance.now();
    for (let k = 0; k < iterations; k++) {
      evaluateMeasurementQuality(
        makeInputs({ rayCount: 5 }),
        BASE_THRESHOLDS,
        false
      );
    }
    const smallDuration = performance.now() - start1;

    const start2 = performance.now();
    for (let k = 0; k < iterations; k++) {
      evaluateMeasurementQuality(
        makeInputs({ rayCount: 1_000_000 }),
        BASE_THRESHOLDS,
        false
      );
    }
    const largeDuration = performance.now() - start2;

    // rayCount is just a number consumed by O(1) math — a million-ray count
    // must not measurably slow the evaluator down relative to a handful.
    expect(largeDuration).toBeLessThan(smallDuration * 5 + 100);
  });
});

// ---------------------------------------------------------------------------
// decideCoachingPrompt
// ---------------------------------------------------------------------------

describe('decideCoachingPrompt', () => {
  test('low baseline + high uncertainty -> move_sideways', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({ baselineM: 0.5, uncertainty: 0.19, inlierCount: 2 }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.prompt).toBe('move_sideways');
  });

  test('enough baseline but low inliers -> add_more_rays', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({
        baselineM: 5,
        uncertainty: 0.04,
        rmsError: 0.01,
        inlierCount: 1,
      }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.prompt).toBe('add_more_rays');
  });

  test('high residual with moderate baseline -> reaim_target', () => {
    const evaluation = evaluateMeasurementQuality(
      makeInputs({
        baselineM: 5,
        uncertainty: 0.04,
        rmsError: 0.08,
        inlierCount: 3,
      }),
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.prompt).toBe('reaim_target');
  });

  test('ready evaluation -> ready_to_confirm', () => {
    const evaluation = evaluateMeasurementQuality(
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      false
    );
    expect(evaluation.ready).toBe(true);
    expect(evaluation.prompt).toBe('ready_to_confirm');
  });

  test('decideCoachingPrompt used directly against an evaluation is consistent', () => {
    const evaluation = evaluateMeasurementQuality(
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      false
    );
    expect(decideCoachingPrompt(HIGH_QUALITY_INPUTS, evaluation)).toBe(
      evaluation.prompt
    );
  });

  test('uncertainty-to-prompt mapping is monotonic for fixed (low) baseline', () => {
    // rank: higher = more optimistic. Fixed baseline below the move_sideways
    // threshold (b < 0.7); only uncertainty varies.
    const rank = (prompt: CoachingPrompt): number =>
      prompt === 'move_sideways' ? 0 : prompt === 'ready_to_confirm' ? 2 : 1;

    const uncertainties = [0.01, 0.04, 0.06, 0.09, 0.12, 0.15, 0.18];
    const ranks = uncertainties.map((uncertainty) => {
      const evaluation = evaluateMeasurementQuality(
        makeInputs({
          baselineM: 3, // b = 0.6 -> below the move_sideways baseline threshold
          uncertainty,
          rmsError: 0.01,
          inlierCount: 2,
        }),
        BASE_THRESHOLDS,
        false
      );
      return rank(evaluation.prompt);
    });

    for (let idx = 1; idx < ranks.length; idx++) {
      // Increasing uncertainty (worsening quality) must never increase
      // optimism relative to the previous, lower-uncertainty step.
      expect(ranks[idx]).toBeLessThanOrEqual(ranks[idx - 1]);
    }
    // And it must actually reach move_sideways once uncertainty is high enough.
    expect(ranks[ranks.length - 1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reduceLiveMeasurementDraft
// ---------------------------------------------------------------------------

describe('reduceLiveMeasurementDraft', () => {
  test('first valid solve moves idle -> provisional', () => {
    const draft = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      makeInputs({ hasSolvedPoint: true }),
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('provisional');
  });

  test('idle stays idle when there is no solved point yet', () => {
    const draft = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      makeInputs({ hasSolvedPoint: false }),
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('idle');
  });

  test('repeated updates with improving quality move provisional/refining -> ready', () => {
    let draft = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('provisional');

    draft = reduceLiveMeasurementDraft(
      draft,
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('refining');

    draft = reduceLiveMeasurementDraft(
      draft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('ready');
    expect(draft.canConfirm).toBe(true);
  });

  test('degraded follow-up sample moves ready -> refining (hysteresis-respecting)', () => {
    let draft = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    draft = reduceLiveMeasurementDraft(
      draft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('ready');

    // Mid-band score stays ready (hysteresis holds).
    draft = reduceLiveMeasurementDraft(
      draft,
      MID_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('ready');

    // Low score forces the exit.
    draft = reduceLiveMeasurementDraft(
      draft,
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('refining');
  });

  test('canConfirm mirrors evaluation.ready and hard guard status', () => {
    const hardBlockedButHighScoring = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      { ...HIGH_QUALITY_INPUTS, solverDegenerate: true },
      BASE_THRESHOLDS
    );
    expect(hardBlockedButHighScoring.canConfirm).toBe(false);

    const draft = reduceLiveMeasurementDraft(
      reduceLiveMeasurementDraft(
        makeIdleDraft(),
        HIGH_QUALITY_INPUTS,
        BASE_THRESHOLDS
      ),
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.canConfirm).toBe(draft.status === 'ready');
  });

  test('explicit confirm action moves ready -> confirm_pending', () => {
    const readyDraft = makeDraft({ status: 'ready', canConfirm: true });
    const pending = reduceLiveMeasurementDraft(
      readyDraft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmRequested' }
    );
    expect(pending.status).toBe('confirm_pending');
  });

  test('persistence success event moves confirm_pending -> confirmed', () => {
    const pending = makeDraft({ status: 'confirm_pending' });
    const confirmed = reduceLiveMeasurementDraft(
      pending,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmSucceeded' }
    );
    expect(confirmed.status).toBe('confirmed');
  });

  test('persistence timeout/error moves confirm_pending -> confirm_failed', () => {
    const pending = makeDraft({ status: 'confirm_pending' });
    const failed = reduceLiveMeasurementDraft(
      pending,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmFailed' }
    );
    expect(failed.status).toBe('confirm_failed');
  });

  test('retry from confirm_failed is idempotent and returns to confirm_pending', () => {
    const failed = makeDraft({ status: 'confirm_failed' });
    const retry1 = reduceLiveMeasurementDraft(
      failed,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmRequested' }
    );
    expect(retry1.status).toBe('confirm_pending');

    const retry2 = reduceLiveMeasurementDraft(
      retry1,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmRequested' }
    );
    expect(retry2.status).toBe('confirm_pending');
  });

  test('confirmed drafts are frozen against recompute and further confirm requests', () => {
    const confirmed = makeDraft({ status: 'confirmed' });
    const afterRecompute = reduceLiveMeasurementDraft(
      confirmed,
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(afterRecompute.status).toBe('confirmed');

    const afterConfirmRequested = reduceLiveMeasurementDraft(
      confirmed,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'confirmRequested' }
    );
    expect(afterConfirmRequested.status).toBe('confirmed');
  });

  test('confirm_pending is frozen against plain recompute (no dropped/duplicate submits)', () => {
    const pending = makeDraft({
      status: 'confirm_pending',
      lastQualityScore: 0.9,
    });
    const afterRecompute = reduceLiveMeasurementDraft(
      pending,
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(afterRecompute.status).toBe('confirm_pending');
    expect(afterRecompute.lastQualityScore).toBe(0.9);
  });

  test.each(['provisional', 'refining', 'ready', 'confirm_failed'] as const)(
    'cancelDraft from %s resets draft to idle with canConfirm=false',
    (status) => {
      const draft = makeDraft({
        status,
        canConfirm: true,
        lastQualityScore: 0.9,
      });
      const cancelled = reduceLiveMeasurementDraft(
        draft,
        HIGH_QUALITY_INPUTS,
        BASE_THRESHOLDS,
        { type: 'cancelDraft' }
      );
      expect(cancelled.status).toBe('idle');
      expect(cancelled.canConfirm).toBe(false);
    }
  );

  test('cancelDraft does not affect confirm_pending (in-flight persistence write)', () => {
    const pending = makeDraft({ status: 'confirm_pending' });
    const result = reduceLiveMeasurementDraft(
      pending,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'cancelDraft' }
    );
    expect(result.status).toBe('confirm_pending');
  });

  test('cancelDraft does not affect a confirmed draft', () => {
    const confirmed = makeDraft({ status: 'confirmed' });
    const result = reduceLiveMeasurementDraft(
      confirmed,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'cancelDraft' }
    );
    expect(result.status).toBe('confirmed');
  });

  test('retargetDraft always clears stale readiness before accepting new observations', () => {
    const readyDraft = makeDraft({
      status: 'ready',
      canConfirm: true,
      lastQualityScore: 0.94,
      prompt: 'ready_to_confirm',
    });
    const retargeted = reduceLiveMeasurementDraft(
      readyDraft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'retargetDraft' }
    );
    expect(retargeted.status).toBe('provisional');
    expect(retargeted.canConfirm).toBe(false);
    expect(retargeted.lastQualityScore).toBe(0);
    expect(retargeted.prompt).toBe('none');
  });

  test('removeLastRay can never keep status=ready without recompute passing guards again', () => {
    const readyDraft = makeDraft({ status: 'ready', canConfirm: true });

    const degraded = reduceLiveMeasurementDraft(
      readyDraft,
      LOW_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'removeLastRay' }
    );
    expect(degraded.status).not.toBe('ready');

    const stillGood = reduceLiveMeasurementDraft(
      readyDraft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'removeLastRay' }
    );
    expect(stillGood.status).toBe('ready');
  });

  test('resetAfterConfirmFailed clears error state and returns to idle', () => {
    const failed = makeDraft({
      status: 'confirm_failed',
      lastQualityScore: 0.4,
    });
    const reset = reduceLiveMeasurementDraft(
      failed,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS,
      { type: 'resetAfterConfirmFailed' }
    );
    expect(reset.status).toBe('idle');
    expect(reset.canConfirm).toBe(false);
    expect(reset.lastQualityScore).toBe(0);
  });

  // ─── Synthetic sequence coverage ──────────────────────────────────────────

  test('far-target sequence: increasing lateral baseline shrinks uncertainty and prompt moves move_sideways -> ready_to_confirm', () => {
    const sequence: QualityInputs[] = [
      makeInputs({
        baselineM: 0.3,
        uncertainty: 0.19,
        rmsError: 0.02,
        inlierCount: 1,
      }),
      makeInputs({
        baselineM: 1.0,
        uncertainty: 0.15,
        rmsError: 0.02,
        inlierCount: 2,
      }),
      makeInputs({
        baselineM: 2.5,
        uncertainty: 0.09,
        rmsError: 0.015,
        inlierCount: 2,
      }),
      makeInputs({
        baselineM: 5.0,
        uncertainty: 0.03,
        rmsError: 0.01,
        inlierCount: 3,
      }),
    ];

    let draft = makeIdleDraft();
    const prompts: string[] = [];
    const uncertainties: number[] = [];
    for (const inputs of sequence) {
      draft = reduceLiveMeasurementDraft(draft, inputs, BASE_THRESHOLDS);
      prompts.push(draft.prompt);
      uncertainties.push(draft.uncertainty ?? Number.NaN);
    }

    expect(prompts[0]).toBe('move_sideways');
    expect(prompts[prompts.length - 1]).toBe('ready_to_confirm');
    expect(draft.status).toBe('ready');

    // Uncertainty readout shrinks monotonically over the sequence.
    for (let idx = 1; idx < uncertainties.length; idx++) {
      expect(uncertainties[idx]).toBeLessThan(uncertainties[idx - 1]);
    }
  });

  test('short-range sequence: strong initial depth starts provisional and reaches ready quickly', () => {
    let draft = reduceLiveMeasurementDraft(
      makeIdleDraft(),
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('provisional');

    draft = reduceLiveMeasurementDraft(
      draft,
      HIGH_QUALITY_INPUTS,
      BASE_THRESHOLDS
    );
    expect(draft.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// computeLateralBaselineM
// ---------------------------------------------------------------------------

describe('computeLateralBaselineM', () => {
  test('pure forward motion along mean ray direction yields near-zero lateral baseline', () => {
    const origins = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
    ];
    const baseline = computeLateralBaselineM(origins, { x: 0, y: 0, z: 1 });
    expect(baseline).toBeCloseTo(0, 6);
  });

  test('sideways motion increases baseline proportionally', () => {
    const smallSpread = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      { x: 0, y: 0, z: 1 }
    );
    const largeSpread = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      { x: 0, y: 0, z: 1 }
    );
    expect(smallSpread).toBeCloseTo(1, 6);
    expect(largeSpread).toBeCloseTo(4, 6);
  });

  test('mixed path reports lateral component only', () => {
    // Forward (z) and sideways (x) both advance by 2, but only the x
    // (lateral) component should count toward the baseline.
    const origins = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ];
    const baseline = computeLateralBaselineM(origins, { x: 0, y: 0, z: 1 });
    expect(baseline).toBeCloseTo(2, 6);
  });

  test('fewer than two origins yields zero baseline', () => {
    expect(computeLateralBaselineM([], { x: 0, y: 0, z: 1 })).toBe(0);
    expect(
      computeLateralBaselineM([{ x: 1, y: 2, z: 3 }], { x: 0, y: 0, z: 1 })
    ).toBe(0);
  });

  test('degenerate (zero-length) mean direction yields zero baseline', () => {
    const origins = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    expect(computeLateralBaselineM(origins, { x: 0, y: 0, z: 0 })).toBe(0);
  });

  test('runtime scales roughly linearly (O(n)) with observation count', () => {
    const makeOrigins = (n: number) =>
      Array.from({ length: n }, (_, idx) => ({
        x: Math.sin(idx) * 3,
        y: Math.cos(idx) * 3,
        z: idx * 0.01,
      }));
    const direction = { x: 0, y: 0, z: 1 };

    const small = makeOrigins(1000);
    const large = makeOrigins(10_000);

    const start1 = performance.now();
    computeLateralBaselineM(small, direction);
    const smallDuration = performance.now() - start1;

    const start2 = performance.now();
    computeLateralBaselineM(large, direction);
    const largeDuration = performance.now() - start2;

    // 10x the input should not cost anywhere near a quadratic (100x) blowup.
    expect(largeDuration).toBeLessThan(smallDuration * 50 + 50);
  });
});

// ---------------------------------------------------------------------------
// updateLateralBaselineCache
// ---------------------------------------------------------------------------

describe('updateLateralBaselineCache', () => {
  const direction = { x: 0, y: 0, z: 1 };

  test('invalidates the cache on retargetDraft', () => {
    const cache = { minU: 0, maxU: 1, minV: 0, maxV: 1 };
    const result = updateLateralBaselineCache(
      cache,
      { type: 'retargetDraft' },
      direction
    );
    expect(result).toBeNull();
  });

  test('invalidates the cache on cancelDraft', () => {
    const cache = { minU: 0, maxU: 1, minV: 0, maxV: 1 };
    const result = updateLateralBaselineCache(
      cache,
      { type: 'cancelDraft' },
      direction
    );
    expect(result).toBeNull();
  });

  test('passes the cache through unchanged for unrelated events', () => {
    const cache = { minU: 0, maxU: 1, minV: 0, maxV: 1 };
    const result = updateLateralBaselineCache(
      cache,
      { type: 'observationAdded' },
      direction
    );
    expect(result).toBe(cache);
  });
});

// ---------------------------------------------------------------------------
// Threshold governance + replay binding
// ---------------------------------------------------------------------------

describe('threshold governance', () => {
  test('invalid threshold config fails fast rather than silently falling back', () => {
    const invalid: QualityThresholds = {
      ...BASE_THRESHOLDS,
      minInliers: -1,
    };
    expect(() =>
      evaluateMeasurementQuality(makeInputs(), invalid, false)
    ).toThrow();
  });

  test('replay uses the exact policy bound at capture time, independent of "current" defaults', () => {
    const capturedProfile: QualityThresholds = {
      ...BASE_THRESHOLDS,
      thresholdProfileId: 'field-test-v3',
      thresholdVersion: 3,
      readyEnterScore: 0.5, // lenient profile active at capture time
      readyExitScore: 0.3,
    };
    const currentDefaultProfile: QualityThresholds = {
      ...BASE_THRESHOLDS,
      thresholdProfileId: 'default-v9',
      thresholdVersion: 9,
      readyEnterScore: 0.9, // much stricter "current" default
      readyExitScore: 0.8,
    };

    const withCapturedProfile = evaluateMeasurementQuality(
      MID_QUALITY_INPUTS,
      capturedProfile,
      false
    );
    const withCurrentDefaults = evaluateMeasurementQuality(
      MID_QUALITY_INPUTS,
      currentDefaultProfile,
      false
    );

    expect(withCapturedProfile.ready).toBe(true);
    expect(withCurrentDefaults.ready).toBe(false);

    const draft = reduceLiveMeasurementDraft(
      makeIdleDraft(capturedProfile),
      MID_QUALITY_INPUTS,
      capturedProfile
    );
    expect(draft.thresholdProfileId).toBe('field-test-v3');
    expect(draft.thresholdVersion).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Performance and replay budget
// ---------------------------------------------------------------------------

describe('performance and replay budget', () => {
  test('p95 reducer update time stays within a generous CI-safe budget', () => {
    const durations: number[] = [];
    let draft = makeIdleDraft();
    const samples = [
      HIGH_QUALITY_INPUTS,
      MID_QUALITY_INPUTS,
      LOW_QUALITY_INPUTS,
    ];

    for (let idx = 0; idx < 1000; idx++) {
      const inputs = samples[idx % samples.length];
      const start = performance.now();
      draft = reduceLiveMeasurementDraft(draft, inputs, BASE_THRESHOLDS);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)];
    // Spec budget is 2ms on target hardware; CI machines vary, so allow
    // a generous margin to avoid environment-driven flakiness.
    expect(p95).toBeLessThan(10);
  });

  test('long-sequence synthetic test (>=500 observations) remains within budget', () => {
    let draft = makeIdleDraft();
    const start = performance.now();
    for (let idx = 0; idx < 500; idx++) {
      const inputs = idx % 2 === 0 ? HIGH_QUALITY_INPUTS : MID_QUALITY_INPUTS;
      draft = reduceLiveMeasurementDraft(draft, inputs, BASE_THRESHOLDS);
    }
    const totalDuration = performance.now() - start;
    expect(totalDuration).toBeLessThan(500);
    expect(draft.status).toBe('ready');
  });

  test('accelerated replay preserves deterministic prompt/readiness transitions', () => {
    const sequence: QualityInputs[] = [
      makeInputs({ baselineM: 0.3, uncertainty: 0.19, inlierCount: 1 }),
      makeInputs({ baselineM: 1.0, uncertainty: 0.15, inlierCount: 2 }),
      makeInputs({ baselineM: 2.5, uncertainty: 0.09, inlierCount: 2 }),
      makeInputs({ baselineM: 5.0, uncertainty: 0.03, inlierCount: 3 }),
    ];

    const runSequence = (): LiveMeasurementDraft[] => {
      let draft = makeIdleDraft();
      const history: LiveMeasurementDraft[] = [];
      for (const inputs of sequence) {
        draft = reduceLiveMeasurementDraft(draft, inputs, BASE_THRESHOLDS);
        history.push(draft);
      }
      return history;
    };

    // "Accelerated" replay has no wall-clock dependency in this pure module,
    // so running the same input sequence twice (simulating live vs. 4x
    // replay) must produce byte-for-byte identical transition histories.
    const liveRun = runSequence();
    const acceleratedRun = runSequence();

    expect(acceleratedRun).toEqual(liveRun);
    expect(liveRun.map((d) => d.prompt)).toEqual(
      acceleratedRun.map((d) => d.prompt)
    );
  });
});
