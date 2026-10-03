/**
 * Which alignment a QR code is minted through: the FIRST MATURE alignment
 * at or after the code's last sighting (owner decision D28, revised
 * 2026-10-02; candidate a3 at 80 m of the start-at-code measurement).
 *
 * WHY NOT THE ALIGNMENT AT SAVE. Placing every code through the alignment
 * as it stands when the recording is saved (a2, shipped for one day) fixed
 * the code scanned as a recording starts (72 degrees heading p50 through
 * its own immature snapshot, 1.0-4.9 through a matured one), but a code
 * seen mid-recording and then walked away from inherits all SLAM drift
 * after its sighting: 8.6 m p50 at 500 m away with 1 % and 1 degree per
 * 100 m, against 1.7 m through its own snapshot. Stopping at the first
 * alignment that has matured keeps both: 1.1-1.7 m for the code left
 * behind, and the start-at-code fix (a short walk never reaches the floor,
 * so it falls back to the alignment at save, which IS the a2 fix).
 *
 * WHY THE STORE CANNOT ANSWER IT. The store keeps only the current
 * alignment, no history, so the snapshot has to be taken while the
 * alignment evolves. The caller reports each sighting and each alignment
 * change; nothing here is dispatched or persisted (decision D-A: a replay
 * re-solves the same alignments at the same points).
 *
 * SEE `qr-anchor-mint.start-at-code.test.ts` (all measurements) and
 * `GpsPlusSlamJs_AppFramework/docs/2026-10-02-1552-qr-mint-yaw-observability-floor-followup.md`.
 */

import type { QrMintAlignmentNow } from './qr-anchor-mint.js';

/**
 * GPS extent (m) at which an alignment counts as MATURE for the mint.
 *
 * Measured (`qr-anchor-mint.start-at-code.test.ts`, `start` and `left`;
 * 5 m GPS accuracy, Gauss-Markov wander 0.25 x accuracy over 60 s plus
 * white 0.15 x accuracy; SLAM drift 0.5-2 % and 0.5-2 degrees per 100 m):
 * - 10-20 m is already met at a mid-recording sighting, so it is the
 *   sighting's own snapshot, and for a start-only code it is WORSE than the
 *   alignment at save (up to 8 degrees p50, 15-24 p90): the reversing value.
 * - 40 m keeps a code left behind at 1.1-1.7 m and within 0.3 degrees p50
 *   of the alignment at save for a start-only code; its p90 heading is 5-6
 *   degrees at 2 % translation drift.
 * - 80 m (chosen by the owner) gives the same positions and a p90 heading
 *   of 3-4 degrees there.
 * A lower GPS accuracy figure shrinks the noise share of the extent, so
 * the floor would mean a longer real walk at 2-3 m accuracy.
 */
export const QR_MINT_MATURE_GPS_EXTENT_M = 80;

export interface QrMintAlignmentTrackerOptions {
  /** See {@link QR_MINT_MATURE_GPS_EXTENT_M}. Positive and finite. */
  matureGpsExtentM?: number;
}

export interface QrMintAlignmentTracker {
  /** A detection of `text` NOW, with the alignment as it stands now.
   *  (Re)opens the code: its snapshot follows the alignment from here. */
  noteSighting(text: string, now: QrMintAlignmentNow): void;
  /** The alignment changed. Every open code of `now.segment` moves to it;
   *  a mature one freezes there. */
  noteAlignment(now: QrMintAlignmentNow): void;
  /** The odometry segment `closing.segment` ends with this alignment (a
   *  tracking restart or a loop closure). Its open codes freeze at it: a
   *  later alignment describes another frame. */
  closeSegment(closing: QrMintAlignmentNow): void;
  /**
   * The alignment to mint `text` through: its frozen snapshot, or, while it
   * is still open in `live.segment`, `live` (the alignment at save - the
   * fallback before maturity). A code never reported gets `live`.
   */
  alignmentFor(text: string, live: QrMintAlignmentNow): QrMintAlignmentNow;
  /** Forget every code (the sightings were discarded). */
  reset(): void;
}

interface CodeState {
  alignment: QrMintAlignmentNow;
  frozen: boolean;
}

/** An alignment a code can actually be placed through. */
const usable = (a: QrMintAlignmentNow): boolean =>
  a.alignmentMatrix !== null && a.zero !== null;

export function createQrMintAlignmentTracker(
  options: QrMintAlignmentTrackerOptions = {}
): QrMintAlignmentTracker {
  const floorM = options.matureGpsExtentM ?? QR_MINT_MATURE_GPS_EXTENT_M;
  if (!Number.isFinite(floorM) || floorM <= 0) {
    throw new RangeError(
      `matureGpsExtentM must be a positive, finite number of metres; got ${String(floorM)}`
    );
  }
  const codes = new Map<string, CodeState>();

  // An unknown or non-finite extent is never mature: the floor is the only
  // evidence that the yaw is observable, and NaN would compare false anyway.
  const mature = (a: QrMintAlignmentNow): boolean =>
    usable(a) &&
    a.gpsExtentM !== undefined &&
    Number.isFinite(a.gpsExtentM) &&
    a.gpsExtentM >= floorM;

  return {
    noteSighting(text, now) {
      codes.set(text, { alignment: now, frozen: mature(now) });
    },

    noteAlignment(now) {
      if (!usable(now)) return;
      for (const state of codes.values()) {
        if (state.frozen || state.alignment.segment !== now.segment) continue;
        state.alignment = now;
        state.frozen = mature(now);
      }
    },

    closeSegment(closing) {
      for (const state of codes.values()) {
        if (state.frozen || state.alignment.segment !== closing.segment)
          continue;
        if (usable(closing)) state.alignment = closing;
        state.frozen = true;
      }
    },

    alignmentFor(text, live) {
      const state = codes.get(text);
      if (state === undefined) return live;
      if (!state.frozen && state.alignment.segment === live.segment) {
        return live;
      }
      return state.alignment;
    },

    reset() {
      codes.clear();
    },
  };
}
