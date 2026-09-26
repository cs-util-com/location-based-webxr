/**
 * The lock counts of one stream of fused QR pose results (QR near-frontal
 * pose plan §66): how many were stable, why the rest were not, and which
 * were re-reads. The QR demo's `?qrperf` report and the TourViewer's debug
 * readout count by this one rule (DEC-H3). See qr-fused-pose-tally.ts.md.
 */

import type { QrFusedPose } from './qr-fused-pose.js';

type NotStableReason = NonNullable<QrFusedPose['notStableReason']>;

export interface FusedPoseCounts {
  /** Results counted (re-reads excluded). */
  locks: number;
  /**
   * Results whose newest detection did not advance (same frame epoch, equal
   * finite `newestTimestamp`): since plan §54 an ignored native frame. They
   * count here and nowhere else.
   */
  reReads: number;
  stable: number;
  /** `unknown` results (no entries, e.g. right after a restart); also in `notStable.views`. */
  empty: number;
  /** Locks whose run had native entries left out (`nativeIgnored > 0`). */
  nativeIgnoredLocks: number;
  /** Locks per `notStableReason`; `stable + sum(notStable) = locks`. */
  notStable: Record<NotStableReason, number>;
}

export interface FusedPoseTally {
  /** Count one result; false when it was a re-read. */
  add(result: QrFusedPose): boolean;
  /** A copy of the counts so far. */
  summary(): FusedPoseCounts;
}

export function createFusedPoseTally(): FusedPoseTally {
  const counts = {
    locks: 0,
    reReads: 0,
    stable: 0,
    empty: 0,
    nativeIgnoredLocks: 0,
  };
  const notStable: Record<NotStableReason, number> = {
    views: 0,
    fit: 0,
    fallback: 0,
    motion: 0,
    order: 0,
  };
  let lastNewest: { epoch: number; timestamp: number } | null = null;

  /** Same epoch and the SAME newest detection (a clock step back is not one; plan §57 #6). */
  function isReRead(result: QrFusedPose): boolean {
    return (
      lastNewest !== null &&
      Number.isFinite(result.newestTimestamp) &&
      result.frameEpoch === lastNewest.epoch &&
      result.newestTimestamp === lastNewest.timestamp
    );
  }

  function addCounts(result: QrFusedPose): void {
    counts.locks += 1;
    if (result.status === 'stable') counts.stable += 1;
    if (result.status === 'unknown') counts.empty += 1;
    if (result.nativeIgnored > 0) counts.nativeIgnoredLocks += 1;
    if (result.notStableReason) notStable[result.notStableReason] += 1;
  }

  return {
    add(result) {
      if (isReRead(result)) {
        counts.reReads += 1;
        return false;
      }
      if (Number.isFinite(result.newestTimestamp)) {
        lastNewest = {
          epoch: result.frameEpoch,
          timestamp: result.newestTimestamp,
        };
      }
      addCounts(result);
      return true;
    },
    summary() {
      return { ...counts, notStable: { ...notStable } };
    },
  };
}
