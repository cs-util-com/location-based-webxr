/**
 * Which alignment a QR code is minted through: the FIRST MATURE alignment
 * at or after the code's last sighting (owner decision D28, revised
 * 2026-10-02; candidate a3 of the start-at-code measurement, its floor 40 m
 * since D34).
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

import {
  MATURE_GPS_EXTENT_M,
  advanceMatureAlignmentPick,
  checkMatureGpsExtentM,
  isUsableAlignment,
  openMatureAlignmentPick,
  type MatureAlignmentPick,
} from '../../state/alignment-maturity.js';
import type { QrMintAlignmentNow } from './qr-anchor-mint.js';

/**
 * GPS extent (m) at which an alignment counts as MATURE for the mint: the
 * shared floor {@link MATURE_GPS_EXTENT_M} (`state/alignment-maturity.ts`,
 * whose doc holds the measurement), under the name the mint exports.
 */
export const QR_MINT_MATURE_GPS_EXTENT_M = MATURE_GPS_EXTENT_M;

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

/** A code's pick (`state/alignment-maturity.ts`), and whether its
 *  segment closed under it (frozen, mature or not). */
interface CodeState {
  pick: MatureAlignmentPick<QrMintAlignmentNow>;
  closed: boolean;
}

export function createQrMintAlignmentTracker(
  options: QrMintAlignmentTrackerOptions = {}
): QrMintAlignmentTracker {
  const floorM = checkMatureGpsExtentM(options.matureGpsExtentM);
  const codes = new Map<string, CodeState>();

  return {
    noteSighting(text, now) {
      codes.set(text, {
        pick: openMatureAlignmentPick(now, floorM),
        closed: false,
      });
    },

    noteAlignment(now) {
      for (const state of codes.values()) {
        if (state.closed || state.pick.alignment.segment !== now.segment)
          continue;
        state.pick = advanceMatureAlignmentPick(state.pick, now, floorM);
      }
    },

    closeSegment(closing) {
      for (const state of codes.values()) {
        if (
          state.closed ||
          state.pick.mature ||
          state.pick.alignment.segment !== closing.segment
        )
          continue;
        if (isUsableAlignment(closing)) {
          state.pick = openMatureAlignmentPick(closing, floorM);
        }
        state.closed = true;
      }
    },

    alignmentFor(text, live) {
      const state = codes.get(text);
      if (state === undefined) return live;
      const frozen = state.closed || state.pick.mature;
      if (!frozen && state.pick.alignment.segment === live.segment) {
        return live;
      }
      return state.pick.alignment;
    },

    reset() {
      codes.clear();
    },
  };
}
