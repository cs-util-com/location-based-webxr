/**
 * Onboarding-guidance seam — turns a {@link TrackingQualityReport} into a
 * compact, user-facing "what should I do next?" instruction for first-time
 * AR+GPS users.
 *
 * The recorder HUD ({@link https} `updateTrackingQuality` in the recorder's `hud.ts`) is an
 * expert diagnostics panel; this seam is its onboarding-flavoured sibling
 * that coaches a user to *move around until alignment is good enough*.
 *
 * Pure-function discipline — `computeOnboardingGuidance` is a pure function
 * over a `TrackingQualityReport | null`. It does not read the Redux store,
 * so it is trivially testable on crafted reports and composes directly with
 * the nullable output of {@link selectTrackingQuality}. A thin store-bound
 * `selectOnboardingGuidance(state)` wrapper is provided for convenience.
 */

import { clamp01 } from '../utils/clamp01.js';
import type { CombinedRootState } from './combined-root-state.js';
import {
  selectTrackingQuality,
  type TrackingQualityReport,
} from './tracking-quality.js';

/**
 * Coaching phase derived from the tracking-quality `state`. Ordered from
 * "no signal yet" to "ready to place an anchor". The order matters: it is
 * the basis for the monotonic {@link OnboardingGuidance.percentReady}.
 */
export type OnboardingPhase =
  | 'initializing'
  | 'ar-lost'
  | 'move-around'
  | 'almost-ready'
  | 'ready';

export interface OnboardingGuidance {
  /** Coaching phase — maps 1:1 onto the tracking-quality state (+ null). */
  phase: OnboardingPhase;
  /**
   * 0..1 readiness for placing an anchor. Monotonic across phases
   * (`initializing` = `ar-lost` ≤ `move-around` ≤ `almost-ready` ≤ `ready`)
   * and, within `move-around`, monotonic in `subScores.coverage`; within
   * `almost-ready`, monotonic in `confidence`.
   */
  percentReady: number;
  /** Short, user-facing coaching line. */
  hint: string;
}

/**
 * Per-phase `percentReady` bands. Chosen so the value is strictly ordered
 * across phases while still tracking the relevant sub-signal *within* a
 * phase (coverage during warm-up, confidence while degraded). `ready` is
 * the only phase that reaches 1.0; warm-up never crosses into the degraded
 * band, so the meter visibly communicates "not placeable yet".
 */
const WARMING_BAND_TOP = 0.6;
const DEGRADED_BAND_BOTTOM = 0.6;
const DEGRADED_BAND_SPAN = 0.3; // → 0.6..0.9

const HINTS: Record<OnboardingPhase, string> = {
  initializing:
    'Starting up — point your device at the ground and hold steady.',
  'ar-lost': 'Tracking lost — slowly look around to let it recover.',
  'move-around': 'Walk around a few steps so tracking can warm up.',
  'almost-ready': 'Almost there — keep moving to sharpen the alignment.',
  ready: 'Tracking is ready — you can place your anchor now.',
};

/**
 * Map a tracking-quality report (or `null` when none has been produced yet)
 * to a single onboarding instruction. Never throws; a `null` or malformed
 * report degrades to the `initializing` phase.
 */
export function computeOnboardingGuidance(
  report: TrackingQualityReport | null
): OnboardingGuidance {
  if (report === null) {
    return { phase: 'initializing', percentReady: 0, hint: HINTS.initializing };
  }

  switch (report.state) {
    case 'ar-lost':
      return { phase: 'ar-lost', percentReady: 0, hint: HINTS['ar-lost'] };
    case 'warming-up': {
      const coverage = clamp01(report.subScores.coverage);
      return {
        phase: 'move-around',
        percentReady: coverage * WARMING_BAND_TOP,
        hint: HINTS['move-around'],
      };
    }
    case 'degraded': {
      const confidence = clamp01(report.confidence);
      return {
        phase: 'almost-ready',
        percentReady: DEGRADED_BAND_BOTTOM + confidence * DEGRADED_BAND_SPAN,
        hint: HINTS['almost-ready'],
      };
    }
    case 'ok':
      return { phase: 'ready', percentReady: 1, hint: HINTS.ready };
    default: {
      // Exhaustiveness guard — a new TrackingQualityState must be handled
      // explicitly rather than silently falling through to "ready".
      const _exhaustive: never = report.state;
      void _exhaustive;
      return {
        phase: 'initializing',
        percentReady: 0,
        hint: HINTS.initializing,
      };
    }
  }
}

/**
 * Store-bound convenience wrapper: read the current tracking-quality report
 * and map it to onboarding guidance. Returns the `initializing` guidance
 * when no report exists yet.
 */
export function selectOnboardingGuidance(
  state: CombinedRootState
): OnboardingGuidance {
  return computeOnboardingGuidance(selectTrackingQuality(state));
}
