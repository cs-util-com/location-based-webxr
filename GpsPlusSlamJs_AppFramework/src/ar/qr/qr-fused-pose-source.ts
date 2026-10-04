/**
 * The fused QR pose per code, for apps (QR near-frontal pose plan §60-§61,
 * b4b-3): one `createFusedQrPoseTracker` per decoded payload over the
 * entries the app reads for it. The QR demo, the TourViewer and (b6) the
 * recorder share it (DEC-H3). See qr-fused-pose-source.ts.md.
 *
 * Structural on purpose: the app passes `entriesOf` (in practice
 * `selectQrFusedEntries(store.getState(), text)`), so the `ar` layer never
 * imports the state slice.
 */

import type { Pose } from './qr-pose.js';
import type { QrFusedEntry } from './qr-fused-window.js';
import {
  createFusedQrPoseTracker,
  type FusedQrPoseTracker,
  type QrFusedPose,
  type QrFusedPoseOptions,
} from './qr-fused-pose.js';

export interface FusedQrPoseSourceConfig {
  /** The code's current-epoch entries, oldest first (a new array per new detection). */
  entriesOf(text: string): readonly QrFusedEntry[];
  /**
   * The code's tracker options - above all its printed `sizeM` - read once,
   * when the code is first evaluated. Default `{}`.
   */
  optionsFor?(text: string): QrFusedPoseOptions;
  /** Called once per NEW evaluation (never a cached re-read), with its cost and the code. */
  onEvaluated?(result: QrFusedPose, ms: number, text: string): void;
  /** The clock the cost is measured on. Default `performance.now`. */
  now?(): number;
}

export interface FusedQrPoseSource {
  /** Evaluate `text` now (feeds the motion detector) and return the result. */
  evaluate(text: string): QrFusedPose;
  /** The stable fused pose of `text`, or null while there is none. */
  resolve(text: string): Pose | null;
  /** The last evaluation of `text`, or null if it was never evaluated. */
  last(text: string): QrFusedPose | null;
}

export function createFusedQrPoseSource(
  config: FusedQrPoseSourceConfig
): FusedQrPoseSource {
  const now = () => (config.now ? config.now() : performance.now());
  const trackers = new Map<string, FusedQrPoseTracker>();
  const results = new Map<string, QrFusedPose>();
  const trackerFor = (text: string): FusedQrPoseTracker => {
    let tracker = trackers.get(text);
    if (!tracker) {
      tracker = createFusedQrPoseTracker(config.optionsFor?.(text) ?? {});
      trackers.set(text, tracker);
    }
    return tracker;
  };
  const evaluate = (text: string): QrFusedPose => {
    const t0 = now();
    const result = trackerFor(text).evaluate(config.entriesOf(text));
    // The tracker returns its cached result object for a re-read.
    if (result !== results.get(text))
      config.onEvaluated?.(result, now() - t0, text);
    results.set(text, result);
    return result;
  };
  return {
    evaluate,
    resolve(text) {
      const result = evaluate(text);
      return result.status === 'stable' ? result.pose : null;
    },
    last(text) {
      return results.get(text) ?? null;
    },
  };
}
