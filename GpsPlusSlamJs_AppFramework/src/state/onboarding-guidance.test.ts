/**
 * Unit tests for onboarding-guidance.ts.
 *
 * Why this test matters: `computeOnboardingGuidance` is the single reusable
 * framework seam introduced for the persistent-anchor starter example.
 * It must map *all four* tracking-quality states plus the `null`
 * "no report yet" case to a deterministic instruction, and `percentReady`
 * must be monotonic so a progress meter never moves backwards as alignment
 * improves. These tests pin that contract.
 */

import { describe, it, expect } from 'vitest';
import {
  computeOnboardingGuidance,
  selectOnboardingGuidance,
  type OnboardingGuidance,
} from './onboarding-guidance';
import type { CombinedRootState } from './combined-root-state';
import type {
  TrackingQualityReport,
  TrackingQualityState,
} from './tracking-quality';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but structurally-complete {@link TrackingQualityReport}.
 * Only the fields the guidance reads (`state`, `confidence`,
 * `subScores.coverage`) matter; the rest are filled with neutral values so
 * the object type-checks against the full report shape.
 */
function makeReport(overrides: {
  state: TrackingQualityState;
  confidence?: number;
  coverage?: number;
}): TrackingQualityReport {
  const { state, confidence = 0.5, coverage = 0.5 } = overrides;
  return {
    state,
    confidence,
    subScores: {
      convergence: 0.5,
      residualConsensus: 0.5,
      gpsAccuracy: 0.5,
      coverage,
    },
    diagnostics: {
      recentSumRotationDeltaDeg: 0,
      recentSumTranslationDeltaM: 0,
      medianResidualM: 0,
      medianRecentGpsAccuracyM: 0,
      walkedDistanceM: 0,
      directionSpreadDeg: 0,
      observationsSeen: 0,
      gpsVsFusedMaxDivergenceM: 0,
    },
  };
}

describe('computeOnboardingGuidance', () => {
  it('maps a null report to the initializing phase (no throw)', () => {
    const g = computeOnboardingGuidance(null);
    expect(g.phase).toBe('initializing');
    expect(g.percentReady).toBe(0);
    expect(g.hint.length).toBeGreaterThan(0);
  });

  it('maps ar-lost to the ar-lost phase at 0% ready', () => {
    const g = computeOnboardingGuidance(makeReport({ state: 'ar-lost' }));
    expect(g.phase).toBe('ar-lost');
    expect(g.percentReady).toBe(0);
  });

  it('maps warming-up to move-around, scaled by coverage', () => {
    const g = computeOnboardingGuidance(
      makeReport({ state: 'warming-up', coverage: 0.5 })
    );
    expect(g.phase).toBe('move-around');
    // coverage 0.5 → 0.5 * 0.6 band top = 0.3
    expect(g.percentReady).toBeCloseTo(0.3, 5);
    // warm-up never reaches the "placeable" band.
    expect(g.percentReady).toBeLessThan(0.6);
  });

  it('maps degraded to almost-ready, scaled by confidence', () => {
    const g = computeOnboardingGuidance(
      makeReport({ state: 'degraded', confidence: 0.5 })
    );
    expect(g.phase).toBe('almost-ready');
    // 0.6 + 0.5 * 0.3 = 0.75
    expect(g.percentReady).toBeCloseTo(0.75, 5);
  });

  it('maps ok to ready at 100%', () => {
    const g = computeOnboardingGuidance(makeReport({ state: 'ok' }));
    expect(g.phase).toBe('ready');
    expect(g.percentReady).toBe(1);
  });

  it('keeps every phase ordered: initializing/ar-lost ≤ move-around ≤ almost-ready ≤ ready', () => {
    const initializing = computeOnboardingGuidance(null).percentReady;
    const arLost = computeOnboardingGuidance(
      makeReport({ state: 'ar-lost' })
    ).percentReady;
    const warming = computeOnboardingGuidance(
      makeReport({ state: 'warming-up', coverage: 1 })
    ).percentReady;
    const degraded = computeOnboardingGuidance(
      makeReport({ state: 'degraded', confidence: 0 })
    ).percentReady;
    const ready = computeOnboardingGuidance(
      makeReport({ state: 'ok' })
    ).percentReady;

    // Best-case warm-up must still rank below worst-case degraded so the
    // meter never regresses when the state advances.
    expect(initializing).toBe(0);
    expect(arLost).toBe(0);
    expect(warming).toBeLessThanOrEqual(degraded);
    expect(degraded).toBeLessThanOrEqual(ready);
  });

  it('clamps out-of-range coverage/confidence into [0,1]', () => {
    const over = computeOnboardingGuidance(
      makeReport({ state: 'warming-up', coverage: 5 })
    );
    expect(over.percentReady).toBeLessThanOrEqual(0.6);
    const under = computeOnboardingGuidance(
      makeReport({ state: 'degraded', confidence: -3 })
    );
    expect(under.percentReady).toBeGreaterThanOrEqual(0.6);
  });

  it('uses distinct, non-empty hints per phase consistent with HUD vocabulary', () => {
    const phases: OnboardingGuidance['phase'][] = [];
    const hints = new Set<string>();
    for (const g of [
      computeOnboardingGuidance(null),
      computeOnboardingGuidance(makeReport({ state: 'ar-lost' })),
      computeOnboardingGuidance(makeReport({ state: 'warming-up' })),
      computeOnboardingGuidance(makeReport({ state: 'degraded' })),
      computeOnboardingGuidance(makeReport({ state: 'ok' })),
    ]) {
      phases.push(g.phase);
      hints.add(g.hint);
    }
    expect(new Set(phases).size).toBe(5);
    expect(hints.size).toBe(5);
  });
});

describe('selectOnboardingGuidance', () => {
  it('reads the current report from the store state', () => {
    const state = {
      trackingQuality: { report: makeReport({ state: 'ok' }) },
    } as unknown as CombinedRootState;
    expect(selectOnboardingGuidance(state).phase).toBe('ready');
  });

  it('degrades to initializing when no report exists yet', () => {
    const state = {
      trackingQuality: { report: null },
    } as unknown as CombinedRootState;
    expect(selectOnboardingGuidance(state).phase).toBe('initializing');
  });
});

describe('the coaching copy', () => {
  // Why this test matters: these hints are shown verbatim by every app that
  // coaches through this seam (the Tour Viewer's coach card, the Anchor
  // Starter), and the copy uses plain hyphens, never an em dash. Pinned per
  // phase, because a hint is one table entry an edit can change alone.
  const reports: Array<[string, TrackingQualityReport | null]> = [
    ['initializing', null],
    ['ar-lost', makeReport({ state: 'ar-lost' })],
    ['move-around', makeReport({ state: 'warming-up' })],
    ['almost-ready', makeReport({ state: 'degraded' })],
    ['ready', makeReport({ state: 'ok' })],
  ];

  it.each(reports)('the %s hint carries no em dash', (_phase, report) => {
    expect(computeOnboardingGuidance(report).hint).not.toContain('—');
  });

  it('says the starting and the lost hints with a spaced hyphen', () => {
    expect(computeOnboardingGuidance(null).hint).toBe(
      'Starting up - point your device at the ground and hold steady.'
    );
    expect(
      computeOnboardingGuidance(makeReport({ state: 'ar-lost' })).hint
    ).toBe('Tracking lost - slowly look around to let it recover.');
  });
});
