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
 * Default run: the sanity pin, the reproduction and the left-behind pin, all
 * through the SHIPPED path (`shippedMintAlignment`: the real
 * `createQrMintAlignmentTracker` fed the way the Recorder's feeder feeds it).
 * The measured sweep of the fix candidates is opt-in:
 * `QR_MINT_START_AT_CODE_SWEEP=1`.
 *
 * WHAT SHIPS (owner decision D28, revised 2026-10-02): (a3) at 80 m - the
 * first alignment at or after the code's last sighting whose session GPS
 * extent reaches 80 m, else the alignment at save. The sweeps carry it as
 * the `a3-80 shipped` column, and it matches the simulated `a3 ext>=80m`
 * column in every cell. Re-run 2026-10-02 on the shipped path:
 * - start-at-code (`start`): identical to (a2) wherever the walks never
 *   reach 80 m (15-60 m walks): 8.2-10.0 / 13-17 degrees and 1.3 m at 15 m,
 *   2.1-4.9 / 4-10 degrees and 1.3 m from 30 m up; at 120 m within 0.2
 *   degrees of it (0.9-4.4 / 2-10 degrees, 1.3 m). Refusals unchanged (5-10
 *   % at 5 degrees of look yaw noise, the fixedness gate).
 * - start-only refusals (`refusals`): 0 of 480 (12 for (a1)).
 * - left behind (`left`): see THE CODE LEFT BEHIND below.
 *
 * Measured result (2026-10-02; 40 recordings per cell, walks 15/30/60/120 m,
 * 1-3 looks, yaw noise 1/3/5 degrees; heading p50 / p90, horizontal p50):
 * - pre-fix (each sighting through its own alignment, DEC-3): 72 / 158-161
 *   degrees whenever the code was seen in only 1 or 2 looks, at every walk
 *   length and yaw noise; with 3 looks 0.7-11 p50 but p90 up to 146 at
 *   15 m. Position 2.9 m for a code seen only at the start, 1.4-1.7 m with
 *   2 looks at walks of 30 m or less, 1.3 m otherwise.
 * - (a2) every sighting through the alignment at save (shipped first when
 *   the owner retired DEC-3, replaced the same day by (a3) at 80 m, which
 *   falls back to it): 1.0-4.9 / 3-10 degrees from 30 m walks up, 7-10
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
 *   every candidate; 2.5 % of start-only codes for (a1) and the pre-fix mint,
 *   0 % for (a2). Traced (`refusals`): one recording in 40 (seed 122, at every
 *   walk and yaw noise) whose only look ended at 1.75 s on a detection
 *   dropout, so its newest snapshot had seen 2 fixes, under the
 *   MIN_ALIGNMENT_SAMPLES floor of 3.
 * - (a3) the first MATURE alignment at or after the code's last sighting
 *   (the snapshot kept updating until maturity; GPS extent >= 10/20/40/60/
 *   80 m or >= 10/30/60 fixes): at 10 m or 10 fixes up to 8 degrees p50 and
 *   15-24 p90 for start-only codes, worse than (a2); from 40 m within 0.3
 *   degrees p50 of (a2), and identical when the walk never reaches the
 *   floor (it then IS the alignment at save).
 *
 * THE CODE LEFT BEHIND (`left`, milestone review H1, 2026-10-02; 30
 * recordings per cell, look yaw noise 2 degrees). The pivot drift above
 * cannot show it: every look is from the stand the recording ends at. Here
 * SLAM drift is INTEGRATED along the walk (yaw 0.5/1/2 degrees per 100 m,
 * translation 0.5/1/2 % of distance, `IntegratedDrift`), the code is seen
 * once or twice after two 60 m out-and-back walks matured the alignment,
 * and the author then walks 100/200/300/500 m away (straight, or 50 m legs
 * turning up to 60 degrees) or out and back to the code before Stop.
 * - (a2), the alignment at save, inherits all drift after the sighting: position
 *   p50 / p90 at 500 m away 2.9 / 4.3 m (0.5 deg, 0.5 %), 8.6 / 11.6 m
 *   (1, 1 %), 19.0 / 21.5 m (2, 2 %); heading 3.5 and 7 degrees p50 at 1 and
 *   2 degrees per 100 m. At 300 m and 1 %, 1 degree: 2.2 / 3.7 m. Walking
 *   back to the code does not save it: 500 m out and back, 1 %, 1 degree:
 *   11.0 / 15.3 m. Only at 100 m away is it as good as or better than the
 *   rest (1.2-1.7 m, 1.1-2.2 degrees).
 * - pre-fix (DEC-3) and (a1) are flat across every leave: 1.7-1.8 / 2.5-2.7 m
 *   and 1.5-2.7 degrees p50 (4-5 p90).
 * - (a3) with a 40-80 m extent floor is flat too: 1.1-1.7 / 2.1-3.1 m and
 *   1.0-2.3 degrees p50 (3-6 p90) over every mid-recording cell. A floor of
 *   10-20 m or 10-60 fixes is already met at the sighting there, so it IS
 *   (a1). The 40 m p90 heading is 5-6 degrees at 2 % translation drift, the
 *   80 m one 3-4. Under integrated drift a start-only code (walks 15-120 m)
 *   minted through (a3) at 40 m: 1.8-3.8 degrees and 1.4-1.6 m, against
 *   1.5-4.1 degrees and 1.4-4.0 m for (a2).
 * - So (a2) is a regression for a code left behind: worse than DEC-3 from
 *   about 300 m walked after it at 1 % and 1 degree per 100 m (200 m at
 *   2 %), growing with the distance times the drift; and (a3) with an
 *   extent floor of 40 m or more removes it while keeping the start-at-code
 *   fix. The floor reverses at 10-20 m (worse than (a2) for a start-only
 *   code), and (a3) gains nothing when the drift after the sighting is
 *   small (0.5 %, 0.5 degrees, 100 m: 1.4 m against 1.3 m for (a2)).
 *
 * HEADING AGAINST GPS EXTENT (`extent`, milestone review M2; start-at-code,
 * 3 looks, out-and-back walks 0-30 m, 40 seeds each; the extent is the
 * largest distance between two fixes at mint time, noise included): below
 * 5 m 41 / 151 degrees p50 / p90 (the yaw is unobservable), 5-10 m 7.3 / 22,
 * 10-15 m 3.5 / 8, 15-20 m 3.4 / 8. The MIN_ALIGNMENT_SAMPLES floor (3
 * fixes) passes every one of them.
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
import {
  mintQrAnchorFromSightings,
  type QrMintAlignmentNow,
} from './qr-anchor-mint.js';
import { createQrMintAlignmentTracker } from './qr-mint-alignment-tracker.js';
import { createGpsExtentTracker } from '../../state/gps-extent-tracker.js';
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
  /** After the three looks, a walk AWAY from the code before Stop (the
   *  left-behind scenario). Absent: the recording ends at the code. */
  readonly leave?: LeaveSpec;
  /** Integrated SLAM drift instead of the default frame-yaw pivot. */
  readonly drift?: IntegratedDrift;
}

interface LeaveSpec {
  /** Path length walked after the last look (m). */
  readonly distanceM: number;
  /** Half of it out, then back along the same path to the code. */
  readonly endBack: boolean;
  /** One straight line (the largest lever arm a walk of this length has),
   *  or 50 m legs turning by up to 60 degrees each. */
  readonly path: 'straight' | 'meander';
}

/**
 * Odometry drift INTEGRATED along the walk, which is how SLAM drifts: the
 * heading error grows with distance walked, and every metre is reported
 * with that metre's heading error, plus a translation bias in one random
 * horizontal direction proportional to the distance (end-point error as a
 * share of distance travelled). A pose recorded early stays in the frame
 * as it was then, so an alignment fitted to the END of the walk sees it
 * displaced by everything accumulated after it.
 */
interface IntegratedDrift {
  readonly yawDegPer100m: number;
  readonly transPct: number;
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
  /** Largest horizontal distance between two GPS fixes so far (m), from
   *  the measured positions this fixture generated. */
  readonly gpsExtentM: number;
  /** The same, as the shipped `createGpsExtentTracker` reads it from the
   *  store's GPS list (what the Recorder's feeder hands the mint). */
  readonly storeExtentM: number;
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
  /** The phone's integrated odometry position, when `spec.drift` is set. */
  readonly track: OdomTrack | null;
}

/** The phone's odometry NUE position sampled every `stepS` from t = 0. */
interface OdomTrack {
  readonly stepS: number;
  readonly points: readonly Vector3[];
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
  if (spec.leave !== undefined) {
    t = appendLeave(spec, waypoints, t, walked);
  }
  return { waypoints, looks, endS: t };
}

/** The walk away from the code after the last look; returns the end time.
 *  Its own random stream, so the walks and looks before it are unchanged. */
function appendLeave(
  spec: RecordingSpec,
  waypoints: Waypoint[],
  startS: number,
  startWalkedM: number
): number {
  const leave = spec.leave!;
  const rng = stream(spec.seed, 6);
  const legM = leave.path === 'straight' ? Infinity : 50;
  const outM = leave.endBack ? leave.distanceM / 2 : leave.distanceM;
  let heading = rad(CODE_NORMAL_DEG + (rng() * 120 - 60));
  const legs: NE[] = [];
  let at: NE = STAND;
  for (let done = 0; done < outM - 1e-9;) {
    const len = Math.min(legM, outM - done);
    at = [at[0] + len * Math.cos(heading), at[1] + len * Math.sin(heading)];
    legs.push(at);
    done += len;
    heading += rad(rng() * 120 - 60);
  }
  const route = leave.endBack
    ? [...legs, ...legs.slice(0, -1).reverse(), STAND]
    : legs;
  let t = startS;
  let walked = startWalkedM;
  let from: NE = STAND;
  for (const to of route) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    t += len / WALK_SPEED_MPS;
    walked += len;
    waypoints.push({ tS: t, at: to, walkedM: walked });
    from = to;
  }
  return t;
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

type RecordingFrame = Omit<Recording, 'fixes' | 'zero'>;

/** The odometry frame at `tS`: world = Ry(yaw) . odomNue + t0 (with
 *  integrated drift, only locally around the phone). */
function frameYaw(rec: Omit<RecordingFrame, 'track'>, tS: number): number {
  if (rec.spec.exact === true) return rec.yaw0;
  const walked = phoneAt(rec.waypoints, tS).walkedM;
  const rate = rec.spec.drift?.yawDegPer100m ?? DRIFT_DEG_PER_100M;
  return rec.yaw0 + rec.yawSign * rad(rate) * (walked / 100);
}

function odomNueAt(rec: RecordingFrame, world: Vector3, tS: number): Vector3 {
  if (rec.track !== null) {
    // What the camera sees is relative to the phone, in the frame as it is
    // at this moment; the phone's own odometry carries the drift so far.
    const phone = phoneAt(rec.waypoints, tS).at;
    const o = trackAt(rec.track, tS);
    const rel = rotY(-frameYaw(rec, tS), [
      world[0] - phone[0],
      world[1] - PHONE_ALT,
      world[2] - phone[1],
    ]);
    return [o[0] + rel[0], o[1] + rel[1], o[2] + rel[2]];
  }
  return rotY(-frameYaw(rec, tS), [
    world[0] - rec.t0[0],
    world[1] - rec.t0[1],
    world[2] - rec.t0[2],
  ]);
}

const TRACK_STEP_S = 0.05;

/** Integrate the phone's odometry along the walk (see `IntegratedDrift`). */
function integrateTrack(
  rec: Omit<RecordingFrame, 'track'>,
  drift: IntegratedDrift
): OdomTrack {
  const biasDir = stream(rec.spec.seed, 5)() * 2 * Math.PI;
  const bias: NE = [Math.cos(biasDir), Math.sin(biasDir)];
  const eps = drift.transPct / 100;
  const startNe = phoneAt(rec.waypoints, 0).at;
  let o = rotY(-frameYaw(rec, 0), [
    startNe[0] - rec.t0[0],
    PHONE_ALT - rec.t0[1],
    startNe[1] - rec.t0[2],
  ]);
  const points: Vector3[] = [o];
  let prev = startNe;
  const steps = Math.ceil(rec.endS / TRACK_STEP_S) + 1;
  for (let i = 1; i <= steps; i += 1) {
    const tS = i * TRACK_STEP_S;
    const cur = phoneAt(rec.waypoints, tS).at;
    const dn = cur[0] - prev[0];
    const de = cur[1] - prev[1];
    const len = Math.hypot(dn, de);
    const d = rotY(-frameYaw(rec, tS - TRACK_STEP_S / 2), [
      dn + eps * len * bias[0],
      0,
      de + eps * len * bias[1],
    ]);
    o = [o[0] + d[0], o[1], o[2] + d[2]];
    points.push(o);
    prev = cur;
  }
  return { stepS: TRACK_STEP_S, points };
}

function trackAt(track: OdomTrack, tS: number): Vector3 {
  const pos = Math.max(0, tS / track.stepS);
  const i = Math.min(Math.floor(pos), track.points.length - 1);
  const a = track.points[i]!;
  const b = track.points[Math.min(i + 1, track.points.length - 1)]!;
  const f = pos - i;
  return [
    a[0] + f * (b[0] - a[0]),
    a[1] + f * (b[1] - a[1]),
    a[2] + f * (b[2] - a[2]),
  ];
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
  const base = {
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
  const frame: RecordingFrame = {
    ...base,
    track: spec.drift === undefined ? null : integrateTrack(base, spec.drift),
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
  const extentTracker = createGpsExtentTracker();
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
      storeExtentM: extentTracker.update(selectGpsPositions(store.getState())),
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
): {
  sightings: QrSighting[];
  extentAt: Map<number, number>;
  /** When each kept detection happened (s), in order. */
  detectionTimesS: number[];
} {
  const rng = stream(rec.spec.seed * 31 + noiseSeed, 4);
  const acc = createQrSightingAccumulator();
  const extentAt = new Map<number, number>();
  const detectionTimesS: number[] = [];
  for (let look = 0; look < rec.looks.length; look += 1) {
    const detections = lookDetections(rec, look, noise, rng);
    if (look < firstLook || look >= looks) continue;
    for (const { tS, pose } of detections) {
      const seen = observationAt(rec, tS, pose);
      extentAt.set(seen.observation.timestamp, seen.gpsExtentM);
      acc.observe(seen.observation);
      detectionTimesS.push(tS);
    }
  }
  return {
    sightings: [...acc.sightingsIncludingOpen(CODE_TEXT)],
    extentAt,
    detectionTimesS,
  };
}

/**
 * The alignment the SHIPPED path mints this code through (D28 revised,
 * a3 at 80 m): the Recorder's feeder reports every detection and every
 * alignment change to `createQrMintAlignmentTracker`, in time order, and
 * the save asks it with the alignment at save as the live one. Each fix is
 * reported before a detection at the same instant, because a detection
 * reads the newest fix at or before it (`fixAt`).
 */
function shippedMintAlignment(
  rec: Recording,
  detectionTimesS: readonly number[]
): QrMintAlignmentNow {
  const tracker = createQrMintAlignmentTracker();
  let d = 0;
  const sightUntil = (beforeS: number): void => {
    while (d < detectionTimesS.length && detectionTimesS[d]! < beforeS) {
      const fix = fixAt(rec, detectionTimesS[d]!);
      tracker.noteSighting(
        CODE_TEXT,
        fix === null ? NO_ALIGNMENT : asCurrent(rec, fix)
      );
      d += 1;
    }
  };
  for (const fix of rec.fixes) {
    sightUntil(fix.tS);
    tracker.noteAlignment(asCurrent(rec, fix));
  }
  sightUntil(Infinity);
  return tracker.alignmentFor(CODE_TEXT, asCurrent(rec, endAlignment(rec)));
}

/** The shipped mint's heading error and the GPS extent of the alignment it
 *  was composed through, for the uncertain-heading marker shares. */
function shippedExtentSample(
  rec: Recording,
  sightings: readonly QrSighting[],
  detectionTimesS: readonly number[]
): ExtentSample {
  const used = shippedMintAlignment(rec, detectionTimesS);
  const err = mintError(sightings, { currentAlignment: used });
  return { extentM: used.gpsExtentM ?? 0, headingDeg: err?.headingDeg ?? null };
}

const NO_ALIGNMENT: QrMintAlignmentNow = {
  alignmentMatrix: null,
  zero: null,
  alignmentSampleCount: 0,
  segment: 0,
};

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

  // Why this test matters: the left-behind sweep rests on the integrated
  // drift model. With no drift it must reduce EXACTLY to the frame-pivot
  // model every other number here uses (at the integration grid's own
  // instants, where it carries no interpolation error), including along the
  // walk away from the code.
  it('integrated odometry without drift is the pivot model', () => {
    const leave: LeaveSpec = {
      distanceM: 120,
      endBack: false,
      path: 'meander',
    };
    const pivot = runRecording({ seed: 5, walkM: 30, exact: true, leave });
    const integrated = runRecording({
      seed: 5,
      walkM: 30,
      exact: true,
      leave,
      drift: { yawDegPer100m: 0, transPct: 0 },
    });
    expect(integrated.endS).toBe(pivot.endS);
    for (let tS = 0; tS <= pivot.endS; tS += 1) {
      const a = codePoseAt(pivot, tS, 0).position;
      const b = codePoseAt(integrated, tS, 0).position;
      for (let k = 0; k < 3; k += 1) expect(b[k]).toBeCloseTo(a[k]!, 6);
    }
  });

  // Why this test matters: the translation drift is a share of the distance
  // walked. Walking 200 m out and back to the code with 2 % must leave the
  // phone's odometry 4 m from where it started the walk, although the phone
  // is back where it was.
  it('translation drift is the stated share of the distance walked', () => {
    const rec = runRecording({
      seed: 9,
      walkM: 30,
      exact: true,
      drift: { yawDegPer100m: 0, transPct: 2 },
      leave: { distanceM: 200, endBack: true, path: 'straight' },
    });
    const leaveStartS = rec.looks[2]![1] + 0.5;
    const from = trackAt(rec.track!, leaveStartS);
    const to = trackAt(rec.track!, rec.endS);
    expect(Math.hypot(to[0] - from[0], to[2] - from[2])).toBeCloseTo(4, 1);
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
  /** The shipped mint (the alignment `shippedMintAlignment` picks passed as
   *  `currentAlignment`) on each seed's 30 m recording. Two 30 m walks never
   *  reach the 80 m floor, so this is the save-time fallback. */
  const shippedErrors = (looks: number): MintError[] =>
    SEEDS.map((seed) => {
      const rec = runRecording({ seed, walkM: 30 });
      const { sightings, detectionTimesS } = recordedSightings(
        rec,
        looks,
        DEFAULT_NOISE,
        1
      );
      const err = mintError(sightings, {
        currentAlignment: shippedMintAlignment(rec, detectionTimesS),
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

describe('the Recorder mint for a code left behind (D28 revised)', () => {
  // Why this test matters: it is the milestone review's H1 regression,
  // pinned where the decision acts. Through the alignment at save (a2) a
  // code seen mid-recording and then walked 500 m away from, at 1 % and
  // 1 degree per 100 m of SLAM drift, inherits all of that drift (8.6 m
  // p50 on the `left` sweep). The shipped rule (the first alignment at or
  // after the last sighting whose GPS extent reaches 80 m) stops at the
  // sighting, as the per-sighting rule did (1.1-1.7 m). The a2 arm on the
  // same recordings shows the test can tell the two apart.
  it('keeps a code left 500 m behind at 1 % / 1 degree near 1.4 m, not 8.6 m', () => {
    const seeds = Array.from({ length: 6 }, (_, i) => i + 201);
    const shipped: number[] = [];
    const atSave: number[] = [];
    for (const seed of seeds) {
      const rec = runRecording({
        seed,
        walkM: 60,
        drift: UNIT_DRIFT,
        leave: { distanceM: 500, endBack: false, path: 'straight' },
      });
      const { sightings, detectionTimesS } = recordedSightings(
        rec,
        3,
        DEFAULT_NOISE,
        7,
        2
      );
      const a3 = mintError(sightings, {
        currentAlignment: shippedMintAlignment(rec, detectionTimesS),
      });
      const a2 = mintError(sightings, {
        currentAlignment: asCurrent(rec, endAlignment(rec)),
      });
      expect(a3).not.toBeNull();
      expect(a2).not.toBeNull();
      shipped.push(a3!.horizontalM);
      atSave.push(a2!.horizontalM);
    }
    expect(quantile(shipped, 0.5)).toBeLessThan(2.5);
    expect(quantile(atSave, 0.5)).toBeGreaterThan(5);
  }, 120_000);

  // Why this test matters: the maturity floor reads the extent the shipped
  // `createGpsExtentTracker` computes from the store's GPS list, while the
  // sweeps' extent bins use the fixture's own measured positions. They must
  // be the same number, or a bin and the floor would describe different
  // walks.
  it('reads the same GPS extent from the store as the fixture generated', () => {
    const rec = runRecording({ seed: 4, walkM: 40 });
    for (const fix of rec.fixes) {
      expect(fix.storeExtentM).toBeCloseTo(fix.gpsExtentM, 2);
    }
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
  extentAt: ReadonlyMap<number, number>,
  detectionTimesS: readonly number[]
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
    // (a2) = shipped for one day: the alignment at the end of the recording.
    ['a2 at save', mintError(sightings, { currentAlignment: current })],
    // What ships since D28 was revised: (a3) at 80 m through the real
    // tracker (`shippedMintAlignment`).
    [
      'a3-80 shipped',
      mintError(sightings, {
        currentAlignment: shippedMintAlignment(rec, detectionTimesS),
      }),
    ],
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
    ...a3Candidates(rec, sightings),
  ];
}

/** What makes an alignment MATURE for candidate (a3). */
interface Maturity {
  readonly name: string;
  readonly mature: (fix: FixSnapshot) => boolean;
}

/** The maturity floors (a3) is swept over: the GPS extent so far (largest
 *  distance between two fixes, noise included) or the fix count. */
const MATURITIES: readonly Maturity[] = [
  { name: 'ext>=10m', mature: (f) => f.gpsExtentM >= 10 },
  { name: 'ext>=20m', mature: (f) => f.gpsExtentM >= 20 },
  { name: 'ext>=40m', mature: (f) => f.gpsExtentM >= 40 },
  { name: 'ext>=60m', mature: (f) => f.gpsExtentM >= 60 },
  { name: 'ext>=80m', mature: (f) => f.gpsExtentM >= 80 },
  { name: 'n>=10', mature: (f) => f.sampleCount >= 10 },
  { name: 'n>=30', mature: (f) => f.sampleCount >= 30 },
  { name: 'n>=60', mature: (f) => f.sampleCount >= 60 },
];

/**
 * (a3) the first MATURE alignment at or after the code's last sighting:
 * the per-code snapshot a feeder would keep updating until the alignment
 * matures and then freeze. A recording that stops before that minted
 * through the newest snapshot, which is then the alignment at save (a2).
 */
function a3Alignment(
  rec: Recording,
  sightings: readonly QrSighting[],
  maturity: Maturity
): FixSnapshot {
  const lastS =
    ((sightings.at(-1)?.lastTimestamp ?? EPOCH_MS) - EPOCH_MS) / 1000;
  const from = Math.floor(lastS);
  const found = rec.fixes.find(
    (f) => f.tS >= from && f.alignment !== null && maturity.mature(f)
  );
  return found ?? endAlignment(rec);
}

function asCurrent(rec: Recording, fix: FixSnapshot): QrMintAlignmentNow {
  return {
    alignmentMatrix: fix.alignment,
    zero: rec.zero,
    alignmentSampleCount: fix.sampleCount,
    gpsExtentM: fix.storeExtentM,
    segment: 0,
  };
}

function a3Candidates(
  rec: Recording,
  sightings: readonly QrSighting[]
): [string, CandidateError][] {
  return MATURITIES.map((m) => [
    `a3 ${m.name}`,
    mintError(sightings, {
      currentAlignment: asCurrent(rec, a3Alignment(rec, sightings, m)),
    }),
  ]);
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

/** `name: headingP50/p90deg horizontalP50/p90m rRefused%` per candidate. */
function formatColumns(cols: ReadonlyMap<string, Column>, n: number): string {
  return [...cols.entries()]
    .map(([name, c]) => {
      const refused =
        c.refused > 0 ? ` r${String(Math.round((100 * c.refused) / n))}%` : '';
      const pos =
        c.m.length > 0
          ? ` ${quantile(c.m, 0.5).toFixed(1)}/${quantile(c.m, 0.9).toFixed(1)}m`
          : '';
      return `${name}: ${quantile(c.h, 0.5).toFixed(1)}/${quantile(c.h, 0.9).toFixed(0)}deg${pos}${refused}`;
    })
    .join(' | ');
}

/** Every candidate's errors over one cell's recordings. */
function sweepCell(
  recs: readonly Recording[],
  looks: number,
  yawNoiseDeg: number,
  marks: ExtentSample[] = []
): Map<string, Column> {
  const noise: LookNoise = { ...DEFAULT_NOISE, yawNoiseDeg };
  const cols = new Map<string, Column>();
  for (const rec of recs) {
    const { sightings, extentAt, detectionTimesS } = recordedSightings(
      rec,
      looks,
      noise,
      7
    );
    for (const [name, e] of candidateErrors(
      rec,
      sightings,
      extentAt,
      detectionTimesS
    ))
      addTo(cols, name, e);
    marks.push(shippedExtentSample(rec, sightings, detectionTimesS));
  }
  return cols;
}

/**
 * Which opt-in sweeps run: `QR_MINT_START_AT_CODE_SWEEP=1` runs all of
 * them, or a comma list of `start`, `left`, `extent`, `refusals`.
 */
const SWEEPS = ((): ReadonlySet<string> => {
  const raw = process.env['QR_MINT_START_AT_CODE_SWEEP'] ?? '';
  if (raw === '1') return new Set(['start', 'left', 'extent', 'refusals']);
  return new Set(raw.split(',').filter((s) => s !== ''));
})();

/** The package runs vitest with `silent: true`, so a table goes to a file
 *  when `QR_MINT_START_AT_CODE_SWEEP_OUT` names one (with `suffix` added
 *  for every table but the first sweep's), and to the console otherwise. */
function emitTable(lines: readonly string[], suffix = ''): void {
  const table = lines.join('\n');
  const out = process.env['QR_MINT_START_AT_CODE_SWEEP_OUT'];
  if (out === undefined) console.log(table);
  else writeFileSync(`${out}${suffix}`, `${table}\n`);
}

describe.skipIf(!SWEEPS.has('start'))(
  'spike: fix candidates across the sweep',
  () => {
    it(
      'measures heading error per candidate across walk length, looks and yaw noise',
      () => {
        const seeds = Array.from({ length: 40 }, (_, i) => i + 101);
        const rows: string[] = [];
        const markRows: string[] = [];
        for (const walkM of [15, 30, 60, 120]) {
          const recs = seeds.map((seed) => runRecording({ seed, walkM }));
          const marks: ExtentSample[] = [];
          for (const looks of [1, 2, 3]) {
            for (const yawNoiseDeg of [1, 3, 5]) {
              const cols = sweepCell(recs, looks, yawNoiseDeg, marks);
              rows.push(
                `walk ${String(walkM)} m, looks ${String(looks)}, yaw ${String(yawNoiseDeg)}: ${formatColumns(cols, recs.length)}`
              );
            }
          }
          for (const row of markedShareRows(marks))
            markRows.push(`walk ${String(walkM)} m, ${row}`);
        }
        emitTable([
          'heading p50/p90, horizontal p50/p90, refused share',
          ...rows,
          ...markRows,
        ]);
        expect(rows.length).toBe(36);
      },
      30 * 60_000
    );
  }
);

// ---------------------------------------------------------------------------
// Opt-in: a code LEFT BEHIND (milestone review H1, 2026-10-02).
// ---------------------------------------------------------------------------

/** The candidates that survive into a design choice, on one recording. */
function leftCandidates(
  rec: Recording,
  sightings: readonly QrSighting[],
  detectionTimesS: readonly number[]
): [string, CandidateError][] {
  return [
    ['pre-fix', preFixError(rec, sightings)],
    ['a1', mintError(sightings)],
    [
      'a2',
      mintError(sightings, {
        currentAlignment: asCurrent(rec, endAlignment(rec)),
      }),
    ],
    [
      'a3-80 shipped',
      mintError(sightings, {
        currentAlignment: shippedMintAlignment(rec, detectionTimesS),
      }),
    ],
    ...a3Candidates(rec, sightings),
  ];
}

interface LeftCell {
  readonly label: string;
  readonly spec: Omit<RecordingSpec, 'seed'>;
  /** Looks `firstLook`..2 detect the code (2 = only the last, after both
   *  walks; 1 = the last two; 0 = only the first, at the start). */
  readonly firstLooks: readonly number[];
}

const driftTag = (d: IntegratedDrift): string =>
  `yaw ${String(d.yawDegPer100m)}deg/100m, trans ${String(d.transPct)}%`;

const UNIT_DRIFT: IntegratedDrift = { yawDegPer100m: 1, transPct: 1 };

/** The sweep grid; every parameter it rests on is named in the label. */
function leftCells(): LeftCell[] {
  const drifts: IntegratedDrift[] = [];
  for (const yawDegPer100m of [0.5, 1, 2])
    for (const transPct of [0.5, 1, 2])
      drifts.push({ yawDegPer100m, transPct });
  return [...midCells(drifts), ...startCells()];
}

/** A code seen after the alignment matured, then left behind. */
function midCells(drifts: readonly IntegratedDrift[]): LeftCell[] {
  const cells: LeftCell[] = [];
  const unit = UNIT_DRIFT;
  for (const distanceM of [100, 200, 300, 500])
    for (const drift of drifts)
      cells.push({
        label: `mid, leave ${String(distanceM)} m straight, ${driftTag(drift)}`,
        spec: {
          walkM: 60,
          drift,
          leave: { distanceM, endBack: false, path: 'straight' },
        },
        firstLooks: [2, 1],
      });
  for (const distanceM of [300, 500])
    cells.push({
      label: `mid, leave ${String(distanceM)} m meander, ${driftTag(unit)}`,
      spec: {
        walkM: 60,
        drift: unit,
        leave: { distanceM, endBack: false, path: 'meander' },
      },
      firstLooks: [2, 1],
    });
  for (const distanceM of [100, 300, 500])
    for (const drift of drifts)
      cells.push({
        label: `mid, ${String(distanceM)} m out and back to the code, ${driftTag(drift)}`,
        spec: {
          walkM: 60,
          drift,
          leave: { distanceM, endBack: true, path: 'straight' },
        },
        firstLooks: [2],
      });
  return cells;
}

/** The start-at-code recording under integrated drift: the case the
 *  shipped fix was made for, with the drift model the first sweep lacks. */
function startCells(): LeftCell[] {
  const cells: LeftCell[] = [];
  const unit = UNIT_DRIFT;
  for (const walkM of [15, 30, 60, 120])
    for (const drift of [unit, { yawDegPer100m: 2, transPct: 2 }])
      cells.push({
        label: `start, walks ${String(walkM)} m, ends at code, ${driftTag(drift)}`,
        spec: { walkM, drift },
        firstLooks: [0],
      });
  for (const distanceM of [100, 300])
    cells.push({
      label: `start, walks 60 m, leave ${String(distanceM)} m straight, ${driftTag(unit)}`,
      spec: {
        walkM: 60,
        drift: unit,
        leave: { distanceM, endBack: false, path: 'straight' },
      },
      firstLooks: [0],
    });
  return cells;
}

const LOOK_NAMES: Record<number, string> = {
  0: 'seen at start only',
  1: 'seen twice mid',
  2: 'seen once mid',
};

/** Looks `firstLook`..`looks - 1` detect: the start-only cell keeps look 0. */
const looksFor = (firstLook: number): number => (firstLook === 0 ? 1 : 3);

describe.skipIf(!SWEEPS.has('left'))(
  'spike: a code left behind, under integrated drift',
  () => {
    it(
      'measures each candidate for a code seen mid-recording and then walked away from',
      () => {
        const seedCount = Number(process.env['QR_MINT_LEFT_SEEDS'] ?? '30');
        const seeds = Array.from({ length: seedCount }, (_, i) => i + 201);
        const rows: string[] = [];
        const marks: ExtentSample[] = [];
        for (const cell of leftCells()) {
          const recs = seeds.map((seed) =>
            runRecording({ seed, ...cell.spec })
          );
          for (const firstLook of cell.firstLooks) {
            const cols = new Map<string, Column>();
            for (const rec of recs) {
              const { sightings, detectionTimesS } = recordedSightings(
                rec,
                looksFor(firstLook),
                DEFAULT_NOISE,
                7,
                firstLook
              );
              for (const [name, e] of leftCandidates(
                rec,
                sightings,
                detectionTimesS
              ))
                addTo(cols, name, e);
              marks.push(shippedExtentSample(rec, sightings, detectionTimesS));
            }
            rows.push(
              `${cell.label}, ${LOOK_NAMES[firstLook] ?? ''}: ${formatColumns(cols, recs.length)}`
            );
          }
        }
        emitTable(
          [
            `left behind (${String(seedCount)} recordings per cell, look yaw noise 2 deg): heading p50/p90, horizontal p50/p90, refused share`,
            ...rows,
            ...markedShareRows(marks).map((row) => `every cell, ${row}`),
          ],
          '.left-behind.txt'
        );
        expect(rows.length).toBeGreaterThan(0);
      },
      120 * 60_000
    );
  }
);

// ---------------------------------------------------------------------------
// Opt-in: heading error against the GPS extent the mint alignment rests on
// (milestone review M2: nothing checks the alignment can observe yaw).
// ---------------------------------------------------------------------------

/** One shipped mint: the GPS extent of the alignment it was composed
 *  through, and its heading error (`null` = refused). */
interface ExtentSample {
  readonly extentM: number;
  readonly headingDeg: number | null;
}

/**
 * The uncertain-heading marker (owner decision of 2026-10-02: save, and
 * mark the level when its alignment's GPS extent is under a threshold) at
 * 5, 10 and 15 m: the share of minted codes it would mark, and the heading
 * of the marked and the unmarked ones.
 */
function markedShareRows(samples: readonly ExtentSample[]): string[] {
  const minted = samples.filter((s) => s.headingDeg !== null);
  const fmt = (h: number[]): string =>
    h.length === 0
      ? 'none'
      : `${quantile(h, 0.5).toFixed(1)}/${quantile(h, 0.9).toFixed(0)}deg`;
  return [5, 10, 15].map((thresholdM) => {
    const marked = minted
      .filter((s) => s.extentM < thresholdM)
      .map((s) => s.headingDeg!);
    const clear = minted
      .filter((s) => s.extentM >= thresholdM)
      .map((s) => s.headingDeg!);
    const share =
      minted.length === 0 ? 0 : (100 * marked.length) / minted.length;
    return `marker under ${String(thresholdM)} m: marks ${share.toFixed(0)}% of ${String(minted.length)} minted codes, marked heading p50/p90 ${fmt(marked)}, unmarked ${fmt(clear)}`;
  });
}

describe.skipIf(!SWEEPS.has('extent'))(
  'spike: mint heading against the GPS extent at mint time',
  () => {
    it(
      'bins the shipped mint heading error by the GPS extent of its alignment',
      () => {
        const seeds = Array.from({ length: 40 }, (_, i) => i + 301);
        const walks = [0, 2, 4, 6, 8, 10, 15, 20, 30];
        const samples: ExtentSample[] = [];
        for (const walkM of walks) {
          for (const seed of seeds) {
            const rec = runRecording({ seed, walkM });
            const { sightings, detectionTimesS } = recordedSightings(
              rec,
              3,
              DEFAULT_NOISE,
              7
            );
            // The shipped path (a3 at 80 m); walks this short never mature,
            // so it is the alignment at save.
            const used = shippedMintAlignment(rec, detectionTimesS);
            const err = mintError(sightings, { currentAlignment: used });
            samples.push({
              extentM: used.gpsExtentM ?? 0,
              headingDeg: err?.headingDeg ?? null,
            });
          }
        }
        const headings = (rows: typeof samples): number[] =>
          rows.map((s) => s.headingDeg).filter((v): v is number => v !== null);
        const rows: string[] = [];
        const bins = [0, 5, 10, 15, 20, 30, Infinity];
        for (let i = 0; i + 1 < bins.length; i += 1) {
          const lo = bins[i]!;
          const hi = bins[i + 1]!;
          const inBin = samples.filter(
            (s) => s.extentM >= lo && s.extentM < hi
          );
          const h = headings(inBin);
          rows.push(
            `extent ${String(lo)}-${String(hi)} m: n ${String(inBin.length)}, refused ${String(inBin.length - h.length)}, heading p50/p90 ${quantile(h, 0.5).toFixed(1)}/${quantile(h, 0.9).toFixed(0)}deg`
          );
        }
        for (const floorM of [5, 10, 15, 20]) {
          const kept = samples.filter((s) => s.extentM >= floorM);
          const h = headings(kept);
          rows.push(
            `floor ${String(floorM)} m: refuses ${((100 * (samples.length - kept.length)) / samples.length).toFixed(0)}% of these recordings, kept heading p50/p90 ${quantile(h, 0.5).toFixed(1)}/${quantile(h, 0.9).toFixed(0)}deg`
          );
        }
        rows.push(...markedShareRows(samples));
        emitTable(
          [
            'start-at-code, 3 looks, out-and-back walks 0-30 m, 40 seeds each: shipped mint heading by GPS extent at mint time',
            ...rows,
          ],
          '.extent.txt'
        );
        expect(samples.length).toBe(walks.length * seeds.length);
      },
      30 * 60_000
    );
  }
);

// ---------------------------------------------------------------------------
// Opt-in: why the newest-snapshot mint (a1, and DEC-3 before it) refused
// about 3 % of start-only codes (milestone review G2).
// ---------------------------------------------------------------------------

/** Why the newest-snapshot mint refused these sightings, or `null`. */
function refusalOf(sightings: readonly QrSighting[]): string | null {
  const result = mintQrAnchorFromSightings({
    sightings,
    spansFrameChange: false,
    nowIso: new Date(EPOCH_MS).toISOString(),
  });
  if (result.ok && result.level.ok) return null;
  const last = sightings.at(-1);
  const atS = ((last?.lastTimestamp ?? EPOCH_MS) - EPOCH_MS) / 1000;
  const reason = result.ok ? 'level refused' : result.reason;
  return `${reason}, last detection at ${atS.toFixed(2)} s, ${String(last?.alignmentSampleCount ?? 0)} fixes`;
}

describe.skipIf(!SWEEPS.has('refusals'))(
  'spike: refusals of the newest-snapshot mint for a start-only code',
  () => {
    it(
      'names the reason, the time of the last detection and its sample count',
      () => {
        const seeds = Array.from({ length: 40 }, (_, i) => i + 101);
        const rows: string[] = [];
        let total = 0;
        let shippedRefused = 0;
        for (const walkM of [15, 30, 60, 120]) {
          const recs = seeds.map((seed) => runRecording({ seed, walkM }));
          for (const yawNoiseDeg of [1, 3, 5]) {
            const noise: LookNoise = { ...DEFAULT_NOISE, yawNoiseDeg };
            for (const rec of recs) {
              const { sightings, detectionTimesS } = recordedSightings(
                rec,
                1,
                noise,
                7
              );
              total += 1;
              const shipped = mintError(sightings, {
                currentAlignment: shippedMintAlignment(rec, detectionTimesS),
              });
              if (shipped === null) shippedRefused += 1;
              const why = refusalOf(sightings);
              if (why !== null)
                rows.push(
                  `walk ${String(walkM)}, yaw ${String(yawNoiseDeg)}, seed ${String(rec.spec.seed)}: ${why}`
                );
            }
          }
        }
        emitTable(
          [
            `a1 refusals of start-only codes: ${String(rows.length)} of ${String(total)}; a3-80 shipped: ${String(shippedRefused)}`,
            ...rows,
          ],
          '.refusals.txt'
        );
        expect(total).toBe(480);
      },
      30 * 60_000
    );
  }
);
