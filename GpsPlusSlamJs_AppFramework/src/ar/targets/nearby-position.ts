/**
 * The position source for the "nearby targets" kernel: turns the store's
 * GPS event series (device fixes and QR vote samples, each paired with the
 * AR odometry position at that moment) into the kernel's `fixes`,
 * `arPoses` and `newestFixAtMs`, trimmed to the look-back window H.
 *
 * The conversion runs once per (gpsEvents, alignment, zero) reference; each
 * call then finds the window start by binary search and slices, so a call
 * costs O(log n + window) whatever the session length. The live pose is read
 * on every call (it moves between fixes).
 *
 * @see nearby-position.ts.md
 */

import {
  calcRelativeCoordsInMeters,
  gpsPointSourceOf,
  GPS_POINT_SOURCE_DEVICE,
  webxrToNUE,
  type LatLong,
} from '../../core/index.js';
import { deviceAccuracySeriesM } from '../../state/position-precision.js';
import {
  firstIndexAtOrAfter,
  type ArPose,
  type Fix,
  type LivePose,
  type NearbyInput,
} from './nearby-targets.js';

/** The fields of a stored GPS point the source reads. */
export interface NearbyGpsPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly latLongAccuracy?: number | undefined;
  /** Epoch ms. */
  readonly timestamp: number;
  /** Absent means a device fix. */
  readonly source?: string;
}

/** The store's GPS event series: `odometryPositions[i]` (odom-NUE) is the
 *  AR position at the moment of `gpsPositions[i]`. */
export interface NearbyGpsEvents {
  readonly gpsPositions: readonly NearbyGpsPoint[];
  readonly odometryPositions: readonly (readonly number[])[];
}

export interface NearbyPositionSourceOptions {
  /** The current series, or null before any. */
  gpsEvents(): NearbyGpsEvents | null;
  /** The alignment (16 numbers, column-major, odom-NUE to GPS-world NUE)
   *  the app may use, or null: then each fix stands alone. */
  alignment(): ArrayLike<number> | null;
  /** The GPS-world origin, or null before the first fix. */
  zero(): LatLong | null;
  /** The live pose, read on every call. */
  live(): LivePose | null;
  /** The look-back H (ms): only samples at or after `nowMs - H` are kept. */
  readonly lookBackMs: number;
}

/** The kernel input fields the source fills. */
export type NearbyPosition = Pick<
  NearbyInput,
  'fixes' | 'newestFixAtMs' | 'arPoses' | 'live'
>;

export interface NearbyPositionSource {
  /** The series within `nowMs - lookBackMs`, plus the live pose. */
  position(nowMs: number): NearbyPosition;
}

interface Built {
  readonly fixes: readonly Fix[];
  readonly arPoses: readonly ArPose[];
  readonly newestFixAtMs: number | null;
}

const EMPTY: Built = { fixes: [], arPoses: [], newestFixAtMs: null };

/**
 * Creates the source.
 *
 * @throws RangeError when `lookBackMs` is not a positive finite number.
 */
export function createNearbyPositionSource(
  o: NearbyPositionSourceOptions
): NearbyPositionSource {
  if (!(Number.isFinite(o.lookBackMs) && o.lookBackMs > 0)) {
    throw new RangeError(
      `lookBackMs must be a positive finite number; got ${String(o.lookBackMs)}`
    );
  }
  let key: readonly unknown[] | null = null;
  let built: Built = EMPTY;
  return {
    position(nowMs) {
      if (!Number.isFinite(nowMs)) {
        throw new RangeError(`nowMs must be finite; got ${String(nowMs)}`);
      }
      const ev = o.gpsEvents();
      const alignment = o.alignment();
      const zero = o.zero();
      if (
        key === null ||
        key[0] !== ev ||
        key[1] !== alignment ||
        key[2] !== zero
      ) {
        key = [ev, alignment, zero];
        built = ev ? build(ev, usableAlignment(alignment), zero) : EMPTY;
      }
      const from = nowMs - o.lookBackMs;
      return {
        fixes: built.fixes.slice(firstIndexAtOrAfter(built.fixes, from)),
        arPoses: built.arPoses.slice(firstIndexAtOrAfter(built.arPoses, from)),
        newestFixAtMs: built.newestFixAtMs,
        live: o.live(),
      };
    },
  };
}

/** A WebXR position as odom-NUE, or null when it is missing or not finite. */
export function odomNueOfWebXr(
  p:
    | { readonly x: number; readonly y: number; readonly z: number }
    | null
    | undefined
): [number, number, number] | null {
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
  const v = webxrToNUE([p.x, p.y, p.z]);
  return [v[0], v[1], v[2]];
}

interface Row {
  readonly t: number;
  readonly point: NearbyGpsPoint;
  readonly odom: readonly [number, number, number] | null;
  readonly device: boolean;
}

function build(
  ev: NearbyGpsEvents,
  alignment: ArrayLike<number> | null,
  zero: LatLong | null
): Built {
  // Each series is read once: a getter-backed store value is not re-read.
  const gps: unknown = ev.gpsPositions;
  const odo: unknown = ev.odometryPositions;
  const points = Array.isArray(gps) ? (gps as readonly NearbyGpsPoint[]) : [];
  const odoms = Array.isArray(odo) ? (odo as readonly unknown[]) : [];
  const rows: Row[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point || !Number.isFinite(point.timestamp)) continue;
    rows.push({
      t: point.timestamp,
      point,
      odom: finite3(odoms[i]),
      device: gpsPointSourceOf(point) === GPS_POINT_SOURCE_DEVICE,
    });
  }
  // Stored in arrival order; sorted defensively (stable) for the search.
  rows.sort((a, b) => a.t - b.t);

  const devices = rows.filter((r) => r.device);
  const accs = deviceAccuracySeriesM(devices.map((r) => r.point));
  const fixes: Fix[] = [];
  let newestFixAtMs: number | null = null;
  devices.forEach((r, i) => {
    if (
      Number.isFinite(r.point.latitude) &&
      Number.isFinite(r.point.longitude)
    ) {
      newestFixAtMs = r.t;
    }
    const fix = fixOf(r, accs[i] ?? null, alignment, zero);
    if (fix) fixes.push(fix);
  });

  const arPoses: ArPose[] = [];
  for (const r of rows) {
    if (r.odom) arPoses.push({ t: r.t, pos: r.odom, device: r.device });
  }
  return { fixes, arPoses, newestFixAtMs };
}

/** One device sample as a fix, or null when it cannot be judged. */
function fixOf(
  r: Row,
  median: number | null,
  alignment: ArrayLike<number> | null,
  zero: LatLong | null
): Fix | null {
  if (median === null) return null;
  if (alignment) {
    if (!r.odom) return null;
    const [x, y, z] = r.odom;
    const m = (i: number) => alignment[i]!;
    return {
      t: r.t,
      north: m(0) * x + m(4) * y + m(8) * z + m(12),
      east: m(2) * x + m(6) * y + m(10) * z + m(14),
      accM: median,
    };
  }
  const { latitude, longitude, latLongAccuracy: own } = r.point;
  if (!zero || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const nue = calcRelativeCoordsInMeters(
    zero,
    { lat: latitude, lon: longitude },
    0,
    0
  );
  const ownOk = typeof own === 'number' && Number.isFinite(own) && own > 0;
  return {
    t: r.t,
    north: nue[0],
    east: nue[2],
    accM: ownOk ? Math.max(median, own) : median,
  };
}

function usableAlignment(
  m: ArrayLike<number> | null
): ArrayLike<number> | null {
  if (!m || typeof m.length !== 'number' || m.length < 16) return null;
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(m[i])) return null;
  }
  return m;
}

function finite3(v: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [a, b, c] = v as unknown[];
  return typeof a === 'number' &&
    typeof b === 'number' &&
    typeof c === 'number' &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Number.isFinite(c)
    ? [a, b, c]
    : null;
}
