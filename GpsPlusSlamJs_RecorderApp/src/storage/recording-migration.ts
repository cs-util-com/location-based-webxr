/**
 * Recording Migration
 *
 * Migrates recorded Redux actions from older coordinate conventions to the
 * current "raw-storage" convention (odomCoordVersion: 5).
 *
 * Five recording eras:
 *
 * Era 1 (pre-2026-03-15, no odomCoordVersion):
 *   - Positions: raw WebXR [x, y, z] — already correct, no migration needed
 *   - GPS payload: `gpsPoint` with derived fields + old ENU coordinates
 *     → rename to `rawGpsPoint`, strip derived fields
 *
 * Era 2 (2026-03-15 → 2026-04, odomCoordVersion: 2):
 *   - Positions: NUE [-z, y, x] (converted at dispatch) — reverse to raw WebXR
 *   - GPS payload: `gpsPoint` with derived fields
 *     → rename to `rawGpsPoint`, strip derived fields
 *
 * Era 3 (2026-04, odomCoordVersion: 3):
 *   - Positions: raw WebXR [x, y, z] — already correct, no migration needed
 *   - GPS payload: `gpsPoint` with derived fields
 *     → rename to `rawGpsPoint`, strip derived fields
 *
 * Era 4 (2026-04, odomCoordVersion: 4):
 *   - Positions: raw WebXR [x, y, z] — no migration needed
 *   - GPS payload: `rawGpsPoint` (raw sensor fields only) — no migration needed
 *
 * Era 5 (current, odomCoordVersion: 5):
 *   - Same action format as era 4 (raw WebXR positions + rawGpsPoint)
 *   - State-side change only: reducer now also applies webxrQuaternionToNUE()
 *     to all quaternion fields. No migration needed — all eras store raw WebXR
 *     rotations in action payloads.
 *
 * The reducer applies webxrToNUE() to raw WebXR positions and
 * webxrQuaternionToNUE() to raw WebXR rotations from all eras.
 * Era-2 positions are reversed first so the same reducer logic produces correct
 * NUE state.
 *
 * Related docs: docs/2026-04-09-raw-storage-convert-on-read.md
 */

import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('RecordingMigration');

/** The current odom coordinate convention version written into new session.json files. */
export const ODOM_COORD_VERSION = 5 as const;

/** Returns true when `v` is an Array with at least 3 numeric elements. */
function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

/** NUE [n, u, e] → raw WebXR [e, u, -n] = [v[2], v[1], -v[0]]. */
function nueToWebxr(v: [number, number, number]): [number, number, number] {
  return [v[2], v[1], -v[0]];
}

/**
 * Migrate recorded actions to the current raw-WebXR convention if needed.
 *
 * Returns the original array unchanged (same reference) when no migration is
 * required (odomCoordVersion >= 3).  Returns a new array with migrated actions
 * when migration is needed — the original array is never mutated.
 *
 * @param actions - Recorded Redux actions from the zip file
 * @param metadata - Parsed session.json, or null if absent
 * @returns Actions ready for replay in the current raw-WebXR convention
 */
export function migrateActionsIfNeeded(
  actions: RecordedAction[],
  metadata: Record<string, unknown> | null
): RecordedAction[] {
  const erasMigrated = migrateErasIfNeeded(actions, metadata);
  return injectRefPointsActions(erasMigrated);
}

function migrateErasIfNeeded(
  actions: RecordedAction[],
  metadata: Record<string, unknown> | null
): RecordedAction[] {
  const version = metadata
    ? (metadata['odomCoordVersion'] as number | undefined)
    : undefined;

  if (version !== undefined && version >= 4) {
    // Era 4+: raw WebXR positions, rawGpsPoint payloads — no migration needed.
    // Era 5 is a state-side-only change (rotation convention in reducer), so
    // eras 4 and 5 have identical action formats and require no migration.
    return actions;
  }

  if (version === 2) {
    // Era 2: positions were converted to NUE at dispatch time.
    // Reverse them to raw WebXR so the reducer can apply webxrToNUE().
    // GPS payloads also need gpsPoint→rawGpsPoint rename + strip.
    return actions.map((action) => migrateGpsPointField(reverseEra2(action)));
  }

  // Eras 1 and 3 (no version, version < 2, or version 3): positions are raw
  // WebXR (correct); GPS payloads use the old `gpsPoint` field — rename +
  // strip. Era 1 carries ENU coordinates but they are stripped anyway (no
  // swap needed); era 3 carries derived fields the strip removes. The
  // transformation is byte-identical for both, so they share this path (the
  // former separate `version === 3` branch duplicated it — quality-review D-4).
  return actions.map((action) => migrateGpsPointField(action));
}

// ---------------------------------------------------------------------------
// refPoints injection: synthesise `refPoints/addRefPointEntry` after
// each `gpsData/markReferencePoint` so legacy zips populate the new flat
// slice that the H3 matcher reads from (Step 5.4) and the OPFS sidecar
// fast-path writes to (Step 5.5).
//
// Idempotent: skipped when the action stream already contains any
// `refPoints/...` action (future recordings may persist them directly).
//
// Plan: [2026-05-27-collapse-refpoint-and-frame-slices-plan.md §B.5 5.6].
// ---------------------------------------------------------------------------

function injectRefPointsActions(actions: RecordedAction[]): RecordedAction[] {
  // Idempotency guard — preserve same-reference contract for streams that
  // already carry the new slice's actions.
  let hasMark = false;
  for (const a of actions) {
    if (a.type.startsWith('refPoints/')) return actions;
    if (a.type === 'gpsData/markReferencePoint') hasMark = true;
  }
  if (!hasMark) return actions;

  const out: RecordedAction[] = [];
  for (const action of actions) {
    out.push(action);
    if (action.type !== 'gpsData/markReferencePoint') continue;

    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;

    const id = payload['id'];
    const rawGpsPoint = payload['rawGpsPoint'] as
      Record<string, unknown> | undefined;
    if (
      typeof id !== 'string' ||
      !rawGpsPoint ||
      typeof rawGpsPoint !== 'object'
    ) {
      log.warn(
        'Dropping malformed gpsData/markReferencePoint: missing string id or rawGpsPoint object',
        { id, hasRawGpsPoint: Boolean(rawGpsPoint) }
      );
      continue;
    }
    // Step 8: the loader is the single validation boundary. An object that
    // is merely *present* is not enough — without finite lat/lon the entry
    // would feed NaN into the H3 matcher and selectKnownAnchorsByCell.
    if (
      !Number.isFinite(rawGpsPoint['latitude']) ||
      !Number.isFinite(rawGpsPoint['longitude'])
    ) {
      log.warn(
        `Dropping markReferencePoint ${id}: rawGpsPoint lacks finite latitude/longitude`,
        {
          latitude: rawGpsPoint['latitude'],
          longitude: rawGpsPoint['longitude'],
        }
      );
      continue;
    }
    const timestamp =
      typeof payload['timestamp'] === 'number'
        ? payload['timestamp']
        : rawGpsPoint['timestamp'];

    // Forward the raw WebXR AR pose + display name so the post-load action
    // stream is uniform across eras: every `addRefPointEntry` carries the
    // pose the investigation harness recomputes alignment from, and a
    // human-readable label when the legacy mark had one. Pose/name are
    // optional — when a legacy payload lacks them they are simply omitted
    // (harness falls back to id, treats pose-absence as "not a live mark").
    // See 2026-05-29-investigation-harness-refpoint-source-migration-plan.md
    // §E.3.
    const position = payload['position'];
    const rotation = payload['rotation'];
    const name = payload['name'];

    out.push({
      type: 'refPoints/addRefPointEntry',
      payload: {
        id,
        timestamp: typeof timestamp === 'number' ? timestamp : 0,
        rawGpsPoint,
        ...(isFiniteVec(position, 3) ? { position } : {}),
        ...(isFiniteVec(rotation, 4) ? { rotation } : {}),
        ...(typeof name === 'string' ? { name } : {}),
      },
    });
  }
  return out;
}

/**
 * True when `value` is an array of exactly `len` finite numbers. Used to
 * forward only well-formed AR-pose vectors into the synthesized
 * `refPoints/addRefPointEntry` payload (defensive boundary validation).
 */
function isFiniteVec(value: unknown, len: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === len &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

// ---------------------------------------------------------------------------
// GPS payload migration: gpsPoint → rawGpsPoint (strip derived fields)
// Applied to eras 1, 2, and 3 actions.
// ---------------------------------------------------------------------------

/** Derived fields that exist on GpsPoint but not on RawGpsPoint. */
const DERIVED_GPS_FIELDS = [
  'coordinates',
  'weight',
  'zeroRef',
  'deviceRotation',
];

/**
 * Strip derived fields from a gpsPoint object, leaving only raw sensor fields.
 */
function stripDerivedFields(
  gpsPoint: Record<string, unknown>
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(gpsPoint)) {
    if (!DERIVED_GPS_FIELDS.includes(key)) {
      raw[key] = value;
    }
  }
  return raw;
}

/**
 * Migrate `gpsPoint` → `rawGpsPoint` in recordGpsEvent and markReferencePoint
 * payloads. Strips derived fields (coordinates, weight, zeroRef, deviceRotation).
 */
function migrateGpsPointField(action: RecordedAction): RecordedAction {
  if (
    action.type === 'gpsData/recordGpsEvent' ||
    action.type === 'gpsData/markReferencePoint'
  ) {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const gpsPoint = payload['gpsPoint'] as Record<string, unknown> | undefined;
    if (!gpsPoint || typeof gpsPoint !== 'object') return action;

    const { gpsPoint: _, ...restPayload } = payload;
    return {
      ...action,
      payload: {
        ...restPayload,
        rawGpsPoint: stripDerivedFields(gpsPoint),
      },
    };
  }

  return action;
}

// ---------------------------------------------------------------------------
// Era 2 migration: reverse NUE positions → raw WebXR
// ---------------------------------------------------------------------------

/**
 * Replace a single Vec3 field on `action.payload` by passing it through
 * `nueToWebxr`. Returns the action unchanged if the payload is missing,
 * non-object, or the field isn't a Vec3 — i.e. each `reverseEra2` branch
 * preserves its existing "unrecognized payload shape ⇒ pass through"
 * behaviour without repeating the parse / type-check / spread boilerplate.
 */
function reverseEra2Vec3Field(
  action: RecordedAction,
  field: string
): RecordedAction {
  const payload = action.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') return action;

  const value = payload[field];
  if (!isVec3(value)) return action;

  return {
    ...action,
    payload: {
      ...payload,
      [field]: nueToWebxr(value),
    },
  };
}

function reverseEra2(action: RecordedAction): RecordedAction {
  if (action.type === 'gpsData/recordGpsEvent') {
    return reverseEra2Vec3Field(action, 'odomPosition');
  }

  if (action.type === 'gpsData/markReferencePoint') {
    return reverseEra2Vec3Field(action, 'position');
  }

  if (action.type === 'gpsData/add2dImage') {
    return reverseEra2Vec3Field(action, 'position');
  }

  if (action.type === 'gpsData/odometryTrackingRestarted') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const lastValidOdomPos = payload['lastValidOdomPos'];
    if (!isVec3(lastValidOdomPos)) return action;

    const migrated: Record<string, unknown> = {
      ...payload,
      lastValidOdomPos: nueToWebxr(lastValidOdomPos),
    };

    const newOdomPos = payload['newOdomPos'];
    if (isVec3(newOdomPos)) {
      migrated['newOdomPos'] = nueToWebxr(newOdomPos);
    }

    return { ...action, payload: migrated };
  }

  if (action.type === 'recording/recordDepthSample') {
    return reverseEra2Vec3Field(action, 'cameraPos');
  }

  if (action.type === 'gpsData/arLoopClosureDetected') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const lastPos = payload['lastPos'];
    const newPos = payload['newPos'];
    if (!isVec3(lastPos) || !isVec3(newPos)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        lastPos: nueToWebxr(lastPos),
        newPos: nueToWebxr(newPos),
      },
    };
  }

  return action;
}
