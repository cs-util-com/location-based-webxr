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

import type { QrSightingAccumulator } from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';

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
  const closed = input.accumulator.sightings(input.latestText);
  // The burst in progress is not closed yet, so it is not in the list — say
  // "1st visit" while it is happening rather than "0 visits".
  const visits = closed.length + 1;
  const parts = [`QR ${label}: visit ${String(visits)}`];

  const last = closed.at(-1);
  if (last !== undefined) {
    parts.push(`size ~${(last.sizeM * 100).toFixed(1)} cm`);
    if (closed.length > 1) {
      parts.push(`turn ${last.rotationSpreadDeg.toFixed(1)}°`);
    }
  }
  if (input.accumulator.spansFrameChange(input.latestText)) {
    parts.push('tracking restarted — earlier visits cannot be compared');
  }
  return `${parts.join(' · ')}.`;
}
