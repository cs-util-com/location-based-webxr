/**
 * Recording Loader — version-transparent entry point for reading recording zips.
 *
 * Hides format evolution (era-1 through current) from every caller. Returns a
 * fully-normalized {@link LoadedRecording} containing:
 *   - parsed session.json metadata (or null when absent),
 *   - migrated action entries (always current schema),
 *   - a unified list of ref-point definitions assembled from sidecar
 *     `refPoints/*.json` files merged with `gpsData/markReferencePoint`
 *     actions in the log,
 *   - capability flags so callers can skip checks that don't apply to the
 *     given recording without re-implementing format detection,
 *   - a lazy, memoized `getFinalState()` that replays the migrated actions
 *     into a fresh recorder store.
 *
 * Design notes & merge rule for `refPoints`:
 *   - Sidecar wins per id when both sidecar and action-derived data exist
 *     for the same `RefPointDefinition.id`. Sidecars are the curated form
 *     (carry `name`, accumulated observations across sessions, and the
 *     optional `fusedGpsPoint`). They are only ever a *superset* of any
 *     single session's action log for the same point.
 *   - Action-only ids (legacy recordings predating 2026-04-14 sidecars)
 *     produce a synthesized def: `id` from the H3 hash, `name` falls back
 *     to `id`, `sessionId` is taken from the `recording/startSession`
 *     action's `payload.sessionName` (else from session metadata, else
 *     `'legacy-session'`).
 *   - Sidecars-only ids (e.g. observations from previous sessions stored
 *     in the same scenario) pass through unchanged.
 *
 * Plan: see `GpsPlusSlamJs_Docs/docs/2026-05-19-recording-loader-abstraction-plan.md`.
 */

import {
  loadActionsFromZip,
  loadSessionMetadata,
  loadEntriesFromSubdir,
  type RecordedAction,
  type ZipActionEntry,
  type ZipSource,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { migrateActionsIfNeeded } from './recording-migration';
import {
  isRefPointDefinition,
  type RefPointDefinition,
  type RefPointObservation,
} from './ref-point-loader';
import {
  createRecorderStore,
  type CombinedRootState,
} from '../state/recorder-store';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('RecordingLoader');

/**
 * Capability flags surfaced by the loader so callers can branch on what a
 * specific recording actually contains rather than guessing from filenames
 * or dates.
 */
interface RecordingCapabilities {
  /** True when at least one `refPoints/*.json` sidecar was present. */
  readonly hasSidecarRefPoints: boolean;
  /** True when at least one observation in `refPoints` carries `fusedGpsPoint`. */
  readonly hasFusedObservations: boolean;
  /** True when `session.json` was present in the zip. */
  readonly hasSessionMeta: boolean;
  /**
   * True when {@link migrateActionsIfNeeded} returned a different array
   * reference than the raw action list (i.e. the recording was actually
   * rewritten by the migration layer).
   */
  readonly migrationApplied: boolean;
}

/**
 * Fully-loaded recording. Independent of recording format / era.
 */
export interface LoadedRecording {
  /** Parsed session.json or null when the recording predates session metadata. */
  readonly meta: Record<string, unknown> | null;
  /** All actions in chronological order, after migration to the current schema. */
  readonly actions: readonly ZipActionEntry[];
  /** Unified ref points (sidecar ∪ action-derived, sidecar wins per id). */
  readonly refPoints: readonly RefPointDefinition[];
  /** What this recording actually contains — see {@link RecordingCapabilities}. */
  readonly capabilities: RecordingCapabilities;
  /**
   * Lazily replay the migrated actions into a fresh recorder store and return
   * the resulting state. Memoized: the second call returns the same instance.
   * Tests that don't need state pay nothing for it.
   */
  getFinalState(): CombinedRootState;
}

// ---------------------------------------------------------------------------
// Action-log payload helpers
// ---------------------------------------------------------------------------

interface MarkRefPointGpsPoint {
  readonly id?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude?: number;
  readonly latLongAccuracy?: number;
  readonly timestamp?: number;
}

interface MarkRefPointPayload {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly timestamp: number;
  /**
   * Post-migration, the `rawGpsPoint` field is always present (eras 1–3 are
   * renamed by the migration layer). Pre-migration, era ≤ 3 used `gpsPoint`
   * instead, but the loader only inspects post-migration actions so we
   * only need to read `rawGpsPoint` here.
   */
  readonly rawGpsPoint?: MarkRefPointGpsPoint;
  readonly gpsPoint?: MarkRefPointGpsPoint;
}

/**
 * Narrow a {@link RecordedAction} to a well-formed `markReferencePoint`.
 *
 * The pose arrays are validated for length, not just array-ness: `position`
 * is a {@link Vector3} (3 elements) and `rotation` a {@link Quaternion} (4
 * elements). Without the length guard a short array would slip through and
 * {@link buildDefsFromActions} would write `undefined` into the typed number
 * tuples (`payload.position[2]`, `payload.rotation[3]`), corrupting every
 * downstream consumer of the observation's `arPose`.
 *
 * Exported for direct unit testing of this boundary contract.
 */
export function isMarkRefPointAction(
  a: RecordedAction
): a is RecordedAction & { payload: MarkRefPointPayload } {
  if (a.type !== 'gpsData/markReferencePoint') return false;
  const p = a.payload as Partial<MarkRefPointPayload> | undefined;
  return (
    typeof p?.id === 'string' &&
    Array.isArray(p.position) &&
    p.position.length >= 3 &&
    Array.isArray(p.rotation) &&
    p.rotation.length >= 4 &&
    typeof p.timestamp === 'number'
  );
}

/**
 * Select the GPS point for a `markReferencePoint` payload, or `null` when no
 * usable point is present.
 *
 * Beyond picking the canonical post-migration field (`rawGpsPoint`, with
 * `gpsPoint` as a defensive fallback for callers that bypass migration), this
 * rejects points whose `latitude`/`longitude` are not finite numbers. The
 * migration layer drops such points only when it synthesizes
 * `refPoints/addRefPointEntry` actions — but {@link buildDefsFromActions}
 * reconstructs ref points directly from the preserved
 * `gpsData/markReferencePoint` actions, bypassing that check. Without the
 * finiteness guard here a malformed mark would produce a
 * {@link RefPointDefinition} carrying `NaN`/`undefined` coordinates that later
 * feed the H3 matcher and `selectKnownAnchorsByCell`. Returning `null` makes
 * {@link buildDefsFromActions} skip the action via its existing
 * `if (!gps) continue;` path.
 *
 * Exported for direct unit testing of this boundary contract.
 */
export function pickGpsPoint(
  payload: MarkRefPointPayload
): MarkRefPointGpsPoint | null {
  // Post-migration the canonical field is `rawGpsPoint`. Accept either to
  // stay resilient if a caller bypasses migration (which we still defensively
  // fold-in by also checking `gpsPoint`).
  const gps = payload.rawGpsPoint ?? payload.gpsPoint ?? null;
  if (!gps) return null;
  if (!Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
    return null;
  }
  return gps;
}

// ---------------------------------------------------------------------------
// Sidecar reading
// ---------------------------------------------------------------------------

async function readSidecarRefPoints(
  zip: ZipSource
): Promise<RefPointDefinition[]> {
  const entries = await loadEntriesFromSubdir(zip, 'refPoints');
  const defs: RefPointDefinition[] = [];
  for (const entry of entries) {
    if (!entry.relativePath.endsWith('.json')) continue;
    try {
      const text = await entry.getText();
      const parsed: unknown = JSON.parse(text);
      // Deep validation (not just the top-level shape): rejects sidecars
      // whose observations are malformed so downstream consumers such as
      // `flattenRefPointsToMarks` never read `obs.arPose.position` /
      // `obs.gpsPoint.latitude` off undefined.
      if (isRefPointDefinition(parsed)) {
        defs.push(parsed);
      } else {
        log.warn(
          `Skipping "${entry.fullPath}": invalid RefPointDefinition shape`
        );
      }
    } catch (err) {
      log.warn(`Skipping "${entry.fullPath}": parse error`, err);
    }
  }
  return defs;
}

// ---------------------------------------------------------------------------
// Action-log → RefPointDefinition reconstruction (legacy fallback)
// ---------------------------------------------------------------------------

function inferSessionId(
  actions: readonly ZipActionEntry[],
  meta: Record<string, unknown> | null
): string {
  for (const { action } of actions) {
    if (action.type === 'recording/startSession') {
      const p = action.payload as
        { sessionName?: unknown; scenarioName?: unknown } | undefined;
      if (typeof p?.sessionName === 'string' && p.sessionName.length > 0) {
        return p.sessionName;
      }
    }
  }
  if (meta) {
    // session.json doesn't carry a sessionName explicitly; fall back to a
    // stable token derived from start time + scenario when available.
    const started = meta['startedAt'];
    const ctx = meta['contextTag'];
    if (typeof started === 'string' && typeof ctx === 'string') {
      return `${ctx}-${started}`;
    }
  }
  return 'legacy-session';
}

function buildDefsFromActions(
  actions: readonly ZipActionEntry[],
  sessionId: string
): RefPointDefinition[] {
  const defsById = new Map<string, RefPointDefinition>();
  for (const { action } of actions) {
    if (!isMarkRefPointAction(action)) continue;
    const payload = action.payload;
    const gps = pickGpsPoint(payload);
    if (!gps) continue;
    const observation: RefPointObservation = {
      sessionId,
      timestamp: payload.timestamp,
      arPose: {
        position: [
          payload.position[0],
          payload.position[1],
          payload.position[2],
        ],
        rotation: [
          payload.rotation[0],
          payload.rotation[1],
          payload.rotation[2],
          payload.rotation[3],
        ],
      },
      gpsPoint: {
        id: gps.id ?? payload.id,
        latitude: gps.latitude,
        longitude: gps.longitude,
        altitude: gps.altitude,
        latLongAccuracy: gps.latLongAccuracy,
        timestamp: gps.timestamp ?? payload.timestamp,
      } as RefPointObservation['gpsPoint'],
    };
    const existing = defsById.get(payload.id);
    if (existing) {
      existing.observations.push(observation);
    } else {
      defsById.set(payload.id, {
        id: payload.id,
        // Legacy log carries no human-readable name; fall back to id.
        name: payload.id,
        createdAt: payload.timestamp,
        observations: [observation],
      });
    }
  }
  return [...defsById.values()];
}

// ---------------------------------------------------------------------------
// Merge sidecar + action-derived (sidecar wins per id)
// ---------------------------------------------------------------------------

function mergeRefPoints(
  sidecar: readonly RefPointDefinition[],
  actionDerived: readonly RefPointDefinition[]
): RefPointDefinition[] {
  const byId = new Map<string, RefPointDefinition>();
  // Action-derived first; sidecar overwrites by id below.
  for (const d of actionDerived) byId.set(d.id, d);
  for (const d of sidecar) byId.set(d.id, d);
  return [...byId.values()];
}

function hasFusedObservation(defs: readonly RefPointDefinition[]): boolean {
  for (const d of defs) {
    for (const o of d.observations) {
      if (o.fusedGpsPoint) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a recording zip end-to-end, hiding format evolution from callers.
 *
 * @param zip Recording zip bytes, or any zip.js Reader (e.g. a ranged reader
 *   over a file descriptor) for lazy access to large archives. The Reader is
 *   shared by three concurrent zip helpers (Promise.all below), so it must
 *   have an idempotent `init()` and support interleaved ranged reads; the
 *   caller owns its resource lifecycle and may release it as soon as this
 *   promise settles (`getFinalState()` never re-reads the zip). Runtime
 *   support for Readers requires a framework version exporting `toZipReader`
 *   from `storage/zip-reader` — external callers resolving the framework
 *   from npm should probe for it (see the Investigation project's
 *   `loadRecordingFromDisk`).
 * @returns A normalized {@link LoadedRecording}.
 */
export async function loadRecording(zip: ZipSource): Promise<LoadedRecording> {
  const [rawEntries, meta, sidecarDefs] = await Promise.all([
    loadActionsFromZip(zip),
    loadSessionMetadata(zip),
    readSidecarRefPoints(zip),
  ]);

  const rawActions = rawEntries.map((e) => e.action);
  const migratedActions = migrateActionsIfNeeded(rawActions, meta);
  const migrationApplied = migratedActions !== rawActions;
  const actions: ZipActionEntry[] = rawEntries.map((e, i) => ({
    ...e,
    action: migratedActions[i]!,
  }));

  const sessionId = inferSessionId(actions, meta);
  const actionDerived = buildDefsFromActions(actions, sessionId);
  const refPoints = mergeRefPoints(sidecarDefs, actionDerived);

  const capabilities: RecordingCapabilities = {
    hasSidecarRefPoints: sidecarDefs.length > 0,
    hasFusedObservations: hasFusedObservation(refPoints),
    hasSessionMeta: meta !== null,
    migrationApplied,
  };

  let cachedState: CombinedRootState | null = null;
  const getFinalState = (): CombinedRootState => {
    if (cachedState) return cachedState;
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
      enableDevChecks: false,
    });
    for (const { action } of actions) {
      store.dispatch(action);
    }
    cachedState = store.getState();
    return cachedState;
  };

  return {
    meta,
    actions,
    refPoints,
    capabilities,
    getFinalState,
  };
}
