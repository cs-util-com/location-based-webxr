/**
 * AbsoluteOrientationSensor capture (Generic Sensor API).
 *
 * Phase 1 of the AbsoluteOrientationSensor plan
 * (GpsPlusSlamJs_Docs/docs/2026-06-25-0543-absolute-orientation-sensor-plan.md §5.1):
 * passive instrumentation that fuses accelerometer + gyroscope + magnetometer
 * into an Earth-referenced (ENU) quaternion, captured per GPS event as an
 * independent north reference. No production behaviour change.
 *
 * Platform: Chrome Android only. Safari / Firefox / desktop / iOS lack the
 * sensor → this module degrades to a clean, reported no-op.
 *
 * The raw `'device'` reference frame is recorded together with the screen angle
 * so either the device- or screen-compensated form can be reconstructed offline
 * (plan §8 Q1).
 */

import { createLogger } from '../utils/logger';

const log = createLogger('AbsCompass');

/** Sensor frequency (Hz). We only snapshot at GPS rate, so low is fine (plan §8 Q4). */
const SENSOR_FREQUENCY_HZ = 20;

/** A single absolute-orientation reading, snapshotted into the GPS event payload. */
export interface AbsoluteOrientationReading {
  /** [x,y,z,w] quaternion mapping device-frame → Earth ENU (+X East, +Y North, +Z Up). */
  quaternion: [number, number, number, number];
  /** Reference frame the quaternion is expressed in. We record raw 'device'. */
  referenceFrame: 'device' | 'screen';
  /** screen.orientation.angle at sample time — needed to reconstruct the 'device' frame. */
  screenAngleDeg: number;
  /** Capture time (epoch ms) — pairs with the GPS event; lets warm-up be detected offline. */
  timestamp: number;
}

/** Lifecycle status surfaced to the caller (HUD/observability). */
export type AbsoluteOrientationStatus =
  | { state: 'active' }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; reason: string };

// --- Minimal ambient typing for the non-standard Generic Sensor API ---------
interface AbsoluteOrientationSensorLike {
  quaternion: ArrayLike<number> | null;
  start(): void;
  stop(): void;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
}
type AbsoluteOrientationSensorCtor = new (options?: {
  frequency?: number;
  referenceFrame?: 'device' | 'screen';
}) => AbsoluteOrientationSensorLike;

interface SensorErrorLike {
  error?: { name?: string };
}

let sensor: AbsoluteOrientationSensorLike | null = null;
let latest: AbsoluteOrientationReading | null = null;
// Monotonic token incremented by every start AND every stop. A start captures
// its token after the initial stop, then re-checks it after the async
// permission gate: if a stop/restart landed in between, the token no longer
// matches and the stale start aborts instead of installing a sensor teardown
// no longer owns.
let watchGeneration = 0;
// True from a start until the next stop, whatever the start's outcome
// (pending, active, unavailable, error). `ensureAbsoluteOrientationWatch`
// reads it so a default start never restarts a watch an app already owns.
let watchRequested = false;

function getSensorCtor(): AbsoluteOrientationSensorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as Record<string, unknown>)
    .AbsoluteOrientationSensor;
  return typeof ctor === 'function'
    ? (ctor as AbsoluteOrientationSensorCtor)
    : null;
}

/** True when the sensor can plausibly run here (secure context + API present). */
export function isAbsoluteOrientationAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    getSensorCtor() !== null
  );
}

function currentScreenAngleDeg(): number {
  if (typeof screen === 'undefined') return 0;
  const angle = (screen as Screen & { orientation?: { angle?: number } })
    .orientation?.angle;
  return typeof angle === 'number' ? angle : 0;
}

/**
 * Whether all three underlying sensors are granted-or-promptable (plan §5.1).
 * Returns `true` when the Permissions API is absent (best-effort — let the
 * sensor constructor surface any real denial), and treats a failed individual
 * query as `'granted'` for the same reason.
 */
async function sensorPermissionsUsable(): Promise<boolean> {
  const permissions = navigator.permissions;
  if (!permissions || typeof permissions.query !== 'function') return true;
  const queryState = async (name: string): Promise<PermissionState> => {
    // Some browsers/webviews throw a SYNCHRONOUS TypeError for an unsupported
    // permission name (e.g. 'magnetometer') instead of rejecting the promise.
    // Wrapping the call (not just chaining `.catch`) keeps the best-effort
    // 'granted' fallback for both the sync-throw and async-rejection cases, so
    // an unsupported name never aborts the whole watch — the constructor still
    // surfaces any real denial.
    try {
      const p = await permissions.query({ name: name as PermissionName });
      return p.state;
    } catch {
      return 'granted';
    }
  };
  const states = await Promise.all(
    ['accelerometer', 'gyroscope', 'magnetometer'].map(queryState)
  );
  return states.every((s) => s === 'granted' || s === 'prompt');
}

/**
 * Start capturing absolute orientation. Idempotent (stops any prior watch first).
 *
 * On platforms without the sensor — or when permissions are denied — it reports
 * `unavailable`/`error` via `onStatus` and stays a no-op; the recorder keeps
 * working unchanged. Never throws.
 */
export async function startAbsoluteOrientationWatch(
  onStatus: (status: AbsoluteOrientationStatus) => void = () => {}
): Promise<void> {
  stopAbsoluteOrientationWatch();
  watchRequested = true;
  const myGeneration = watchGeneration;

  // `onStatus` is caller-supplied; an unguarded throw from it would reject
  // this promise (or surface as an uncaught error from the sensor event
  // listeners), breaking the documented "Never throws" contract. Isolate it —
  // a broken consumer status handler must not take the watch down (PR #124).
  const reportStatus = (status: AbsoluteOrientationStatus): void => {
    try {
      onStatus(status);
    } catch (err) {
      log.error('onStatus callback threw; continuing', err);
    }
  };

  const Ctor = getSensorCtor();
  if (!isAbsoluteOrientationAvailable() || Ctor === null) {
    reportStatus({
      state: 'unavailable',
      reason: 'no AbsoluteOrientationSensor / insecure context',
    });
    return;
  }

  try {
    // All three underlying sensors must be granted-or-promptable (plan §5.1).
    if (!(await sensorPermissionsUsable())) {
      reportStatus({
        state: 'unavailable',
        reason: 'sensor permission denied',
      });
      return;
    }

    // A stop()/restart may have landed while we awaited the permission gate.
    // Bail before installing anything if this start has been superseded.
    if (myGeneration !== watchGeneration) return;

    // Decision Q1: record the RAW device frame + screen angle.
    const created = new Ctor({
      frequency: SENSOR_FREQUENCY_HZ,
      referenceFrame: 'device',
    });
    sensor = created;

    // Each listener drops events from a SUPERSEDED instance: after a
    // stop()/restart the old sensor's queued events can still fire (the spec
    // does not guarantee listener removal on stop), and writing their stale
    // data into `latest` or emitting their status would leak the previous
    // session into the current one. `created === sensor` only holds while this
    // exact instance is the live one.
    created.addEventListener('reading', () => {
      if (created !== sensor) return;
      const q = created.quaternion;
      if (!q || q.length < 4) return;
      const x = q[0];
      const y = q[1];
      const z = q[2];
      const w = q[3];
      // Narrow under noUncheckedIndexedAccess (q[i] is number | undefined).
      if (
        x === undefined ||
        y === undefined ||
        z === undefined ||
        w === undefined
      ) {
        return;
      }
      latest = {
        quaternion: [x, y, z, w],
        referenceFrame: 'device',
        screenAngleDeg: currentScreenAngleDeg(),
        timestamp: Date.now(),
      };
    });
    created.addEventListener('activate', () => {
      if (created !== sensor) return;
      log.info('active');
      reportStatus({ state: 'active' });
    });
    created.addEventListener('error', (event?: unknown) => {
      if (created !== sensor) return;
      latest = null;
      const reason =
        (event as SensorErrorLike | undefined)?.error?.name ?? 'SensorError';
      log.error('sensor error:', reason);
      reportStatus({ state: 'error', reason });
    });

    created.start();
  } catch (err) {
    sensor = null;
    latest = null;
    const reason = (err as Error)?.name ?? String(err);
    reportStatus({ state: 'error', reason });
  }
}

/**
 * Start the watch only if none was requested since the last stop; otherwise
 * a no-op that leaves the running (or pending, or unavailable) watch, its
 * cached reading and its `onStatus` callback untouched. This is the start
 * `createGpsPositionHandler` uses by default (compass cold start, D30), so
 * an app that started the watch itself, e.g. with a HUD status callback, is
 * never restarted underneath. An unavailable platform is not retried until
 * an explicit stop. Never throws.
 */
export function ensureAbsoluteOrientationWatch(
  onStatus?: (status: AbsoluteOrientationStatus) => void
): Promise<void> {
  if (watchRequested) return Promise.resolve();
  return startAbsoluteOrientationWatch(onStatus);
}

/** Latest reading, or null when unavailable/not-yet-warmed-up. Mirrors getLastDeviceOrientation. */
export function getLatestAbsoluteOrientation(): AbsoluteOrientationReading | null {
  return latest;
}

/** Stop the watch and clear cached state. Idempotent. */
export function stopAbsoluteOrientationWatch(): void {
  // Invalidate any in-flight start awaiting its async permission gate.
  watchGeneration++;
  watchRequested = false;
  if (sensor) {
    try {
      sensor.stop();
    } catch {
      /* already stopped */
    }
    sensor = null;
  }
  latest = null;
}
