/**
 * GPS-AR Pose Sampler
 *
 * Generic helpers for capturing a `{ gpsPoint, fusedGpsPoint?, arPose,
 * timestamp }` snapshot — the fundamental shape any "drop an anchor here"
 * UX needs. Extracted in Iter 4 of the AppFramework / RecorderApp boundary
 * cleanup so the type/helper does not live under recorder-specific naming.
 *
 * The recorder's `RefPointObservation` is a `GpsAnchorSample` with
 * `sessionId` glued on; other consumers (non-recorder POI capture, future
 * anchor types) can reuse this type directly.
 */

import type { ARPose } from '../types/ar-types';
import type { Quaternion, Vector3 } from 'gps-plus-slam-js';
import { extractOdomPosition, extractOdomRotation } from '../types/ar-types';

export type { ARPose };
export { extractOdomPosition, extractOdomRotation };

/**
 * GPS coordinate captured at observation time. Loosely typed so the recorder
 * can pass either a `RawGpsPoint` or a plain `{ latitude, longitude,
 * altitude? }` shape from the fused-path computation.
 */
export interface GpsAnchorSampleGpsPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude?: number;
}

/**
 * A snapshot pairing the raw GPS reading, the optional fused GPS reading
 * (computed when an alignment matrix is available), and the AR pose at the
 * moment of capture. The `odomPosition` and `odomRotation` are pre-extracted
 * from the AR pose for convenience — callers persisting the snapshot
 * usually need them in tuple form.
 */
export interface GpsAnchorSample {
  readonly gpsPoint: GpsAnchorSampleGpsPoint;
  readonly fusedGpsPoint?: GpsAnchorSampleGpsPoint | undefined;
  readonly arPose: ARPose;
  readonly odomPosition: Vector3;
  readonly odomRotation: Quaternion;
  readonly timestamp: number;
}

export interface CaptureGpsAnchorSampleOptions {
  /** Optional fused GPS point (computed elsewhere from the alignment matrix). */
  readonly fusedGpsPoint?: GpsAnchorSampleGpsPoint | undefined;
  /** Defaults to `Date.now()` at capture time. */
  readonly timestamp?: number;
}

/**
 * Capture a GPS-AR pose snapshot. Extracts `odomPosition`/`odomRotation`
 * from the supplied `arPose`. The supplied `gpsPoint` and optional
 * `fusedGpsPoint` are stored verbatim.
 */
export function captureGpsAnchorSample(
  arPose: ARPose,
  gpsPoint: GpsAnchorSampleGpsPoint,
  options: CaptureGpsAnchorSampleOptions = {}
): GpsAnchorSample {
  return {
    gpsPoint,
    fusedGpsPoint: options.fusedGpsPoint,
    arPose,
    odomPosition: extractOdomPosition(arPose),
    odomRotation: extractOdomRotation(arPose),
    timestamp: options.timestamp ?? Date.now(),
  };
}
