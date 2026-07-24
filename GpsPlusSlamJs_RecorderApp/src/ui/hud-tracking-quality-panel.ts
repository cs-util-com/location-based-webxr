/**
 * Tracking-quality HUD panel — the badge + expandable detail list that
 * surfaces the framework's `TrackingQualityReport` during recording.
 *
 * Extracted from the monolithic `hud.ts` (simplify-loop Area 5, 2026-07-24).
 * `hud.ts` re-exports the public pair so all HUD consumers keep one import
 * seam; this module owns every `tq-*` / `tracking-quality*` element and no
 * other HUD state (it does not use `initUI`'s callbacks or cached elements).
 */

import type {
  TrackingQualityReport,
  TrackingQualityState,
} from 'gps-plus-slam-app-framework';

const STATE_COLOR: Record<TrackingQualityState, string> = {
  ok: 'text-green-400',
  degraded: 'text-yellow-400',
  'warming-up': 'text-gray-400',
  'ar-lost': 'text-red-400',
};

const STATE_LABEL: Record<TrackingQualityState, string> = {
  ok: 'OK',
  degraded: 'DEGRADED',
  'warming-up': 'WARMING UP',
  'ar-lost': 'AR LOST',
};

let tqDetailsExpanded = false;
let tqBadgeWithListener: HTMLElement | null = null;

function pct(v: number | null): string {
  if (v === null) return 'n/a';
  return `${Math.round(v * 100)}%`;
}

export function updateTrackingQuality(report: TrackingQualityReport): void {
  const container = document.getElementById('tracking-quality');
  if (!container) return;

  container.classList.remove('hidden');

  const badge = document.getElementById('tracking-quality-badge');
  const stateEl = document.getElementById('tq-state');
  const confEl = document.getElementById('tq-confidence');
  if (badge && stateEl && confEl) {
    stateEl.textContent = STATE_LABEL[report.state];
    confEl.textContent = pct(report.confidence);
    // Selectively toggle only the state-color classes so any other classes
    // on the badge (layout, padding, font, the static `cursor-pointer`, …)
    // declared in index.html are preserved. Overwriting `className` wholesale
    // would silently drop them. Mirrors updateSinglePermissionStatus().
    badge.classList.remove(...Object.values(STATE_COLOR));
    badge.classList.add(STATE_COLOR[report.state]);
  }

  // Sub-scores (detail panel). Compass / Heading Δ / drift, Obs count, and
  // walked distance were removed in Findings 2 & 3 (2026-05-23 field test):
  // compass is unobservable on the iPhone hardware in use, and Obs/Walked
  // are diagnostic noise the user cannot act on. The fields remain on the
  // report so background metrics and tests can still consume them.
  // ΣΔrot / ΣΔpos (Finding 6) sit next to Conv so the user can debug an
  // unstable convergence reading by reading the raw accumulated motion.
  const { subScores, diagnostics } = report;
  setDetail('tq-convergence', `Conv: ${pct(subScores.convergence)}`);
  setDetail(
    'tq-sum-rot',
    `ΣΔrot: ${diagnostics.recentSumRotationDeltaDeg.toFixed(2)}°`
  );
  setDetail(
    'tq-sum-pos',
    `ΣΔpos: ${diagnostics.recentSumTranslationDeltaM.toFixed(2)}m`
  );
  setDetail('tq-residual', `Resid: ${pct(subScores.residualConsensus)}`);
  setDetail('tq-gps-accuracy', `GPS Acc: ${pct(subScores.gpsAccuracy)}`);
  setDetail('tq-coverage', `Coverage: ${pct(subScores.coverage)}`);

  // Wire toggle listener — re-attach if badge element changed (DOM rebuild)
  if (badge && badge !== tqBadgeWithListener) {
    tqDetailsExpanded = false;
    badge.addEventListener('click', toggleTrackingQualityDetails);
    tqBadgeWithListener = badge;
  }
}

export function hideTrackingQuality(): void {
  const container = document.getElementById('tracking-quality');
  if (container) container.classList.add('hidden');

  tqDetailsExpanded = false;
  const details = document.getElementById('tracking-quality-details');
  if (details) details.classList.add('hidden');
}

function toggleTrackingQualityDetails(): void {
  const details = document.getElementById('tracking-quality-details');
  if (!details) return;
  tqDetailsExpanded = !tqDetailsExpanded;
  details.classList.toggle('hidden', !tqDetailsExpanded);
}

function setDetail(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
