/**
 * Feeds the recorder's derived QR placements into the session's sighting
 * accumulator, and keeps, per code, the alignment the save-time mint will
 * place it through.
 *
 * WHICH ALIGNMENT (owner decision D28, revised 2026-10-02). A code is
 * minted through the FIRST MATURE alignment at or after its last sighting,
 * maturity being a session GPS extent of 40 m (D34)
 * (`QR_MINT_MATURE_GPS_EXTENT_M`). Until then its snapshot follows the
 * alignment; a new sighting re-opens it. A recording saved before that
 * falls back to the alignment at save; a tracking restart or loop closure
 * freezes a waiting code at the alignment its segment closed with. The rule
 * itself lives in the framework's `qr-mint-alignment-tracker`, so the
 * measurement that chose it runs the same code.
 *
 * WHY THE ALIGNMENT IS READ HERE AND NOT RECORDED. The store keeps only the
 * current alignment - no history - so these snapshots are necessary. They
 * must NOT be dispatched or persisted, though: the recorder records RAW
 * observations so a future algorithm can be re-tested against old
 * recordings (decision D-A), and an alignment matrix is a DERIVED value.
 * Replaying the recording re-solves the same alignments at the same points,
 * so nothing is lost by keeping this in memory only.
 *
 * @see gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator — the fold.
 * @see gps-plus-slam-app-framework/ar/qr/qr-mint-alignment-tracker - the rule.
 * @see qr-debug-controller.ts — where the derived placements come from.
 */

import {
  createQrSightingAccumulator,
  type QrSightingAccumulator,
} from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import { createQrMintAlignmentTracker } from 'gps-plus-slam-app-framework/ar/qr/qr-mint-alignment-tracker';
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
  /** The session's GPS extent so far (m), `createGpsExtentTracker`. Without
   *  it no alignment counts as mature, and every code falls back to the
   *  alignment at save. */
  gpsExtentM?: number;
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
  /**
   * The alignment may have changed (a GPS fix): every code still waiting for
   * a mature alignment follows it. Call it as the store updates; once per
   * animation frame is enough.
   */
  noteAlignment(): void;
  /** The odometry frame changed — sightings either side are not comparable.
   *  Call it BEFORE the change reaches the store (a restart wipes the
   *  alignment the closing segment ended with). */
  noteFrameChange(): void;
  /** Discard every sighting and every kept alignment (a store swap). */
  reset(): void;
  /** The accumulator, for the mint and the status line. */
  readonly accumulator: QrSightingAccumulator;
  /**
   * The alignment the save-time mint places `text` through: the first
   * mature one at or after its last sighting, else the alignment as it
   * stands now (the save), or the one its segment closed with.
   */
  alignmentFor(text: string): QrMintAlignmentNow;
}

export function createQrSightingFeeder(
  deps: QrSightingFeederDeps
): QrSightingFeeder {
  const accumulator = deps.accumulator ?? createQrSightingAccumulator();
  const tracker = createQrMintAlignmentTracker();
  const now = (): QrMintAlignmentNow => ({
    ...deps.readAlignment(),
    segment: accumulator.currentSegment(),
  });
  return {
    accumulator,
    onPlacement(text, placement, timestampMs) {
      const alignment = now();
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
      tracker.noteSighting(text, alignment);
    },
    noteAlignment() {
      tracker.noteAlignment(now());
    },
    noteFrameChange() {
      // Read BEFORE the frame change reaches the store: a tracking restart's
      // reducer wipes the alignment, and the one that walked this segment is
      // what its waiting codes must be placed through.
      tracker.closeSegment(now());
      accumulator.noteFrameChange();
    },
    reset() {
      accumulator.reset();
      tracker.reset();
    },
    alignmentFor(text) {
      return tracker.alignmentFor(text, now());
    },
  };
}
