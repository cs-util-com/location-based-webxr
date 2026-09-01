/**
 * The recorder's QR readout — the line that tells the person holding the
 * phone whether the code is being seen, how many times it has been visited,
 * and how big the app thinks it is.
 *
 * WHY THIS EXISTS. Until now the recorder showed NOTHING for QR: the
 * detection producer was built without a status callback and there is not one
 * QR string in the HUD, so the only feedback was a 3D cube that appears once
 * a size has converged. A field session where nothing was captured looked
 * exactly like one where everything was — the author found out at analysis
 * time. The size readout is also what the owner checks a tape measure
 * against (plan DEC-5).
 *
 * Plain language on purpose: this is read while standing at a wall, not at a
 * desk.
 */

import { maxPairwiseRotationDeg } from 'gps-plus-slam-app-framework/ar/qr/qr-anchor-mint';
import type { QrSightingAccumulator } from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import type { QrLevelLookupState } from './qr-level-source';

/** How the code identity is shortened for a one-line readout. */
const ID_PREVIEW_CHARS = 6;

export interface QrStatusInput {
  /** Is QR detection switched on at all? */
  enabled: boolean;
  /** The code most recently detected, or null if none yet this session. */
  latestText: string | null;
  /** The short identity of that code (`qrCodeId`), when it is known. */
  latestId?: string | null;
  accumulator: QrSightingAccumulator;
  /** What the level lookup did for this code, when the session is using
   *  levels. Absent means the session is not looking any up. */
  levelState?: QrLevelLookupState;
}

/**
 * One line for the HUD, or `null` when QR is off (no row at all, rather than
 * a row saying nothing).
 */
export function qrStatusLine(input: QrStatusInput): string | null {
  if (!input.enabled) return null;
  if (input.latestText === null) {
    return 'QR: scanning — no code seen yet.';
  }

  const label =
    input.latestId != null && input.latestId !== ''
      ? input.latestId.slice(0, ID_PREVIEW_CHARS)
      : 'code';
  // Counted from the accumulator's own view, INCLUDING a visit in progress
  // — not `closed.length + 1`, which assumed one is always open and was one
  // too high after every crash-safety sync and after every mint. This is the
  // number an author uses to decide whether they have walked enough loops.
  const visits = input.accumulator.sightingsIncludingOpen(input.latestText);
  const parts = [`QR ${label}: visit ${String(visits.length)}`];

  const last = visits.at(-1);
  if (last !== undefined) {
    const spreadCm = last.sizeSpreadM * 100;
    parts.push(
      `size ~${(last.sizeM * 100).toFixed(1)} cm ±${spreadCm.toFixed(1)}`
    );
  }
  if (visits.length > 1) {
    // The CROSS-sighting spread — the statistic the fixedness gate uses.
    // The last burst's own `rotationSpreadDeg` is the inlier-based number
    // that would hide a re-hung poster, which is exactly what must not be
    // shown next to the word "turn".
    const turn = maxPairwiseRotationDeg(visits.map((v) => v.odomPose.rotation));
    parts.push(`turned ${turn.toFixed(1)}° between visits`);
  }
  const level = describeLevelState(input.levelState);
  if (level !== null) parts.push(level);
  if (input.accumulator.spansFrameChange(input.latestText)) {
    parts.push('tracking restarted — earlier visits cannot be compared');
  }
  return `${parts.join(' · ')}.`;
}

/**
 * What the level lookup did, in words an author can act on.
 *
 * A session using levels and finding none for a code would otherwise be
 * completely silent about it — the same "looked like it worked" failure the
 * QR row exists to end.
 */
function describeLevelState(
  state: QrLevelLookupState | undefined
): string | null {
  if (state === undefined) return null;
  switch (state.kind) {
    case 'level':
      return 'using its saved position';
    case 'absent':
      return 'no saved position in that file yet';
    case 'not-ours':
      return 'not one of your codes';
    case 'failed':
      return 'could not reach it — will retry';
  }
}
