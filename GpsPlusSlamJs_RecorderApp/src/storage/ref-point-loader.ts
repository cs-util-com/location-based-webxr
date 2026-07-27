/**
 * Reference Point Loader Module
 *
 * Manages loading and saving reference points from the scenario's refPoints/ directory.
 * Each reference point is stored as a separate JSON file containing all observations
 * across sessions.
 */

import type {
  GpsPoint,
  LatLongAlt,
  Vector3,
  Quaternion,
} from 'gps-plus-slam-app-framework/core';
import type { ArPoseTuples } from 'gps-plus-slam-app-framework/types/ar-types';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { writeFileOrAbort } from 'gps-plus-slam-app-framework/storage/write-file-or-abort';
import { isRefPointDefinitionShape } from './ref-point-zip-helpers';

const log = createLogger('RefPointLoader');

/**
 * A single observation of a reference point in one session.
 */
export interface RefPointObservation {
  /** Session ID (e.g., "recording-2025-02-28_14-30-11utc") */
  readonly sessionId: string;
  /** When this observation was made */
  readonly timestamp: number;
  /** AR pose at the moment of marking */
  readonly arPose: ArPoseTuples;
  /** Full GPS point from library (includes lat/lon, accuracy, etc.) */
  readonly gpsPoint: GpsPoint;
  /** Fused GPS from aligned VIO path at mark time (absent in legacy data) */
  readonly fusedGpsPoint?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
}

/**
 * Complete definition of a reference point with all observations.
 */
export interface RefPointDefinition {
  /** Unique identifier (e.g., "pointA", "benchCorner") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Timestamp of first observation */
  createdAt: number;
  /** All observations across sessions */
  observations: RefPointObservation[];
}

/**
 * Check if arPose has required position and rotation arrays.
 */
function hasValidArPose(o: Record<string, unknown>): boolean {
  if (typeof o.arPose !== 'object' || o.arPose === null) {
    return false;
  }
  const arPose = o.arPose as Record<string, unknown>;
  return Array.isArray(arPose.position) && Array.isArray(arPose.rotation);
}

/**
 * Check if gpsPoint has required lat/lon numbers.
 */
function hasValidGpsPoint(o: Record<string, unknown>): boolean {
  if (typeof o.gpsPoint !== 'object' || o.gpsPoint === null) {
    return false;
  }
  const gpsPoint = o.gpsPoint as Record<string, unknown>;
  return (
    typeof gpsPoint.latitude === 'number' &&
    typeof gpsPoint.longitude === 'number'
  );
}

/**
 * Type guard to validate a single observation has required nested properties.
 * Prevents runtime errors from accessing arPose.position or gpsPoint.latitude on malformed data.
 */
function isValidObservation(obs: unknown): obs is RefPointObservation {
  if (typeof obs !== 'object' || obs === null) {
    return false;
  }
  const o = obs as Record<string, unknown>;
  return hasValidArPose(o) && hasValidGpsPoint(o);
}

/**
 * Type guard to validate parsed JSON matches RefPointDefinition shape.
 * Prevents runtime errors from malformed or corrupted JSON files.
 * Also validates each observation to ensure nested properties exist.
 *
 * Exported so other sidecar readers (e.g. `recording-loader.ts`) can apply
 * the same deep validation instead of the shape-only
 * {@link isRefPointDefinitionShape}, which would let malformed observations
 * through and later crash consumers like `flattenRefPointsToMarks`.
 */
export function isRefPointDefinition(
  value: unknown
): value is RefPointDefinition {
  if (!isRefPointDefinitionShape(value)) {
    return false;
  }

  // Validate each observation has required nested structure
  return (value.observations as unknown[]).every(isValidObservation);
}

/**
 * Parse a single reference point file and validate its schema.
 * Returns null if parsing fails or schema is invalid.
 */
async function parseRefPointFile(
  fileHandle: FileSystemFileHandle,
  fileName: string
): Promise<RefPointDefinition | null> {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    if (isRefPointDefinition(parsed)) {
      return parsed;
    }
    log.warn(`Invalid schema in "${fileName}"`);
    return null;
  } catch (parseErr) {
    log.error(`Failed to parse "${fileName}":`, parseErr);
    return null;
  }
}

/**
 * Load all reference point definitions from the scenario's refPoints/ directory.
 *
 * @param scenarioHandle - File system handle for the scenario folder
 * @returns Array of all reference point definitions
 */
export async function loadAllRefPoints(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<RefPointDefinition[]> {
  try {
    const refPointsHandle =
      await scenarioHandle.getDirectoryHandle('refPoints');
    const refPoints: RefPointDefinition[] = [];

    for await (const [name, handle] of refPointsHandle.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) {
        continue;
      }

      const parsed = await parseRefPointFile(
        handle as FileSystemFileHandle,
        name
      );
      if (parsed) {
        refPoints.push(parsed);
      }
    }

    return refPoints;
  } catch (err) {
    // refPoints directory might not exist yet
    log.debug('No refPoints directory found (yet):', err);
    return [];
  }
}

/**
 * Load a specific reference point by ID.
 *
 * @param scenarioHandle - File system handle for the scenario folder
 * @param pointId - Reference point ID
 * @returns Reference point definition or null if not found
 */
export async function loadRefPoint(
  scenarioHandle: FileSystemDirectoryHandle,
  pointId: string
): Promise<RefPointDefinition | null> {
  try {
    const refPointsHandle =
      await scenarioHandle.getDirectoryHandle('refPoints');
    const fileHandle = await refPointsHandle.getFileHandle(`${pointId}.json`);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    if (!isRefPointDefinition(parsed)) {
      log.warn(`Invalid schema for "${pointId}"`);
      return null;
    }
    return parsed;
  } catch (err) {
    log.debug(`Reference point ${pointId} not found:`, err);
    return null;
  }
}

/**
 * Save or update a reference point observation.
 * Creates the refPoints/ directory if it doesn't exist.
 * If the reference point exists, appends the new observation.
 * If it doesn't exist, creates a new reference point file.
 *
 * @param scenarioHandle - File system handle for the scenario folder
 * @param pointId - Reference point ID
 * @param pointName - Human-readable name for the reference point
 * @param observation - New observation to add
 */
export async function saveRefPointObservation(
  scenarioHandle: FileSystemDirectoryHandle,
  pointId: string,
  pointName: string,
  observation: RefPointObservation
): Promise<void> {
  try {
    // Ensure refPoints directory exists
    const refPointsHandle = await scenarioHandle.getDirectoryHandle(
      'refPoints',
      { create: true }
    );

    // Try to load existing reference point
    const existing = await loadRefPoint(scenarioHandle, pointId);

    const definition: RefPointDefinition = existing
      ? {
          ...existing,
          observations: [...existing.observations, observation],
        }
      : {
          id: pointId,
          name: pointName,
          createdAt: observation.timestamp,
          observations: [observation],
        };

    // Write to file using safe pattern: abort writable on failure to release lock
    await writeRefPointDefinitionFile(refPointsHandle, definition);

    log.info(
      `Saved observation for ${pointId} (${definition.observations.length} total observations)`
    );
  } catch (err) {
    log.error(`Failed to save reference point "${pointId}":`, err);
    throw err;
  }
}

/**
 * Write a complete RefPointDefinition to OPFS.
 * Creates the refPoints/ directory if it doesn't exist.
 * Used by the recovery flow to restore definitions extracted from ZIPs.
 *
 * @param scenarioHandle - File system handle for the scenario folder
 * @param definition - Complete ref point definition to write
 */
export async function writeRefPointDefinition(
  scenarioHandle: FileSystemDirectoryHandle,
  definition: RefPointDefinition
): Promise<void> {
  const refPointsHandle = await scenarioHandle.getDirectoryHandle('refPoints', {
    create: true,
  });
  await writeRefPointDefinitionFile(refPointsHandle, definition);
}

/**
 * Atomically write a single RefPointDefinition JSON file inside `refPointsHandle`.
 *
 * The write/abort lifecycle lives in the framework's {@link writeFileOrAbort} —
 * this function only decides the filename and the serialization.
 */
async function writeRefPointDefinitionFile(
  refPointsHandle: FileSystemDirectoryHandle,
  definition: RefPointDefinition
): Promise<void> {
  const fileHandle = await refPointsHandle.getFileHandle(
    `${definition.id}.json`,
    { create: true }
  );
  await writeFileOrAbort(fileHandle, JSON.stringify(definition, null, 2));
}

/**
 * Get list of all reference point IDs in the scenario.
 * Useful for autocomplete/suggestions.
 *
 * @param scenarioHandle - File system handle for the scenario folder
 * @returns Array of reference point IDs
 */
export async function listRefPointIds(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  try {
    const refPointsHandle =
      await scenarioHandle.getDirectoryHandle('refPoints');
    const ids: string[] = [];

    for await (const [name, handle] of refPointsHandle.entries()) {
      if (handle.kind === 'file' && name.endsWith('.json')) {
        // Remove .json extension to get ID
        ids.push(name.slice(0, -5));
      }
    }

    return ids.sort();
  } catch (err) {
    log.debug('No refPoints directory found (yet):', err);
    return [];
  }
}

/**
 * Marker type representing a single observation suitable for visualization.
 * Position/rotation use odometry frame; gpsPosition provides world coordinates.
 */
export interface RefPointMark {
  id: string;
  /** Odometry position at the moment of marking */
  odomPosition: Vector3;
  /** Odometry rotation at the moment of marking */
  odomRotation: Quaternion;
  /** GPS position if available */
  gpsPosition?: LatLongAlt;
  timestamp: number;
}

/**
 * Flatten an array of RefPointDefinition objects into individual RefPointMark
 * observations suitable for visualization.
 *
 * @param refPointDefs - Array of reference point definitions with observations
 * @returns Flat array of individual marks (one per observation)
 */
export function flattenRefPointsToMarks(
  refPointDefs: RefPointDefinition[]
): RefPointMark[] {
  return refPointDefs.flatMap((def) =>
    def.observations.map((obs): RefPointMark => {
      // Prefer fused GPS when available (sub-metre vs 3–10 m raw scatter).
      // See 2026-04-24-refpoint-positioning-investigation.md §7 for the
      // design rationale.
      //
      // Per-field fallback (Option B, 2026-04-29 user-feedback Finding 1):
      // Legacy recordings persisted `fusedGpsPoint.altitude = undefined`
      // due to a bug in `calcGpsCoords` that discarded altitude when the
      // GPS-zero origin had no altitude. Mixing fused lat/lon with raw
      // altitude is acceptable here because fused altitude was *intended*
      // to equal raw altitude (the recorder builds fused from the same
      // odom Y), so the fallback recovers the lost value rather than
      // mixing independent sources. New recordings (post-fix) carry
      // their own altitude in fusedGpsPoint, so the fallback only fires
      // for legacy data.
      const fused = obs.fusedGpsPoint;
      const gpsPosition = {
        lat: fused?.latitude ?? obs.gpsPoint.latitude,
        lon: fused?.longitude ?? obs.gpsPoint.longitude,
        altitude: fused?.altitude ?? obs.gpsPoint.altitude,
      };
      return {
        id: def.id,
        odomPosition: obs.arPose.position,
        odomRotation: obs.arPose.rotation,
        gpsPosition,
        timestamp: obs.timestamp,
      };
    })
  );
}

/**
 * Horizontal-accuracy gate for the robust average (D6(a), 2026-07-06):
 * observations whose raw `latLongAccuracy` exceeds this are excluded from
 * the averaged position. Empirically chosen from recorded-session data:
 * legitimate ref-point observations sit ≤ ~10 m accuracy (p95 ≈ 7 m), so
 * 20 m is ~2× above anything real and only fires on genuinely degraded
 * fixes (indoor-poisoned captures land tens of meters off).
 */
export const REF_POINT_ACCURACY_GATE_M = 20;

/**
 * Starvation guard for the accuracy gate: when fewer than this many
 * observations survive, the original set is kept — a mostly-poisoned
 * definition must not be averaged over a tiny unrepresentative remnant.
 */
const ACCURACY_GATE_MIN_SURVIVORS = 3;

/**
 * Apply the accuracy gate to a definition's observations. Observations
 * without a (finite, numeric) `latLongAccuracy` are kept — the gate only
 * acts on provably bad fixes. `min(MIN_SURVIVORS, total)` means 1–2
 * observation definitions always pass through unchanged.
 */
function gateObservationsByAccuracy(
  observations: RefPointObservation[]
): RefPointObservation[] {
  const kept = observations.filter((obs) => {
    const acc = obs.gpsPoint.latLongAccuracy;
    return (
      typeof acc !== 'number' ||
      !Number.isFinite(acc) ||
      acc <= REF_POINT_ACCURACY_GATE_M
    );
  });
  if (
    kept.length < Math.min(ACCURACY_GATE_MIN_SURVIVORS, observations.length)
  ) {
    return observations;
  }
  return kept;
}

/**
 * Compute one averaged GPS position per reference point ID.
 * For each observation, prefers `fusedGpsPoint` (sub-meter accuracy) when
 * available, falling back to raw `gpsPoint`. Returns the centroid (mean
 * lat/lon) across the observations that pass the accuracy gate
 * ({@link REF_POINT_ACCURACY_GATE_M} with a starvation guard — D6(a)
 * robust averaging).
 */
export function averageGpsPerRefPoint(
  refPointDefs: RefPointDefinition[]
): Array<{ id: string; name: string; lat: number; lon: number; alt?: number }> {
  return refPointDefs
    .filter((def) => def.observations.length > 0)
    .map((def) => {
      const coords = gateObservationsByAccuracy(def.observations)
        .map((obs) => {
          if (obs.fusedGpsPoint) {
            return {
              lat: obs.fusedGpsPoint.latitude,
              lon: obs.fusedGpsPoint.longitude,
              alt: obs.fusedGpsPoint.altitude,
            };
          }
          if (
            typeof obs.gpsPoint.latitude === 'number' &&
            typeof obs.gpsPoint.longitude === 'number'
          ) {
            return {
              lat: obs.gpsPoint.latitude,
              lon: obs.gpsPoint.longitude,
              alt: obs.gpsPoint.altitude,
            };
          }
          return null;
        })
        .filter((c) => c !== null);

      if (coords.length === 0) return null;

      const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const avgLon = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
      const alts = coords.filter(
        (c): c is { lat: number; lon: number; alt: number } => c.alt != null
      );
      const avgAlt =
        alts.length > 0
          ? alts.reduce((s, c) => s + c.alt, 0) / alts.length
          : undefined;
      return {
        id: def.id,
        name: def.name,
        lat: avgLat,
        lon: avgLon,
        alt: avgAlt,
      };
    })
    .filter(
      (
        r
      ): r is {
        id: string;
        name: string;
        lat: number;
        lon: number;
        alt: number | undefined;
      } => r !== null
    );
}
