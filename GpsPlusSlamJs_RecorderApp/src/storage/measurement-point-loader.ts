/**
 * Measurement Point Loader
 *
 * Manages loading, saving, and validating measurement point entities from the
 * scenario's measurementPoints/ directory. Modeled after the RefPointDefinition /
 * RefPointObservation pattern in ref-point-loader.ts.
 *
 * Each measurement point is stored as a separate JSON file containing the full
 * entity (observations, solved position, provenance).
 */

import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { ArPoseTuples } from 'gps-plus-slam-app-framework/types/ar-types';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('MeasurementPointLoader');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single ray observation recorded at "shoot" time.
 * Models the RefPointObservation pattern by storing the raw device arPose,
 * while ALSO storing the derived ray geometry to support tap unprojections.
 */
export interface MeasurementRayRecord {
  readonly id: string;
  readonly timestamp: number;

  /** The raw device pose at capture (position + rotation), matching RefPointObservation */
  readonly arPose: ArPoseTuples;

  /** Derived ray origin in AR-local space */
  readonly rayOrigin: Vector3;
  /** Derived ray direction in AR-local space (unit vector) */
  readonly rayDirection: Vector3;

  /** Ray weight (e.g. 1.0 for manual crosshair) */
  readonly rayWeight: number;
  /** Unprojected depth point in AR-local space, if available */
  readonly depthPoint?: Vector3;
  /** Depth weight decaying with distance, if available */
  readonly depthWeight?: number;
  /** Timestamp of the depth frame used for this observation, if available */
  readonly depthTimestamp?: number;
}

/**
 * A confirmed measurement point persisted to disk.
 * Schema-versioned for forward compatibility.
 */
export interface MeasurementPointEntity {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly scenarioId: string;

  /** The rays used to triangulate this point */
  readonly observations: MeasurementRayRecord[];

  /** Ground truth: solved position in AR-local frame */
  readonly arPosition: Vector3;
  /**
   * Snapshot of GPS-world position at confirm time (via alignment matrix).
   * Used for cross-session recovery only.
   * The LIVE visualization recomputes from arPosition × currentAlignmentMatrix.
   * Null when no alignment matrix was available at confirm time.
   */
  readonly gpsPositionSnapshot: Vector3 | null;

  readonly uncertainty: number;
  readonly rmsError: number;

  /** IDs of observations classified as inliers by the robust solver */
  readonly inlierIds: string[];
  /** IDs of observations classified as outliers by the robust solver */
  readonly outlierIds: string[];
  /** Whether the point passed the quality gate or used an explicit override. */
  readonly confirmationMode?: 'quality' | 'override';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Check if a value is a valid Vector3 tuple. */
function isVector3(v: unknown): v is Vector3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

/** Check if arPose has required position and rotation arrays. */
function hasValidArPose(o: Record<string, unknown>): boolean {
  if (typeof o.arPose !== 'object' || o.arPose === null) {
    return false;
  }
  const arPose = o.arPose as Record<string, unknown>;
  return Array.isArray(arPose.position) && Array.isArray(arPose.rotation);
}

/** Check if a single ray record has the required structure. */
function isValidRayRecord(obs: unknown): obs is MeasurementRayRecord {
  if (typeof obs !== 'object' || obs === null) return false;
  const o = obs as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.timestamp === 'number' &&
    hasValidArPose(o) &&
    isVector3(o.rayOrigin) &&
    isVector3(o.rayDirection) &&
    typeof o.rayWeight === 'number' &&
    (o.depthTimestamp === undefined || typeof o.depthTimestamp === 'number')
  );
}

function hasValidEntityScalars(v: Record<string, unknown>): boolean {
  return (
    v.schemaVersion === 1 &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number' &&
    typeof v.scenarioId === 'string' &&
    typeof v.uncertainty === 'number' &&
    typeof v.rmsError === 'number'
  );
}

function hasValidEntityArrays(v: Record<string, unknown>): boolean {
  return (
    Array.isArray(v.inlierIds) &&
    Array.isArray(v.outlierIds) &&
    Array.isArray(v.observations)
  );
}

/**
 * Type guard: validates parsed JSON matches MeasurementPointEntity shape.
 * Prevents runtime crashes from malformed or legacy JSON files.
 * Validates schemaVersion, nested observations, and required fields.
 */
// eslint-disable-next-line complexity
export function isMeasurementPointEntity(
  value: unknown
): value is MeasurementPointEntity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (!hasValidEntityScalars(v) || !hasValidEntityArrays(v)) return false;
  if (!isVector3(v.arPosition)) return false;
  if (
    v.confirmationMode !== undefined &&
    v.confirmationMode !== 'quality' &&
    v.confirmationMode !== 'override'
  ) {
    return false;
  }
  // gpsPositionSnapshot is nullable (null when no alignment matrix at confirm time)
  if (v.gpsPositionSnapshot !== null && !isVector3(v.gpsPositionSnapshot))
    return false;

  return (v.observations as unknown[]).every(isValidRayRecord);
}

// ---------------------------------------------------------------------------
// OPFS Read / Write
// ---------------------------------------------------------------------------

/**
 * Atomically write a JSON object to an OPFS file.
 * Uses the "abort writable on failure" pattern: if write() or close()
 * throws, explicitly abort() to release the lock so the partial file
 * does not block subsequent writes.
 */
async function writeJsonToOpfs(
  directoryHandle: FileSystemDirectoryHandle,
  filename: string,
  data: unknown
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(filename, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  let writeError: unknown = null;
  try {
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  } catch (error: unknown) {
    writeError = error;
  } finally {
    if (writeError !== null) {
      try {
        await writable.abort();
      } catch {
        // Intentionally ignored: abort failure should not mask the write error
      }
    }
  }
  if (writeError !== null) {
    if (writeError instanceof Error) throw writeError;
    throw new Error('OPFS write failed');
  }
}

/**
 * Load all measurement points from the scenario's measurementPoints/ directory.
 * Returns [] if the directory does not exist yet.
 * @public
 */
export async function loadAllMeasurementPoints(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<MeasurementPointEntity[]> {
  try {
    const dirHandle =
      await scenarioHandle.getDirectoryHandle('measurementPoints');
    const results: MeasurementPointEntity[] = [];

    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue;

      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        if (isMeasurementPointEntity(parsed)) {
          results.push(parsed);
        } else {
          log.warn(`Invalid measurement point schema in "${name}"`);
        }
      } catch (parseErr) {
        log.error(`Failed to parse measurement point "${name}":`, parseErr);
      }
    }

    return results;
  } catch (err) {
    // measurementPoints directory might not exist yet
    log.debug('No measurementPoints directory found (yet):', err);
    return [];
  }
}

/**
 * Persist a confirmed measurement point to the measurementPoints/ directory.
 * Creates the directory if it doesn't exist.
 * Uses the shared OPFS "abort writable on failure" pattern.
 * @public
 */
export async function writeMeasurementPoint(
  scenarioHandle: FileSystemDirectoryHandle,
  entity: MeasurementPointEntity
): Promise<void> {
  const dirHandle = await scenarioHandle.getDirectoryHandle(
    'measurementPoints',
    { create: true }
  );
  await writeJsonToOpfs(dirHandle, `${entity.id}.json`, entity);
  log.info(
    `Saved measurement point ${entity.id} (${entity.observations.length} observations)`
  );
}

/**
 * Delete a measurement point file from the measurementPoints/ directory.
 * @public
 */
export async function deleteMeasurementPointFile(
  scenarioHandle: FileSystemDirectoryHandle,
  pointId: string
): Promise<void> {
  try {
    const dirHandle =
      await scenarioHandle.getDirectoryHandle('measurementPoints');
    await dirHandle.removeEntry(`${pointId}.json`);
    log.info(`Deleted measurement point ${pointId}`);
  } catch (err) {
    log.error(`Failed to delete measurement point "${pointId}":`, err);
    throw err;
  }
}
