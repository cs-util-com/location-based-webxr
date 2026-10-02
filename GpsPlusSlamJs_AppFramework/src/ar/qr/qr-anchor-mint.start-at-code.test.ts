/**
 * The Recorder's QR mint when a recording STARTS AT THE CODE.
 *
 * Why this file matters: the M3a spike (Tour Viewer authoring plan,
 * `2026-10-01-0354-code-estimate-across-visits-results.md` Q2 and open
 * question 5) found that the Recorder's mint gets a code's heading badly
 * wrong (89 degrees p50) when a visit starts at the code, while the Tour
 * Viewer's settle, composing through the end-of-visit alignment, gets 5.0
 * degrees on the same visits. This file reproduces that at the mint's own
 * seam, in this package, against the REAL store and alignment solver of the
 * published `gps-plus-slam-js` (nothing about the solve is mocked), and holds
 * the measured spike that chose the fix.
 *
 * ONE RECORDING, deterministic per seed:
 * - Start Recording swaps the store, so the alignment starts from nothing;
 *   the author is standing 2 m in front of the code and looks at it for 4 s.
 * - Then two out-and-back line walks of `walkM` metres each (directions
 *   within 60 degrees of the face normal, away from the wall), each followed
 *   by a 4 s look from the same spot. `looks` (1-3) says how many of the
 *   three looks actually detected the code: 1 = seen only at the start.
 * - The mint runs once at the END of the recording (the zip contributor at
 *   save), so the session's alignment has seen both walks by then.
 * - GPS at 1 Hz through `recordGpsEvent`: truth plus a Gauss-Markov wander
 *   (0.25 x accuracy, 60 s) and white noise (0.15 x accuracy), accuracy 5 m;
 *   a constant bias is left out because it moves the alignment and turns it
 *   by nothing (proven in the M3a fixture), so it cannot change a heading.
 * - Odometry: an arbitrary yaw and origin per recording, plus SLAM yaw drift
 *   of 1 degree per 100 m walked (random sign).
 * - Detections at ~8 Hz during a look with 3 % dropouts of 0.5-3 s; each look
 *   carries a systematic yaw error (`yawNoiseDeg` sigma) and each detection
 *   2 degrees of jitter. They go through the real sighting accumulator with
 *   the alignment as it stood at that detection (what the Recorder's
 *   `qr-sighting-feeder` snapshots).
 *
 * The same conventions as the M3a fixture
 * (`GpsPlusSlamJs_TourViewer/src/code-estimate-across-visits.test.ts`), whose
 * code-pose formula a sanity test below re-proves in this package.
 *
 * Default run: the sanity pin and the reproduction. The measured sweep of the
 * fix candidates is opt-in: `QR_MINT_START_AT_CODE_SWEEP=1`.
 *
 * Measured result (2026-10-02; 40 recordings per cell, walks 15/30/60/120 m,
 * 1-3 looks, yaw noise 1/3/5 degrees; heading p50 / p90, horizontal p50):
 * - pre-fix (each sighting through its own alignment, DEC-3): 72 / 158-161
 *   degrees whenever the code was seen in only 1 or 2 looks, at every walk
 *   length and yaw noise; with 3 looks 0.7-11 p50 but p90 up to 146 at
 *   15 m. Position 2.9 m for a code seen only at the start, 1.4-1.7 m with
 *   2 looks at walks of 30 m or less, 1.3 m otherwise.
 * - (a2) every sighting through the alignment at mint time (SHIPPED, the
 *   owner retiring DEC-3): 1.0-4.9 / 3-10 degrees from 30 m walks up, 7-10
 *   / 12-17 at 15 m, for 1, 2 or 3 looks; position 1.3-1.4 m in every cell.
 *   Its cost: with 3 looks the heading p50 is up to 0.6 degrees worse at
 *   60 m and 2.7 at 15 m (one final alignment instead of an average over
 *   three), against a p90 that drops from 121-146 to 12-14 at 15 m. The
 *   recency weighting left from DEC-3 changes nothing here: with a 1e9 s
 *   half-life every cell is the same to 0.1 m and 0.1 degrees.
 * - (a1) the newest sighting's alignment (the mint without
 *   `currentAlignment`): fixes 2-3 looks; 72 degrees and 3.0 m with 1.
 * - (b) dropping sightings with an immature alignment (10 or 30 samples, or
 *   10 or 20 m of GPS extent): refuses 100 % of start-only codes; otherwise
 *   about (a1).
 * - (c) weighting the rotation by sample count: 5-15 p50 with 2 looks, 72
 *   with 1; by recency (60 s half-life): 19-37 with 2 looks.
 * - Refusals: 5-10 % at 5 degrees of yaw noise (the fixedness gate) for
 *   every candidate; 3 % of start-only codes for (a1) and the pre-fix mint
 *   (cause not traced), 0 % for (a2).
 */

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  recordGpsEvent,
  setZeroPos,
  type LatLong,
  type Quaternion,
  type Vector3,
} from 'gps-plus-slam-js';
import { createSlamAppStore } from '../../state/create-slam-app-store.js';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
} from '../../state/app-selectors.js';
import { NullStorageBackend } from '../../storage/null-storage-backend.js';
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type Matrix4 as AlignmentMatrix,
} from '../../core/index.js';
import { mintQrAnchorFromSightings } from './qr-anchor-mint.js';
import { qrWorldPoseFromOdom } from './qr-mint-level.js';
import { averageRotation } from './qr-pose-aggregation.js';
import { mintQrGeoPose } from './qr-geo-pose-minting.js';
import { weightedMedian } from '../../utils/median.js';
import {
  createQrSightingAccumulator,
  type QrSighting,
  type QrSightingObservation,
} from './qr-sighting-accumulator.js';
import type { Pose } from './qr-pose.js';

// The library gates its geodesy helpers on a licence the framework store
// activates; build one before any geodesy runs.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

// ---------------------------------------------------------------------------
// Scenario constants. World frame: NUE metres relative to ORIGIN, Up =
// absolute altitude.
// ---------------------------------------------------------------------------

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const GROUND_ALT = 400;
const PHONE_ALT = 401.4;
/** Local +X points east, so the printed face looks south (normal 180). */
const CODE_HEADING_DEG = 90;
const CODE_NORMAL_DEG = CODE_HEADING_DEG + 90;
const CODE_WORLD: Vector3 = [0, 401.5, 0];
const CODE_TEXT = 'https://example.invalid/?qr=start-at-code';
const CODE_SIZE_M = 0.16;
const STAND: NE = [-2, 0];
const WALK_SPEED_MPS = 1.2;
const LOOK_S = 4;
const DETECTION_INTERVAL_MS = 125;
const ACCURACY_M = 5;
const IDENTITY_Q: Quaternion = [0, 0, 0, 1];

type NE = readonly [number, number];

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** Signed angle difference in (-180, 180]. */
const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Rotation about Up (NUE y) by `a` radians. */
function rotY(a: number, v: Vector3): Vector3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}
const yawQuat = (a: number): Quaternion => [
  0,
  Math.sin(a / 2),
  0,
  Math.cos(a / 2),
];
/** Inverse of the library's `webxrToNUE` ([-z, y, x]). */
const nueToWebxr = (v: Vector3): Vector3 => [v[2], v[1], -v[0]];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
const stream = (seed: number, purpose: number): (() => number) =>
  mulberry32(seed * 7919 + purpose * 104_729);

// ---------------------------------------------------------------------------
// One recording: the timeline, the odometry frame, the GPS, the solve.
// ---------------------------------------------------------------------------

interface RecordingSpec {
  readonly seed: number;
  /** Length of EACH out-and-back walk (m): the convergence-time lever. */
  readonly walkM: number;
  /** GPS noise off and drift off: the sanity pin's exact inputs. */
  readonly exact?: boolean;
}

interface Waypoint {
  readonly tS: number;
  readonly at: NE;
  /** Distance walked by `tS` (m). */
  readonly walkedM: number;
}

interface FixSnapshot {
  readonly tS: number;
  readonly alignment: AlignmentMatrix | null;
  readonly sampleCount: number;
  /** Largest horizontal distance between two GPS fixes so far (m). */
  readonly gpsExtentM: number;
}

interface Recording {
  readonly spec: RecordingSpec;
  readonly zero: LatLong;
  readonly fixes: readonly FixSnapshot[];
  readonly looks: readonly (readonly [number, number])[];
  readonly endS: number;
  readonly yaw0: number;
  readonly t0: Vector3;
  readonly yawSign: number;
  readonly waypoints: readonly Waypoint[];
}

function timeline(spec: RecordingSpec): {
  waypoints: Waypoint[];
  looks: [number, number][];
  endS: number;
} {
  const rng = stream(spec.seed, 1);
  const waypoints: Waypoint[] = [{ tS: 0, at: STAND, walkedM: 0 }];
  const looks: [number, number][] = [[0.5, 0.5 + LOOK_S]];
  let t = 0.5 + LOOK_S + 0.5;
  let walked = 0;
  waypoints.push({ tS: t, at: STAND, walkedM: walked });
  for (let walk = 0; walk < 2; walk += 1) {
    // Away from the wall: within 60 degrees of the face normal.
    const phi = rad(CODE_NORMAL_DEG + (rng() * 120 - 60));
    const half = spec.walkM / 2;
    const far: NE = [
      STAND[0] + half * Math.cos(phi),
      STAND[1] + half * Math.sin(phi),
    ];
    t += half / WALK_SPEED_MPS;
    walked += half;
    waypoints.push({ tS: t, at: far, walkedM: walked });
    t += half / WALK_SPEED_MPS;
    walked += half;
    waypoints.push({ tS: t, at: STAND, walkedM: walked });
    looks.push([t + 0.5, t + 0.5 + LOOK_S]);
    t += 0.5 + LOOK_S + 0.5;
    waypoints.push({ tS: t, at: STAND, walkedM: walked });
  }
  return { waypoints, looks, endS: t };
}

function phoneAt(
  waypoints: readonly Waypoint[],
  tS: number
): { at: NE; walkedM: number } {
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    if (tS <= b.tS) {
      const f = b.tS > a.tS ? Math.max(0, (tS - a.tS) / (b.tS - a.tS)) : 1;
      return {
        at: [
          a.at[0] + f * (b.at[0] - a.at[0]),
          a.at[1] + f * (b.at[1] - a.at[1]),
        ],
        walkedM: a.walkedM + f * (b.walkedM - a.walkedM),
      };
    }
  }
  const last = waypoints[waypoints.length - 1]!;
  return { at: last.at, walkedM: last.walkedM };
}

const DRIFT_DEG_PER_100M = 1;

/** The odometry frame at `tS`: world = Ry(yaw) . odomNue + t0. */
function frameYaw(rec: Omit<Recording, 'fixes' | 'zero'>, tS: number): number {
  if (rec.spec.exact === true) return rec.yaw0;
  const walked = phoneAt(rec.waypoints, tS).walkedM;
  return rec.yaw0 + rec.yawSign * rad(DRIFT_DEG_PER_100M) * (walked / 100);
}

function odomNueAt(
  rec: Omit<Recording, 'fixes' | 'zero'>,
  world: Vector3,
  tS: number
): Vector3 {
  return rotY(-frameYaw(rec, tS), [
    world[0] - rec.t0[0],
    world[1] - rec.t0[1],
    world[2] - rec.t0[2],
  ]);
}

function gpsErrors(spec: RecordingSpec, count: number): NE[] {
  if (spec.exact === true) return Array.from({ length: count }, () => [0, 0]);
  const rng = stream(spec.seed, 2);
  const s = 0.25 * ACCURACY_M;
  const w = 0.15 * ACCURACY_M;
  const rho = Math.exp(-1 / 60);
  const k = Math.sqrt(1 - rho * rho);
  let gm: [number, number] = [s * gaussian(rng), s * gaussian(rng)];
  const out: NE[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0)
      gm = [
        rho * gm[0] + k * s * gaussian(rng),
        rho * gm[1] + k * s * gaussian(rng),
      ];
    out.push([gm[0] + w * gaussian(rng), gm[1] + w * gaussian(rng)]);
  }
  return out;
}

/** Run one recording's GPS through the real store; snapshot after each fix. */
function runRecording(spec: RecordingSpec): Recording {
  const { waypoints, looks, endS } = timeline(spec);
  const rng = stream(spec.seed, 3);
  const frame = {
    spec,
    looks,
    endS,
    waypoints,
    yaw0: rng() * 2 * Math.PI,
    t0: [
      STAND[0] + gaussian(rng) * 0.3,
      GROUND_ALT,
      STAND[1] + gaussian(rng) * 0.3,
    ] as Vector3,
    yawSign: rng() < 0.5 ? -1 : 1,
  };
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    // The dev middlewares re-walk the growing GPS slice on every fix and
    // only cost time here; the reducers and the solver are the same.
    enableDevChecks: false,
  });
  const errors = gpsErrors(spec, Math.floor(endS) + 1);
  const fixes: FixSnapshot[] = [];
  const measuredSoFar: NE[] = [];
  let extent = 0;
  let zero: LatLong | null = null;
  errors.forEach((err, i) => {
    const pos = phoneAt(waypoints, i).at;
    const truth: Vector3 = [pos[0], PHONE_ALT, pos[1]];
    const measured: Vector3 = [truth[0] + err[0], truth[1], truth[2] + err[1]];
    for (const m of measuredSoFar) {
      extent = Math.max(
        extent,
        Math.hypot(m[0] - measured[0], m[1] - measured[2])
      );
    }
    measuredSoFar.push([measured[0], measured[2]]);
    const ll = calcGpsCoords(ORIGIN, measured);
    if (zero === null) {
      zero = ll;
      store.dispatch(setZeroPos(ll));
    }
    store.dispatch(
      recordGpsEvent({
        odomPosition: nueToWebxr(odomNueAt(frame, truth, i)),
        odomRotation: IDENTITY_Q,
        rawGpsPoint: {
          id: `gps-${String(i)}`,
          latitude: ll.lat,
          longitude: ll.lon,
          altitude: measured[1],
          latLongAccuracy: ACCURACY_M,
          timestamp: EPOCH_MS + i * 1000,
        },
      })
    );
    const a = selectAlignmentMatrix(store.getState());
    fixes.push({
      tS: i,
      // Store state is immutable, so the reference is a snapshot.
      alignment: a,
      sampleCount: selectGpsPositions(store.getState()).length,
      gpsExtentM: extent,
    });
  });
  if (zero === null) throw new Error('a recording needs at least one fix');
  return { ...frame, zero, fixes };
}

function fixAt(rec: Recording, tS: number): FixSnapshot | null {
  let found: FixSnapshot | null = null;
  for (const fix of rec.fixes) {
    if (fix.tS > tS) break;
    found = fix;
  }
  return found;
}

// ---------------------------------------------------------------------------
// The code as the camera sees it, folded the way the Recorder folds it.
// ---------------------------------------------------------------------------

interface LookNoise {
  readonly yawNoiseDeg: number;
  readonly detYawDeg: number;
  readonly detPosM: number;
}

function codePoseAt(rec: Recording, tS: number, yawErrDeg: number): Pose {
  return {
    position: nueToWebxr(odomNueAt(rec, CODE_WORLD, tS)),
    rotation: yawQuat(
      Math.PI / 2 - frameYaw(rec, tS) - rad(CODE_HEADING_DEG) + rad(yawErrDeg)
    ),
  };
}

/** One look's detections: a systematic yaw per look, jitter per detection,
 *  ~8 Hz with 3 % dropouts of 0.5-3 s. */
function lookDetections(
  rec: Recording,
  look: number,
  noise: LookNoise,
  rng: () => number
): { tS: number; pose: Pose }[] {
  const [from, to] = rec.looks[look]!;
  const lookYaw = noise.yawNoiseDeg * gaussian(rng);
  const out: { tS: number; pose: Pose }[] = [];
  for (let t = from; t <= to;) {
    const pose = codePoseAt(rec, t, lookYaw + noise.detYawDeg * gaussian(rng));
    out.push({
      tS: t,
      pose: {
        position: [
          pose.position[0] + noise.detPosM * gaussian(rng),
          pose.position[1],
          pose.position[2] + noise.detPosM * gaussian(rng),
        ],
        rotation: pose.rotation,
      },
    });
    t += rng() < 0.03 ? 0.5 + rng() * 2.5 : DETECTION_INTERVAL_MS / 1000;
  }
  return out;
}

/** The Recorder's sightings of the code, seen during looks
 *  `firstLook`..`looks - 1`. Every look draws its noise, used or not, so
 *  the noise of a look does not depend on which looks are kept. */
function recordedSightings(
  rec: Recording,
  looks: number,
  noise: LookNoise,
  noiseSeed: number,
  firstLook = 0
): { sightings: QrSighting[]; extentAt: Map<number, number> } {
  const rng = stream(rec.spec.seed * 31 + noiseSeed, 4);
  const acc = createQrSightingAccumulator();
  const extentAt = new Map<number, number>();
  for (let look = 0; look < rec.looks.length; look += 1) {
    const detections = lookDetections(rec, look, noise, rng);
    if (look < firstLook || look >= looks) continue;
    for (const { tS, pose } of detections) {
      const seen = observationAt(rec, tS, pose);
      extentAt.set(seen.observation.timestamp, seen.gpsExtentM);
      acc.observe(seen.observation);
    }
  }
  return { sightings: [...acc.sightingsIncludingOpen(CODE_TEXT)], extentAt };
}

/** One detection as the Recorder's feeder folds it: the alignment as it
 *  stood at that moment (the last fix at or before it). */
function observationAt(
  rec: Recording,
  tS: number,
  pose: Pose
): { observation: QrSightingObservation; gpsExtentM: number } {
  const fix = fixAt(rec, tS);
  return {
    gpsExtentM: fix?.gpsExtentM ?? 0,
    observation: {
      text: CODE_TEXT,
      timestamp: EPOCH_MS + Math.round(tS * 1000),
      odomPose: pose,
      sizeM: CODE_SIZE_M,
      alignmentMatrix: fix?.alignment ?? null,
      zero: fix === null ? null : rec.zero,
      alignmentSampleCount: fix?.sampleCount ?? 0,
      gpsAccuracyM: ACCURACY_M,
    },
  };
}

// ---------------------------------------------------------------------------
// Errors against the truth.
// ---------------------------------------------------------------------------

function normalBearingDeg(q: Quaternion): number {
  // +z (out of the printed face) rotated by q, then the bearing of (N, E).
  const [x, y, z, w] = q;
  const nx = 2 * (x * z + w * y);
  const nz = 1 - 2 * (x * x + y * y);
  return deg(Math.atan2(nz, nx));
}

interface MintError {
  readonly headingDeg: number;
  readonly horizontalM: number;
}

function errorOfGeo(geo: {
  lat: number;
  lon: number;
  alt: number;
  rotation?: Quaternion;
}): MintError {
  const nue = calcRelativeCoordsInMeters(
    ORIGIN,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0
  );
  if (geo.rotation === undefined) throw new Error('the mint wrote no rotation');
  return {
    headingDeg: Math.abs(
      wrapDeg(normalBearingDeg(geo.rotation) - CODE_NORMAL_DEG)
    ),
    horizontalM: Math.hypot(nue[0] - CODE_WORLD[0], nue[2] - CODE_WORLD[2]),
  };
}

/** Production mint on these sightings: the error, or `null` when refused. */
function mintError(
  sightings: readonly QrSighting[],
  extra: Partial<Parameters<typeof mintQrAnchorFromSightings>[0]> = {}
): MintError | null {
  const result = mintQrAnchorFromSightings({
    sightings,
    spansFrameChange: false,
    nowIso: new Date(EPOCH_MS).toISOString(),
    ...extra,
  });
  if (!result.ok || !result.level.ok) return null;
  const geo = result.level.level.qr.geo;
  return geo === undefined ? null : errorOfGeo(geo);
}

/** The alignment at the END of the recording, where the contributor mints. */
function endAlignment(rec: Recording): FixSnapshot {
  const last = rec.fixes[rec.fixes.length - 1];
  if (last === undefined || last.alignment === null) {
    throw new Error('the recording never solved an alignment');
  }
  return last;
}

// ---------------------------------------------------------------------------
// Fix candidates, evaluated on the SAME sightings.
// ---------------------------------------------------------------------------

/** Weighted quaternion mean (sign-aligned to the heaviest, normalised). */
function weightedQuatMean(
  qs: readonly Quaternion[],
  ws: readonly number[]
): Quaternion {
  let ref = 0;
  ws.forEach((w, i) => {
    if (w > (ws[ref] ?? 0)) ref = i;
  });
  const r = qs[ref]!;
  const sum = [0, 0, 0, 0];
  qs.forEach((q, i) => {
    const w = ws[i] ?? 0;
    const sign =
      q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3] < 0 ? -1 : 1;
    for (let k = 0; k < 4; k += 1) sum[k]! += sign * w * q[k]!;
  });
  const n = Math.hypot(...sum);
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n, sum[3]! / n];
}

/** The pre-fix mint, re-stated so it stays measurable after the fix: each
 *  sighting through its OWN alignment (DEC-3), the position a median
 *  weighted by recency (60 s half-life), the rotation `averageRotation`. */
function preFixError(
  rec: Recording,
  sightings: readonly QrSighting[]
): MintError | null {
  const placed = sightings.filter(
    (s) => s.alignmentMatrix !== null && s.zero !== null
  );
  const worlds = placed.map((s) =>
    qrWorldPoseFromOdom(s.odomPose, s.alignmentMatrix!)
  );
  const lastAt = placed.at(-1)?.lastTimestamp ?? 0;
  const weights = placed.map(
    (s) => 1 / (1 + (lastAt - s.lastTimestamp) / 1000 / 60)
  );
  const rotation =
    averageRotation(worlds.map((w) => w.rotation))?.quat ??
    worlds.at(-1)?.rotation;
  if (rotation === undefined) return null;
  const median = (key: 'x' | 'y' | 'z'): number =>
    weightedMedian(
      worlds.map((w) => w.position[key]),
      weights
    );
  return errorOfGeo(
    mintQrGeoPose({
      worldNuePosition: { x: median('x'), y: median('y'), z: median('z') },
      worldNueRotation: rotation,
      zero: rec.zero,
    })
  );
}

/** (c) each sighting through its OWN alignment (DEC-3), the rotation
 *  averaged with the given weights. Heading only. */
function weightedOwnAlignmentHeadingDeg(
  sightings: readonly QrSighting[],
  weight: (s: QrSighting) => number
): number | null {
  const placed = sightings.filter((s) => s.alignmentMatrix !== null);
  if (placed.length === 0) return null;
  const worlds = placed.map((s) =>
    qrWorldPoseFromOdom(s.odomPose, s.alignmentMatrix!)
  );
  const q = weightedQuatMean(
    worlds.map((w) => w.rotation),
    placed.map(weight)
  );
  return Math.abs(wrapDeg(normalBearingDeg(q) - CODE_NORMAL_DEG));
}

// ---------------------------------------------------------------------------
// Statistics.
// ---------------------------------------------------------------------------

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const DEFAULT_NOISE: LookNoise = {
  yawNoiseDeg: 2,
  detYawDeg: 2,
  detPosM: 0.02,
};

// ---------------------------------------------------------------------------
// Always-run: the fixture is sound, and the reproduction.
// ---------------------------------------------------------------------------

describe('start-at-code fixture: the conventions are sound', () => {
  // Why this test matters: every number below rests on this file's code-pose
  // and frame conventions. With exact inputs and the code seen only AFTER
  // the alignment has matured (looks 2 and 3), the production mint must
  // recover the code's heading and position; if a convention were wrong by
  // a sign or a basis factor this would be off by tens of degrees.
  it('recovers the code with exact inputs and a mature alignment', () => {
    const rec = runRecording({ seed: 3, walkM: 40, exact: true });
    const { sightings } = recordedSightings(
      rec,
      3,
      { yawNoiseDeg: 0, detYawDeg: 0, detPosM: 0 },
      1,
      1
    );
    expect(sightings.length).toBe(2);
    const err = mintError(sightings);
    expect(err).not.toBeNull();
    expect(err!.headingDeg).toBeLessThan(1);
    expect(err!.horizontalM).toBeLessThan(0.5);
  });
});

describe('the Recorder mint when a recording starts at the code', () => {
  // Why this test matters: it is the M3a finding reproduced where the
  // heading is produced. A recording that starts at the code (the common
  // case: the author starts recording, scans the poster, walks) has its
  // first sighting composed through an alignment that has no walk behind
  // it, so its yaw is arbitrary. The minted heading must still be right,
  // because a later visitor relocalizes against it.
  const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
  /** The shipped mint (the alignment at the end of the recording passed as
   *  `currentAlignment`) on each seed's 30 m recording. */
  const shippedErrors = (looks: number): MintError[] =>
    SEEDS.map((seed) => {
      const rec = runRecording({ seed, walkM: 30 });
      const end = endAlignment(rec);
      const { sightings } = recordedSightings(rec, looks, DEFAULT_NOISE, 1);
      const err = mintError(sightings, {
        currentAlignment: {
          alignmentMatrix: end.alignment!,
          zero: rec.zero,
          alignmentSampleCount: end.sampleCount,
          gpsAccuracyM: ACCURACY_M,
          segment: 0,
        },
      });
      expect(err).not.toBeNull();
      return err!;
    });
  for (const looks of [2, 1]) {
    it(`mints a heading within 10 degrees p50 (${String(looks)} look(s), 30 m walks)`, () => {
      const errors = shippedErrors(looks).map((e) => e.headingDeg);
      expect(quantile(errors, 0.5)).toBeLessThan(10);
    });
  }

  // Why this test matters: the same defect, in metres. A code seen only as
  // the recording started was placed through an alignment fitted to a few
  // fixes taken standing still (2.9 m p50 on the sweep); through the
  // alignment at mint time it is 1.3 m. The owner retired DEC-3's
  // per-sighting composition for this on 2026-10-02.
  it('places a code seen only at the start within 2 m p50 (30 m walks)', () => {
    const errors = shippedErrors(1).map((e) => e.horizontalM);
    expect(quantile(errors, 0.5)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Opt-in: the measured spike of the fix candidates.
// ---------------------------------------------------------------------------

type CandidateError = MintError | number | null;

/** Every candidate's error on one recording's sightings (`null` = refused,
 *  a bare number = heading only). */
function candidateErrors(
  rec: Recording,
  sightings: readonly QrSighting[],
  extentAt: ReadonlyMap<number, number>
): [string, CandidateError][] {
  const end = endAlignment(rec);
  const current = {
    alignmentMatrix: end.alignment!,
    zero: rec.zero,
    alignmentSampleCount: end.sampleCount,
    segment: 0,
  };
  const kept = (keep: (s: QrSighting) => boolean): CandidateError => {
    const rest = sightings.filter(keep);
    return rest.length === 0 ? null : mintError(rest);
  };
  const lastAt = sightings.at(-1)?.lastTimestamp ?? 0;
  return [
    // The mint before the fix: every sighting through its OWN alignment
    // (DEC-3), recency-weighted median position, robust rotation average.
    ['pre-fix', preFixError(rec, sightings)],
    // (a1) = production without `currentAlignment`: the newest sighting's.
    ['a1 no current', mintError(sightings)],
    // (a2) = what shipped: the alignment at the end of the recording.
    ['a2 shipped', mintError(sightings, { currentAlignment: current })],
    // The same with the recency weighting made inert, to see whether the
    // part of DEC-3 that is left does anything.
    [
      'a2 flat',
      mintError(sightings, {
        currentAlignment: current,
        recencyHalfLifeS: 1e9,
      }),
    ],
    ['b n>=10', kept((s) => s.alignmentSampleCount >= 10)],
    ['b n>=30', kept((s) => s.alignmentSampleCount >= 30)],
    ['b ext>=10m', kept((s) => (extentAt.get(s.lastTimestamp) ?? 0) >= 10)],
    ['b ext>=20m', kept((s) => (extentAt.get(s.lastTimestamp) ?? 0) >= 20)],
    [
      'c w=samples',
      weightedOwnAlignmentHeadingDeg(sightings, (s) => s.alignmentSampleCount),
    ],
    [
      'c w=recency',
      weightedOwnAlignmentHeadingDeg(
        sightings,
        (s) => 1 / (1 + (lastAt - s.lastTimestamp) / 1000 / 60)
      ),
    ],
  ];
}

interface Column {
  readonly h: number[];
  readonly m: number[];
  refused: number;
}

function addTo(
  cols: Map<string, Column>,
  name: string,
  e: CandidateError
): void {
  const c = cols.get(name) ?? { h: [], m: [], refused: 0 };
  if (e === null) c.refused += 1;
  else if (typeof e === 'number') c.h.push(e);
  else {
    c.h.push(e.headingDeg);
    c.m.push(e.horizontalM);
  }
  cols.set(name, c);
}

/** `name: headingP50/p90deg horizontalP50m rRefused%` per candidate. */
function formatColumns(cols: ReadonlyMap<string, Column>, n: number): string {
  return [...cols.entries()]
    .map(([name, c]) => {
      const refused =
        c.refused > 0 ? ` r${String(Math.round((100 * c.refused) / n))}%` : '';
      const pos = c.m.length > 0 ? ` ${quantile(c.m, 0.5).toFixed(1)}m` : '';
      return `${name}: ${quantile(c.h, 0.5).toFixed(1)}/${quantile(c.h, 0.9).toFixed(0)}deg${pos}${refused}`;
    })
    .join(' | ');
}

/** Every candidate's errors over one cell's recordings. */
function sweepCell(
  recs: readonly Recording[],
  looks: number,
  yawNoiseDeg: number
): Map<string, Column> {
  const noise: LookNoise = { ...DEFAULT_NOISE, yawNoiseDeg };
  const cols = new Map<string, Column>();
  for (const rec of recs) {
    const { sightings, extentAt } = recordedSightings(rec, looks, noise, 7);
    for (const [name, e] of candidateErrors(rec, sightings, extentAt))
      addTo(cols, name, e);
  }
  return cols;
}

const SWEEP = process.env['QR_MINT_START_AT_CODE_SWEEP'] === '1';

describe.skipIf(!SWEEP)('spike: fix candidates across the sweep', () => {
  it(
    'measures heading error per candidate across walk length, looks and yaw noise',
    () => {
      const seeds = Array.from({ length: 40 }, (_, i) => i + 101);
      const rows: string[] = [];
      for (const walkM of [15, 30, 60, 120]) {
        const recs = seeds.map((seed) => runRecording({ seed, walkM }));
        for (const looks of [1, 2, 3]) {
          for (const yawNoiseDeg of [1, 3, 5]) {
            const cols = sweepCell(recs, looks, yawNoiseDeg);
            rows.push(
              `walk ${String(walkM)} m, looks ${String(looks)}, yaw ${String(yawNoiseDeg)}: ${formatColumns(cols, recs.length)}`
            );
          }
        }
      }
      // The package runs vitest with `silent: true`, so the table goes to a
      // file when one is named, and to the console otherwise.
      const table = [
        'heading p50/p90, horizontal p50, refused share',
        ...rows,
      ].join('\n');
      const out = process.env['QR_MINT_START_AT_CODE_SWEEP_OUT'];
      if (out === undefined) console.log(table);
      else writeFileSync(out, `${table}\n`);
      expect(rows.length).toBe(36);
    },
    30 * 60_000
  );
});
