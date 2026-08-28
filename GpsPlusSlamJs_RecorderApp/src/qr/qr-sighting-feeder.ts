/**
 * Feeds the recorder's derived QR placements into the session's sighting
 * accumulator, together with the alignment as it stood at that moment.
 *
 * WHY THE ALIGNMENT IS READ HERE AND NOT RECORDED. The mint uses each
 * sighting's CONTEMPORANEOUS alignment (plan DEC-3), and the store keeps only
 * the current one — no history. Snapshotting it per sighting is therefore
 * necessary. It must NOT be dispatched or persisted, though: the recorder
 * records RAW observations so a future algorithm can be re-tested against old
 * recordings (decision D-A), and an alignment matrix is a DERIVED value.
 * Replaying the recording re-solves the same alignment at the same point, so
 * nothing is lost by keeping this in memory only.
 *
 * @see gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator — the fold.
 * @see qr-debug-controller.ts — where the derived placements come from.
 */

import {
  createQrSightingAccumulator,
  type QrSightingAccumulator,
} from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import type { DerivedQrPlacement } from 'gps-plus-slam-app-framework/ar/qr/qr-derived-pose';
import type { LatLong, Matrix4 } from 'gps-plus-slam-app-framework/core';

/** What the feeder needs to know about the session's alignment right now.
 *  Deliberately NOT exported: callers are structurally typed through
 *  `QrSightingFeederDeps['readAlignment']`, and a named export nothing
 *  imports is what knip flags. */
interface QrSightingAlignmentSnapshot {
  alignmentMatrix: Matrix4 | null;
  zero: LatLong | null;
  alignmentSampleCount: number;
  gpsAccuracyM?: number;
}

export interface QrSightingFeederDeps {
  /** Read the alignment as it stands at THIS moment. */
  readAlignment: () => QrSightingAlignmentSnapshot;
  /** Injectable for tests. */
  accumulator?: QrSightingAccumulator;
}

export interface QrSightingFeeder {
  /** Wire this into the debug controller's `onPlacement`. */
  onPlacement(
    text: string,
    placement: DerivedQrPlacement,
    timestampMs: number
  ): void;
  /** The odometry frame changed — sightings either side are not comparable. */
  noteFrameChange(): void;
  /** The accumulator, for the mint and the status line. */
  readonly accumulator: QrSightingAccumulator;
}

export function createQrSightingFeeder(
  deps: QrSightingFeederDeps
): QrSightingFeeder {
  const accumulator = deps.accumulator ?? createQrSightingAccumulator();
  return {
    accumulator,
    onPlacement(text, placement, timestampMs) {
      const alignment = deps.readAlignment();
      accumulator.observe({
        text,
        timestamp: timestampMs,
        odomPose: placement.pose,
        sizeM: placement.sizeM,
        alignmentMatrix: alignment.alignmentMatrix,
        zero: alignment.zero,
        alignmentSampleCount: alignment.alignmentSampleCount,
        ...(alignment.gpsAccuracyM !== undefined
          ? { gpsAccuracyM: alignment.gpsAccuracyM }
          : {}),
      });
    },
    noteFrameChange() {
      accumulator.noteFrameChange();
    },
  };
}
