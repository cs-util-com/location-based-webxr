import type { QrAnchorOutcome } from '../qr/qr-level-zip-contributor';
/**
 * Pure builder for the end-of-recording session summary.
 *
 * Extracted from `performStop` in `recording-session-handlers.ts` so the
 * summary derivation (distance integration, NUE→GPS snapshot mapping, field
 * assembly) is testable without the recording-lifecycle mock forest. The
 * function is PURE: no store access, no I/O, no module-singleton reads —
 * `performStop` gathers every input (store slices, visualizer snapshot
 * positions, sync result, filename) and passes them in explicitly.
 */

import type {
  GpsPoint,
  LatLong,
  Matrix4,
  Vector3,
} from 'gps-plus-slam-app-framework/core';
import { calcGpsCoords } from 'gps-plus-slam-app-framework/core';
import { computeFusedPath } from 'gps-plus-slam-app-framework/utils/fused-path';
import type { ZipExportResult } from 'gps-plus-slam-app-framework/storage/zip-export';
import { refPointEntriesToMarkerData } from '../ui/ref-point-map-markers';
import type { RefPointEntry } from '../state/ref-points-slice';
import type { SessionSummaryData } from '../ui/session-summary';

/**
 * The subset of {@link GpsPoint} the summary actually reads. Narrow on
 * purpose: state's full `GpsPoint[]` is assignable, while tests only have to
 * construct the four load-bearing fields.
 */
type SummaryGpsPoint = Pick<
  GpsPoint,
  'latitude' | 'longitude' | 'latLongAccuracy' | 'zeroRef'
>;

/**
 * Explicit inputs of {@link buildSessionSummary} — everything `performStop`
 * used to close over. All values are read-only for the builder; none are
 * mutated.
 */
export interface SessionSummaryInputs {
  /** Authoritative recording end time (epoch ms), captured at stop. */
  endTime: number;
  /**
   * `sessionMetadata.startTime` — `undefined` when the metadata was
   * inconsistent at stop time; the summary then falls back to `endTime`
   * (duration ≈ 0 rather than a bogus epoch-length duration).
   */
  startTime: number | undefined;
  /** Number of images captured during the session. */
  imageCount: number;
  /** Number of depth samples taken during the session. */
  depthSampleCount: number;
  /** Collected tracker error/warning strings (passed through verbatim). */
  errors: string[];
  qrAnchors: readonly QrAnchorOutcome[];
  /** `state.recording.failedWriteCount` at stop time. */
  failedWriteCount: number;
  /** Raw GPS points (`gpsEvents.gpsPositions`); empty when no GPS fix. */
  gpsPositions: readonly SummaryGpsPoint[];
  /** NUE odometry positions (`gpsEvents.odometryPositions`). */
  odometryPositions: readonly Vector3[];
  /** Current alignment matrix, or null before the first alignment. */
  alignmentMatrix: Matrix4 | null;
  /**
   * NUE positions of the alignment-snapshot markers — the caller reads them
   * from `gpsEventVisualizer.getAlignmentSnapshotPositions()` (Issue #1).
   * Mapped to GPS coords iff the first GPS point provides a `zeroRef`.
   */
  alignmentSnapshotNuePositions: readonly Vector3[];
  /** Reference-point entries (recorder `refPoints` slice). */
  refPoints: readonly RefPointEntry[];
  /** Final sync / OPFS ZIP export result, or null when export failed. */
  syncResult: ZipExportResult | null;
  /**
   * Suggested ZIP filename. The caller resolves it (saved-file name or a
   * generated one) ONLY when `syncResult` exists — `undefined` otherwise.
   */
  zipFilename: string | undefined;
}

/**
 * Derive the {@link SessionSummaryData} shown on the summary screen.
 *
 * - `totalDistanceMeters`: sum of 3D Euclidean segment lengths over the NUE
 *   odometry positions (0 for empty or single-point paths).
 * - `alignmentSnapshotPath`: snapshot NUE positions converted to GPS via
 *   `calcGpsCoords` against the first GPS point's `zeroRef`; empty when no
 *   zeroRef is available (no GPS fix ⇒ no NUE→GPS mapping exists).
 * - `referencePointsForMap`: shared mapping with the live minimap wirer —
 *   both maps must plot identical coordinates/labels (2026-07-05 live-map
 *   feedback).
 */
export function buildSessionSummary(
  inputs: SessionSummaryInputs
): SessionSummaryData {
  const {
    endTime,
    startTime,
    imageCount,
    depthSampleCount,
    errors,
    qrAnchors,
    failedWriteCount,
    gpsPositions,
    odometryPositions,
    alignmentMatrix,
    alignmentSnapshotNuePositions,
    refPoints,
    syncResult,
    zipFilename,
  } = inputs;

  const firstGps = gpsPositions.length > 0 ? gpsPositions[0] : null;
  const lastGps =
    gpsPositions.length > 0 ? gpsPositions[gpsPositions.length - 1] : null;
  const zeroRef = firstGps?.zeroRef ?? null;

  return {
    duration: {
      startTime: startTime ?? endTime,
      endTime,
    },
    gpsEventCount: gpsPositions.length,
    refPointCount: refPoints.length,
    imageCount,
    depthSampleCount,
    errors,
    qrAnchors,
    firstGps: firstGps ? toLatLng(firstGps) : null,
    lastGps: lastGps ? toLatLng(lastGps) : null,
    totalDistanceMeters: integrateOdometryDistanceMeters(odometryPositions),
    failedWriteCount,
    rawGpsPath: gpsPositions.map(toRawGpsSample),
    fusedPath: computeFusedPath({
      odometryPositions,
      alignmentMatrix,
      zeroRef,
    }),
    // Shared mapping with the live minimap wirer — both maps must plot
    // identical coordinates/labels (2026-07-05 live-map feedback).
    referencePointsForMap: refPointEntriesToMarkerData(refPoints),
    ...zipFields(syncResult, zipFilename),
    alignmentSnapshotPath: mapSnapshotsToGps(
      zeroRef,
      alignmentSnapshotNuePositions
    ),
  };
}

/** ZIP presentation fields — all `undefined` without a sync result. */
function zipFields(
  syncResult: ZipExportResult | null,
  zipFilename: string | undefined
): Pick<
  SessionSummaryData,
  'zipSizeBytes' | 'zipFileCount' | 'zipBlob' | 'zipFilename'
> {
  return {
    zipSizeBytes: syncResult?.blob?.size,
    zipFileCount: syncResult?.fileCount,
    zipBlob: syncResult?.blob,
    // Defensive re-guard: the caller only supplies a filename alongside a
    // sync result, but the field must stay undefined without a ZIP.
    zipFilename: syncResult ? zipFilename : undefined,
  };
}

/** Sum of 3D Euclidean segment lengths; 0 for empty/single-point paths. */
function integrateOdometryDistanceMeters(
  odometryPositions: readonly Vector3[]
): number {
  let totalDistanceMeters = 0;
  for (let i = 1; i < odometryPositions.length; i++) {
    const prev = odometryPositions[i - 1]!;
    const curr = odometryPositions[i]!;
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const dz = curr[2] - prev[2];
    totalDistanceMeters += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return totalDistanceMeters;
}

/**
 * Convert alignment snapshot NUE positions to GPS coordinates (Issue #1).
 * Without a zeroRef no NUE→GPS mapping exists, so the path is empty.
 */
function mapSnapshotsToGps(
  zeroRef: LatLong | null,
  nuePositions: readonly Vector3[]
): Array<{ lat: number; lng: number }> {
  if (!zeroRef) {
    return [];
  }
  return nuePositions.map((nuePos) => {
    const gps = calcGpsCoords(zeroRef, nuePos);
    return { lat: gps.lat, lng: gps.lon };
  });
}

function toLatLng(p: SummaryGpsPoint): { lat: number; lng: number } {
  return { lat: p.latitude, lng: p.longitude };
}

/** Map-sample shape: `accuracy` is attached only when positive (a 0/absent
 *  1σ radius must not draw a bogus circle on the summary map). */
function toRawGpsSample(p: SummaryGpsPoint): {
  lat: number;
  lng: number;
  accuracy?: number;
} {
  return {
    lat: p.latitude,
    lng: p.longitude,
    ...(typeof p.latLongAccuracy === 'number' && p.latLongAccuracy > 0
      ? { accuracy: p.latLongAccuracy }
      : {}),
  };
}
