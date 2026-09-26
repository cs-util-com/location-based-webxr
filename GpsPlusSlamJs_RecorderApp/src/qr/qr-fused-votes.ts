/**
 * The recorder's level-mode votes on the FUSED QR pose (QR near-frontal pose
 * plan §71-§72, b6a): a code votes only once the joint rotation over its
 * recent detections is stable, at that rotation, instead of at each lock's
 * single-frame solve. See qr-fused-votes.ts.md.
 */

import { createFusedQrPoseSource } from 'gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source';
import type { QrFusedPose } from 'gps-plus-slam-app-framework/ar/qr/qr-fused-pose';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  selectQrFusedEntries,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state/qr-detected-slice';

export interface QrFusedVotesDeps {
  /** The CURRENT store's QR slice (it swaps at Start Recording). */
  getQrState: () => { qrDetected: QrDetectedState };
  /** Whether the code's vote budget is spent: then nothing is evaluated. */
  isSpent: (text: string) => boolean;
  /** Each NEW evaluation, for tests and a future readout. */
  onEvaluated?: (result: QrFusedPose, text: string) => void;
}

export interface QrFusedVotes {
  /** A level resolved: remember its printed size for the AR session. */
  noteLevelSize(text: string, sizeM: number | undefined): void;
  /** A raw detection of `text` was recorded: evaluate it (per detection). */
  onRecorded(text: string): void;
  /** The stable fused pose for the lock's votes, or null. */
  resolveStablePose(text: string): Pose | null;
  /** The store swapped: new trackers over the new store (sizes kept). */
  resetForStore(): void;
}

export function createQrFusedVotes(deps: QrFusedVotesDeps): QrFusedVotes {
  // Wire scope, never cleared on a swap: the tracking controller fetches a
  // code's level once per AR session (often before Start Recording) and
  // caches it, so no second fetch would refill a per-store map (plan §72
  // #1). A tracker created without the size would run at the 0.16 m default
  // for the store's lifetime - a wrong size moves a still code with the
  // camera and reads as motion.
  const sizes = new Map<string, number>();
  const newSource = () =>
    createFusedQrPoseSource({
      entriesOf: (text) => selectQrFusedEntries(deps.getQrState(), text),
      // Only reached through `ready`, so the size is always there.
      optionsFor: (text) => ({ sizeM: sizes.get(text) ?? Number.NaN }),
      onEvaluated: (result, _ms, text) => deps.onEvaluated?.(result, text),
    });
  let source = newSource();
  // Fail closed: no size, no evaluation, no tracker. A spent budget skips
  // the solve (the TourViewer's short-circuit, plan §61 #6).
  const ready = (text: string): boolean =>
    sizes.has(text) && !deps.isSpent(text);

  return {
    noteLevelSize(text, sizeM) {
      if (sizeM !== undefined && Number.isFinite(sizeM) && sizeM > 0) {
        sizes.set(text, sizeM);
      }
    },
    onRecorded(text) {
      if (ready(text)) source.evaluate(text);
    },
    resolveStablePose(text) {
      return ready(text) ? source.resolve(text) : null;
    },
    resetForStore() {
      source = newSource();
    },
  };
}
