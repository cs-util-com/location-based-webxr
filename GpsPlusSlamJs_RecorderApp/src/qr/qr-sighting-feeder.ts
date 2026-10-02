/**
 * Feeds the recorder's derived QR placements into the session's sighting
 * accumulator, together with the alignment as it stood at that moment.
 *
 * WHY THE ALIGNMENT IS READ HERE AND NOT RECORDED. The save-time mint places
 * every sighting through the alignment as it stands then (`alignmentFor()`),
 * or, for a code seen before a tracking restart or loop closure, through the
 * alignment its odometry segment closed with (kept here at
 * `noteFrameChange()`); the newest per-sighting snapshot is the last
 * fallback. The store keeps only the current alignment - no history - so
 * these snapshots are necessary. They must NOT be dispatched or persisted, though: the recorder
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
import type { QrMintAlignmentNow } from 'gps-plus-slam-app-framework/ar/qr/qr-anchor-mint';
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
  /**
   * The most informed alignment that describes odometry segment `segment`
   * (default: the current one), for the save-time mint, which places every
   * sighting of a code through it - a sighting's own snapshot can predate
   * the walk that makes the alignment's yaw observable. For the current
   * segment that is the session's alignment as it stands NOW; for an
   * earlier one, the alignment as it stood when that segment closed.
   */
  alignmentFor(segment?: number): QrMintAlignmentNow;
}

export function createQrSightingFeeder(
  deps: QrSightingFeederDeps
): QrSightingFeeder {
  const accumulator = deps.accumulator ?? createQrSightingAccumulator();
  /** The alignment each closed segment ended with. Every segment below the
   *  current one was closed by `noteFrameChange` (an accumulator reset
   *  restarts at segment 0, so an entry left from before a reset is always
   *  overwritten before it can be read). */
  const closing = new Map<number, QrMintAlignmentNow>();
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
      // Read BEFORE the frame change reaches the store: a tracking restart's
      // reducer wipes the alignment, and the one that walked this segment is
      // what its sightings must be placed through.
      const segment = accumulator.currentSegment();
      closing.set(segment, { ...deps.readAlignment(), segment });
      accumulator.noteFrameChange();
    },
    alignmentFor(segment = accumulator.currentSegment()) {
      if (segment === accumulator.currentSegment()) {
        return { ...deps.readAlignment(), segment };
      }
      return (
        closing.get(segment) ?? {
          alignmentMatrix: null,
          zero: null,
          alignmentSampleCount: 0,
          segment,
        }
      );
    },
  };
}
