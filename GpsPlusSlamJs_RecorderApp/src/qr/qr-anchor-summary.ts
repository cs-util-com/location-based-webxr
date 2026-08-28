/**
 * What the session summary says about each printed code the recording saw.
 *
 * WHY THIS EXISTS AS ITS OWN THING. In the zip, a code that was declined and a
 * code that was never seen look identical: no file. So the refusal has to be
 * said out loud on the screen the author actually reads after a walk —
 * otherwise the only feedback for "your poster moved" is silence, and the
 * author uploads a zip that cannot relocalize anything.
 *
 * Plain language, and the numbers an author can act on: how many visits, how
 * far the code turned between them, and the size to check against a tape
 * measure.
 */

import type { QrAnchorOutcome } from './qr-level-zip-contributor';

/** Metres of disagreement between the weighted and unweighted answer, above
 *  which it is worth mentioning that the two differ. */
const NOTEWORTHY_DISAGREEMENT_M = 0.5;

/** Rough metres per degree of latitude/longitude at mid-latitudes — only ever
 *  used to decide whether a difference is worth a sentence. */
const METRES_PER_DEGREE = 111_000;

/**
 * One line per code, or `null` when the recording saw none — in which case the
 * block is hidden rather than shown saying nothing.
 */
export function qrAnchorSummaryLines(
  outcomes: readonly QrAnchorOutcome[]
): string | null {
  if (outcomes.length === 0) return null;
  return outcomes.map(describeOutcome).join('\n');
}

function describeOutcome(outcome: QrAnchorOutcome): string {
  const visits = `${String(outcome.sightingCount)} visit${outcome.sightingCount === 1 ? '' : 's'}`;
  if (!outcome.written) {
    return `✗ ${label(outcome)} — ${visits}. ${outcome.detail}`;
  }
  const parts = [`✓ ${label(outcome)} — placed from ${visits}`];
  if (outcome.sizeM !== undefined) {
    parts.push(`size ~${(outcome.sizeM * 100).toFixed(1)} cm`);
  }
  if (outcome.rotationSpreadDeg !== undefined) {
    parts.push(`turned ${outcome.rotationSpreadDeg.toFixed(1)}° between visits`);
  }
  const drift = weightingDifferenceM(outcome);
  if (drift !== null && drift > NOTEWORTHY_DISAGREEMENT_M) {
    // The recency half-life is a guess until the field probe measures it.
    // Saying when it MOVED the answer is what makes that guess checkable on
    // the phone instead of on trust.
    parts.push(
      `newest-visit weighting moved it ${drift.toFixed(1)} m`
    );
  }
  return `${parts.join(' · ')}.`;
}

function label(outcome: QrAnchorOutcome): string {
  return outcome.id === '' ? 'Foreign code' : `Code ${outcome.id.slice(0, 6)}`;
}

/** How far apart the weighted and unweighted answers landed, in metres. */
function weightingDifferenceM(outcome: QrAnchorOutcome): number | null {
  const { lat, lon, unweightedLat, unweightedLon } = outcome;
  if (
    lat === undefined ||
    lon === undefined ||
    unweightedLat === undefined ||
    unweightedLon === undefined
  ) {
    return null;
  }
  const dLat = (lat - unweightedLat) * METRES_PER_DEGREE;
  const dLon =
    (lon - unweightedLon) * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}
