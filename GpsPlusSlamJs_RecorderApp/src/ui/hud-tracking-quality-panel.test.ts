/**
 * Unit tests for the tracking-quality HUD panel.
 *
 * Moved verbatim from `hud.test.ts` when the panel was extracted
 * (simplify-loop Area 5, 2026-07-24), with one deliberate change: the
 * `initUI(...)` beforeEach call was dropped — the panel owns its own badge
 * listener wiring and reads none of `initUI`'s callbacks or cached elements,
 * so the tests now pin that independence too. Assertions are unchanged.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { TrackingQualityReport } from 'gps-plus-slam-app-framework';
import {
  updateTrackingQuality,
  hideTrackingQuality,
} from './hud-tracking-quality-panel.js';

/** The tracking-quality DOM subtree exactly as `index.html` declares it. */
function setupTrackingQualityDOM(): void {
  document.body.innerHTML = `
    <div id="tracking-quality" class="hidden">
      <div id="tracking-quality-badge"><span id="tq-state"></span> <span id="tq-confidence"></span></div>
      <div id="tracking-quality-details" class="hidden">
        <div id="tq-convergence"></div>
        <div id="tq-sum-rot"></div>
        <div id="tq-sum-pos"></div>
        <div id="tq-residual"></div>
        <div id="tq-gps-accuracy"></div>
        <div id="tq-coverage"></div>
      </div>
    </div>
  `;
}

function makeReport(
  overrides: Partial<TrackingQualityReport> = {}
): TrackingQualityReport {
  return {
    state: 'ok',
    confidence: 0.85,
    subScores: {
      convergence: 0.9,
      residualConsensus: 0.85,
      gpsAccuracy: 0.88,
      coverage: 1.0,
    },
    diagnostics: {
      recentSumRotationDeltaDeg: 1.2,
      recentSumTranslationDeltaM: 0.5,
      medianResidualM: 2.3,
      medianRecentGpsAccuracyM: 6.0,
      walkedDistanceM: 42,
      directionSpreadDeg: 120,
      observationsSeen: 25,
      gpsVsFusedMaxDivergenceM: 3.1,
    },
    ...overrides,
  };
}

describe('updateTrackingQuality', () => {
  beforeEach(() => {
    setupTrackingQualityDOM();
  });

  // Why: the indicator must become visible once tracking quality data arrives.
  it('unhides the tracking quality container', () => {
    updateTrackingQuality(makeReport());

    const container = document.getElementById('tracking-quality')!;
    expect(container.classList.contains('hidden')).toBe(false);
  });

  // Why: the state badge is the primary at-a-glance signal for the user.
  it('displays the state label', () => {
    updateTrackingQuality(makeReport({ state: 'ok' }));
    expect(document.getElementById('tq-state')!.textContent).toBe('OK');
  });

  // Why: numeric confidence gives users a sense of progression (0→1).
  it('displays confidence as a percentage', () => {
    updateTrackingQuality(makeReport({ confidence: 0.73 }));
    expect(document.getElementById('tq-confidence')!.textContent).toBe('73%');
  });

  // Why: color coding must match tracking state for instant recognition.
  it('applies green color for ok state', () => {
    updateTrackingQuality(makeReport({ state: 'ok' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-green-400');
  });

  it('applies yellow color for degraded state', () => {
    updateTrackingQuality(makeReport({ state: 'degraded' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-yellow-400');
  });

  it('applies gray color for warming-up state', () => {
    updateTrackingQuality(makeReport({ state: 'warming-up' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-gray-400');
  });

  it('applies red color for ar-lost state', () => {
    updateTrackingQuality(makeReport({ state: 'ar-lost' }));
    const badge = document.getElementById('tracking-quality-badge')!;
    expect(badge.className).toContain('text-red-400');
  });

  // Why: the badge must toggle only its state-color class, not overwrite
  // className wholesale. A wholesale overwrite would silently drop any
  // layout/padding/font classes (and the static `cursor-pointer`) declared
  // on the element in index.html. This guards against regressing to
  // `badge.className = ...`.
  it('preserves unrelated classes when updating state color', () => {
    const badge = document.getElementById('tracking-quality-badge')!;
    // Simulate classes that index.html may add now or in the future.
    badge.classList.add('cursor-pointer', 'px-2', 'font-bold');

    updateTrackingQuality(makeReport({ state: 'ok' }));

    expect(badge.classList.contains('cursor-pointer')).toBe(true);
    expect(badge.classList.contains('px-2')).toBe(true);
    expect(badge.classList.contains('font-bold')).toBe(true);
    expect(badge.classList.contains('text-green-400')).toBe(true);
  });

  // Why: switching state must remove the previous state color, otherwise
  // stale color classes accumulate and the displayed color is undefined.
  it('removes the previous state color when state changes', () => {
    const badge = document.getElementById('tracking-quality-badge')!;

    updateTrackingQuality(makeReport({ state: 'ok' }));
    expect(badge.classList.contains('text-green-400')).toBe(true);

    updateTrackingQuality(makeReport({ state: 'ar-lost' }));
    expect(badge.classList.contains('text-green-400')).toBe(false);
    expect(badge.classList.contains('text-red-400')).toBe(true);
  });

  // Why: sub-scores must be visible in the expanded detail view.
  it('populates sub-score values in detail panel', () => {
    // Why: confirms the four sub-scores that survived the 2026-05-23
    // field-test pruning (Findings 2, 3, 5) still render. heading / obs /
    // walked were intentionally removed from the HUD; they remain on the
    // report for background metrics + tests but are no longer in the
    // detail panel. (The compass sub-score was removed entirely on
    // 2026-06-28 — it was inert dead code.)
    updateTrackingQuality(
      makeReport({
        subScores: {
          convergence: 0.91,
          residualConsensus: 0.72,
          gpsAccuracy: 0.65,
          coverage: 1.0,
        },
      })
    );

    expect(document.getElementById('tq-convergence')!.textContent).toContain(
      '91%'
    );
    expect(document.getElementById('tq-residual')!.textContent).toContain(
      '72%'
    );
    expect(document.getElementById('tq-gps-accuracy')!.textContent).toContain(
      '65%'
    );
    expect(document.getElementById('tq-coverage')!.textContent).toContain(
      '100%'
    );
  });

  // Why: Findings 2 & 3 removed compass / heading / obs / walked from the
  // HUD. Guard the deletion so a careless re-add is caught.
  it('does not render compass, heading, obs, or walked elements', () => {
    updateTrackingQuality(makeReport());
    expect(document.getElementById('tq-compass')).toBeNull();
    expect(document.getElementById('tq-heading-delta')).toBeNull();
    expect(document.getElementById('tq-compass-drift')).toBeNull();
    expect(document.getElementById('tq-obs-count')).toBeNull();
    expect(document.getElementById('tq-walked')).toBeNull();
  });

  // Why: Finding 6 — the two raw alignment-motion sums sit next to
  // `Conv:` in the HUD so the user can see *how much* and *on which
  // axis* the alignment is moving when the smoothed convergence score
  // looks suspicious. The values come straight from
  // `diagnostics.recentSum…` (no rounding to %), with 2 decimal places
  // and the °/m suffixes the user expects in the field.
  it('renders ΣΔrot and ΣΔpos sums from diagnostics (Finding 6)', () => {
    updateTrackingQuality(
      makeReport({
        diagnostics: {
          recentSumRotationDeltaDeg: 3.456,
          recentSumTranslationDeltaM: 0.789,
          medianResidualM: 2.0,
          medianRecentGpsAccuracyM: 5.0,
          walkedDistanceM: 42,
          directionSpreadDeg: 120,
          observationsSeen: 25,
          gpsVsFusedMaxDivergenceM: 3.1,
        },
      })
    );
    expect(document.getElementById('tq-sum-rot')!.textContent).toContain(
      'ΣΔrot: 3.46°'
    );
    expect(document.getElementById('tq-sum-pos')!.textContent).toContain(
      'ΣΔpos: 0.79m'
    );
  });
});

describe('tracking quality badge tap to expand/collapse', () => {
  beforeEach(() => {
    setupTrackingQualityDOM();
  });

  // Why: details panel starts collapsed — users see the badge first.
  it('starts with details panel hidden', () => {
    updateTrackingQuality(makeReport());
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });

  // Why: tapping the badge toggles the detail panel open.
  it('expands details on badge click', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click();
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(false);
  });

  // Why: tapping again collapses the detail panel.
  it('collapses details on second badge click', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click(); // expand
    badge.click(); // collapse
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });
});

describe('hideTrackingQuality', () => {
  beforeEach(() => {
    setupTrackingQualityDOM();
  });

  // Why: tracking quality indicator should hide when recording ends
  // or when the session resets.
  it('hides the tracking quality container', () => {
    updateTrackingQuality(makeReport());
    hideTrackingQuality();
    const container = document.getElementById('tracking-quality')!;
    expect(container.classList.contains('hidden')).toBe(true);
  });

  // Why: re-showing after hide should reset expanded state.
  it('collapses details when hidden then re-shown', () => {
    updateTrackingQuality(makeReport());
    const badge = document.getElementById('tracking-quality-badge')!;
    badge.click(); // expand
    hideTrackingQuality();
    updateTrackingQuality(makeReport());
    const details = document.getElementById('tracking-quality-details')!;
    expect(details.classList.contains('hidden')).toBe(true);
  });
});
