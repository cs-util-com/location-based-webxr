/**
 * M3a of the Tour Viewer authoring plan (2026-09-28-0953, §3.3 "The code's
 * best estimate across AR entries needs a design spike first", §4 M3a): how
 * should one printed code's measurements from several AR visits be combined
 * into ONE world pose, and when is that pose good enough to call "Good" on
 * the summary screen?
 *
 * Why this file matters: the owner's recordings do not exist yet (§4: "if
 * none exist when M4 is done, M3a runs on the synthetic replay fixtures and
 * says so"). This is that synthetic fixture. It drives the REAL store and
 * solver of the published `gps-plus-slam-js` per visit (nothing about the
 * solve is mocked) and the real framework/Tour Viewer composition: the
 * accumulator and mint the Recorder uses (`qr-sighting-accumulator`,
 * `qr-anchor-mint`) and the Tour Viewer's own visit composition
 * (`odomNueFromWebXr` + `throughAlignment` + `mintQrGeoPose`, i.e. what
 * `visit-settle.ts` re-mints a measured code through).
 *
 * ONE VISIT (an AR entry), deterministic per seed:
 * - its own odometry frame: an arbitrary yaw and origin (WebXR picks a new
 *   one per session), plus optional SLAM drift that grows with the distance
 *   walked;
 * - the author stands 2 m in front of the code and looks at it for 4 s (the
 *   entry hint, §3.2a), walks a `line` (out and back) or a `loop` (a square)
 *   of `walkM` metres, comes back and looks again for 4 s;
 * - GPS at 1 Hz: the truth plus a constant per-visit bias, a Gauss-Markov
 *   wander (sigma `gmFrac` x accuracy, correlation time `gmTauS`) and white
 *   noise (`whiteFrac` x accuracy), with the visit's reported accuracy;
 * - the code is detected at ~8 Hz during each look, with dropouts; each look
 *   carries its own yaw error (`yawNoiseDeg`, the brief's "code yaw noise",
 *   systematic per look) and each detection a small jitter.
 *
 * THE BIAS IS ADDED AFTER THE SOLVE, and a test below proves that this is
 * exact: a constant GPS bias moves the solver's alignment by exactly that
 * bias and turns it by nothing, so a visit's code estimate with bias b is
 * its estimate without bias plus b. That is what makes the bias sweeps
 * (size, direction spread across visits, coupling to the reported accuracy)
 * cheap: the solver runs once per visit, the bias models run on top.
 *
 * Default run: the fixture's sanity pins (fast). The measured sweeps are
 * opt-in: `CODE_ESTIMATE_SPIKE=1` (all), or `strategies`, `thresholds`,
 * `model`, `verdict`. Their tables are the M3a results doc's evidence.
 *
 * Measured result (synthetic only). Sample sizes per part, since they
 * differ (the M3a/M3b review, #4, found the first header overstated them):
 * - Combining (`strategies`; re-run 2026-10-01 with the shipped subset rule):
 *   a pool of 320 visits, 2,000 trials per cell. Five visits at 3° of yaw
 *   noise, horizontal p50: the first visit alone 9.2 m, the mean 4.0,
 *   1/accuracy² 2.9, 1/accuracy 3.1 and the SHIPPED best-prefix 1/accuracy
 *   3.1 m when the bias tracks the reported accuracy; 9.6 / 3.8 / 4.7 / 4.0
 *   / 4.3 m (p90 8.1 against 7.1 for plain 1/accuracy) when it does not.
 *   Where the bias tracks the accuracy but shares a direction across
 *   visits, the subset gains 0.4-0.5 m (90°: 6.9 against 7.3; 0°: 7.3
 *   against 7.8). The heading weighted by `atan(accuracy / baseline)` wins
 *   in every arm (2.2° p50, 5.4° p90 against 5.0° / 19° for the first
 *   visit); taking it over the position's subset only costs 0.1-0.2°, so it
 *   keeps every visit.
 * - The heading model (`model`; enlarged 2026-10-01): 200 visits per walk
 *   length and shape, per GPS arm (it was 12). It is a conservative bound:
 *   measured over model 0.09-0.40 at p50 and 0.21-1.11 at p90 (white-noise
 *   only GPS 0.22-0.69 and up to 1.96); 0-12 % of visits exceed it (white
 *   noise only: up to 33 %). Default arm, heading p50 / p90: line walks
 *   12.8 / 37° at 15 m, 5.4 / 16° at 30 m, 3.2 / 9.4° at 60 m, 1.6 / 4.7°
 *   at 120 m. Per metre walked a line beats a loop from 30 m on (at 15 m
 *   the loop is slightly better). Drift of 1° per 100 m changed almost
 *   nothing; 3° per 100 m adds up to 0.8° p50 at 120 m.
 * - The verdict (`verdict`): 5,000 codes (1-5 visits) per row. The code's
 *   yaw sigma (1-5°) moves the Good share by at most 1 point; the yaw
 *   noise moves its precision (75 / 65 / 52 % within 5 m and 5° at 1 / 3 /
 *   5° when the bias tracks the accuracy); a hurried mix (4-20 m GPS,
 *   10-30 m walks) is almost never Good. Two pools of 320 differ by up to
 *   6 points of precision at the same setting: read the table to +-5.
 * - The Recorder's per-visit mint (`thresholds`, a pool of 160 visits) got
 *   the heading badly wrong when a visit started at the code (89° p50): it
 *   composed each sighting through the alignment of its own moment, the
 *   first look's alignment had no walk behind it, and the rotation average
 *   is unweighted, so no half-life helped. The end-of-visit alignment (the
 *   Tour Viewer's settle) gave 5.0° p50. FIXED 2026-10-02: the mint now
 *   places every sighting through the alignment at mint time
 *   (`currentAlignment`, owner decision retiring DEC-3; framework
 *   `qr-anchor-mint.start-at-code.test.ts`), and `accumulatorEstimate`
 *   below passes the visit's end alignment as that, so this arm measures the
 *   shipped path. Re-run 2026-10-02 (the same 160 visits, yaw noise 2°):
 *   the Recorder mint 4.7° / 16.7° heading p50 / p90 and 2.51 / 5.18 m,
 *   against 5.0° / 17.2° and 2.41 / 5.78 m for the Tour Viewer's settle;
 *   the half-life (5 s to 1e6 s) still changes nothing.
 * - The 15° spread gate (the same 160 visits) refuses 0 % of honest visits
 *   at 1-3° yaw noise (5 % at 5°) and catches a 20° re-hang 75-100 %; the
 *   4 s gap and the 60 s half-life change nothing in the Tour Viewer's flow.
 */

import { describe, expect, it } from "vitest";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import {
  createSlamAppStore,
  qrDetectedReducer,
  recordGpsEvent,
  selectAlignmentMatrix,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { aggregateQrPose } from "gps-plus-slam-app-framework/ar/qr";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import {
  createQrSightingAccumulator,
  type QrSightingObservation,
} from "gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator";
import {
  maxPairwiseRotationDeg,
  mintQrAnchorFromSightings,
} from "gps-plus-slam-app-framework/ar/qr/qr-anchor-mint";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { combineCodeVisits, type CodeVisitPose } from "./code-visit-combine.js";
import {
  VERDICT_GOOD_HEADING_DEG,
  VERDICT_GOOD_HORIZONTAL_M,
} from "./code-verdict.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";

// The library gates its geodesy helpers on a licence the framework store
// activates; build one before any module-level geodesy runs.
createTourViewerStore();

// ---------------------------------------------------------------------------
// Scenario constants. World frame: NUE metres relative to ORIGIN, Up =
// absolute altitude (the stack's GPS-world convention).
// ---------------------------------------------------------------------------

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const GROUND_ALT = 400;
const PHONE_ALT = 401.4;
/** Local +X points east, so the printed face looks south (normal 180°). */
const CODE_HEADING_DEG = 90;
const CODE_NORMAL_DEG = CODE_HEADING_DEG + 90;
const CODE_WORLD: Vector3 = [0, 401.5, 0];
const CODE_TEXT = "https://gps.csutil.com/tour/?qr=m3a-spike";
const CODE_SIZE_M = 0.16;
/** Where the author stands to look at the code (N, E): 2 m in front. */
const STAND: NE = [-2, 0];
const WALK_SPEED_MPS = 1.2;
const LOOK_S = 4;
const WALK_START_S = 5;
const DETECTION_INTERVAL_MS = 125;
const IDENTITY_Q: Quaternion = [0, 0, 0, 1];

type NE = readonly [number, number];

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** Signed angle difference a - b in (-180, 180]. */
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

// ---------------------------------------------------------------------------
// Deterministic randomness (test-local; one stream per purpose and seed).
// ---------------------------------------------------------------------------

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
// One visit: the walk, the odometry frame, the GPS, the solve.
// ---------------------------------------------------------------------------

interface GpsModel {
  /** Gauss-Markov wander sigma per axis, as a fraction of the accuracy. */
  readonly gmFrac: number;
  /** Its correlation time (s). */
  readonly gmTauS: number;
  /** White noise sigma per axis, as a fraction of the accuracy. */
  readonly whiteFrac: number;
}
interface DriftModel {
  /** Odometry yaw drift, degrees per 100 m walked (random sign). */
  readonly yawDegPer100m: number;
  /** Odometry position drift as a fraction of the distance walked. */
  readonly posFrac: number;
}
interface VisitSpec {
  readonly seed: number;
  /** The visit's reported GPS accuracy (m). */
  readonly accuracyM: number;
  /** Path length (m). */
  readonly walkM: number;
  readonly shape: "line" | "loop";
  readonly gps: GpsModel;
  readonly drift: DriftModel;
  /** A constant bias INSIDE the solve (N, E); only the decomposition test
   *  sets it - the sweeps add the bias after the solve. */
  readonly biasInSolve?: NE;
}

const DEFAULT_GPS: GpsModel = { gmFrac: 0.25, gmTauS: 60, whiteFrac: 0.15 };
const NO_DRIFT: DriftModel = { yawDegPer100m: 0, posFrac: 0 };
const DEFAULT_DRIFT: DriftModel = { yawDegPer100m: 1, posFrac: 0.01 };

interface Frame {
  readonly yaw0: number;
  readonly t0: Vector3;
  readonly yawSign: number;
  readonly driftDir: number;
}

interface FixSnapshot {
  readonly tMs: number;
  readonly alignment: number[] | null;
  readonly sampleCount: number;
}

interface VisitRun {
  readonly spec: VisitSpec;
  readonly path: readonly NE[];
  readonly frame: Frame;
  readonly zero: LatLong;
  readonly fixes: readonly FixSnapshot[];
  /** Largest horizontal distance between two points of the walk (m). */
  readonly baselineM: number;
  readonly looks: readonly (readonly [number, number])[];
  readonly endS: number;
}

function walkPath(spec: VisitSpec): NE[] {
  const rng = stream(spec.seed, 1);
  // Away from the wall: within 60° of the face normal.
  const phi = rad(CODE_NORMAL_DEG + (rng() * 120 - 60));
  const u: NE = [Math.cos(phi), Math.sin(phi)];
  const at = (a: number, b: number, v: NE = [0, 0]): NE => [
    STAND[0] + a * u[0] + b * v[0],
    STAND[1] + a * u[1] + b * v[1],
  ];
  if (spec.shape === "line") return [STAND, at(spec.walkM / 2, 0), STAND];
  const side = spec.walkM / 4;
  const sign = rng() < 0.5 ? -1 : 1;
  const v: NE = [-u[1] * sign, u[0] * sign];
  return [STAND, at(side, 0), at(side, side, v), at(0, side, v), STAND];
}

function pointAlong(path: readonly NE[], distance: number): NE {
  let left = distance;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len && len > 0) {
      const f = left / len;
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    left -= len;
  }
  return path[path.length - 1]!;
}

function pathLength(path: readonly NE[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i += 1) {
    sum += Math.hypot(
      path[i]![0] - path[i - 1]![0],
      path[i]![1] - path[i - 1]![1],
    );
  }
  return sum;
}

function maxPairwise(points: readonly NE[]): number {
  let worst = 0;
  for (const a of points) {
    for (const b of points)
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  return worst;
}

/** Distance walked by time `tS`. */
function walkedAt(spec: VisitSpec, tS: number): number {
  return Math.min(
    spec.walkM,
    Math.max(0, (tS - WALK_START_S) * WALK_SPEED_MPS),
  );
}

/** The odometry frame at `tS`: world = Ry(yaw) · odomNue + t. */
function frameAt(
  run: { spec: VisitSpec; frame: Frame },
  tS: number,
): { yaw: number; t: Vector3 } {
  const d = walkedAt(run.spec, tS);
  const { frame, spec } = run;
  const shift = spec.drift.posFrac * d;
  return {
    yaw: frame.yaw0 + frame.yawSign * rad(spec.drift.yawDegPer100m) * (d / 100),
    t: [
      frame.t0[0] + shift * Math.cos(frame.driftDir),
      frame.t0[1],
      frame.t0[2] + shift * Math.sin(frame.driftDir),
    ],
  };
}

function odomNueAt(
  run: { spec: VisitSpec; frame: Frame },
  world: Vector3,
  tS: number,
): Vector3 {
  const f = frameAt(run, tS);
  return rotY(-f.yaw, [
    world[0] - f.t[0],
    world[1] - f.t[1],
    world[2] - f.t[2],
  ]);
}

function createMeasuredStore() {
  return createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    extraReducers: { qrDetected: qrDetectedReducer },
    enableDevChecks: false,
  });
}

/** The visit's GPS errors per fix (N, E), excluding any constant bias. */
function gpsErrors(spec: VisitSpec, count: number): NE[] {
  const rng = stream(spec.seed, 2);
  const s = spec.gps.gmFrac * spec.accuracyM;
  const w = spec.gps.whiteFrac * spec.accuracyM;
  const rho = Math.exp(-1 / spec.gps.gmTauS);
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

/** Run one visit's GPS through the real store; snapshot after every fix. */
function runVisit(spec: VisitSpec): VisitRun {
  const path = walkPath(spec);
  const rng = stream(spec.seed, 3);
  const frame: Frame = {
    yaw0: rng() * 2 * Math.PI,
    t0: [
      STAND[0] + gaussian(rng) * 0.3,
      GROUND_ALT,
      STAND[1] + gaussian(rng) * 0.3,
    ],
    yawSign: rng() < 0.5 ? -1 : 1,
    driftDir: rng() * 2 * Math.PI,
  };
  const walkS = pathLength(path) / WALK_SPEED_MPS;
  const look2Start = WALK_START_S + walkS + 0.5;
  const looks: [number, number][] = [
    [0.5, 0.5 + LOOK_S],
    [look2Start, look2Start + LOOK_S],
  ];
  const endS = look2Start + LOOK_S + 0.5;
  const store = createMeasuredStore();
  const errors = gpsErrors(spec, Math.floor(endS) + 1);
  const bias = spec.biasInSolve ?? [0, 0];
  const fixes: FixSnapshot[] = [];
  let zero: LatLong | null = null;
  const run = { spec, frame };
  errors.forEach((err, i) => {
    const pos = i <= WALK_START_S ? STAND : pointAlong(path, walkedAt(spec, i));
    const truth: Vector3 = [pos[0], PHONE_ALT, pos[1]];
    const measured: Vector3 = [
      truth[0] + err[0] + bias[0],
      truth[1],
      truth[2] + err[1] + bias[1],
    ];
    const ll = calcGpsCoords(ORIGIN, measured);
    if (zero === null) {
      zero = ll;
      store.dispatch(setZeroPos(ll));
    }
    store.dispatch(
      recordGpsEvent({
        odomPosition: nueToWebxr(odomNueAt(run, truth, i)),
        odomRotation: IDENTITY_Q,
        rawGpsPoint: {
          id: `gps-${String(i)}`,
          latitude: ll.lat,
          longitude: ll.lon,
          altitude: measured[1],
          latLongAccuracy: spec.accuracyM,
          timestamp: EPOCH_MS + i * 1000,
        },
      }),
    );
    const a = selectAlignmentMatrix(store.getState());
    fixes.push({
      tMs: i * 1000,
      alignment: a === null ? null : Array.from(a),
      sampleCount: i + 1,
    });
  });
  if (zero === null) throw new Error("a visit needs at least one fix");
  return {
    spec,
    path,
    frame,
    zero,
    fixes,
    baselineM: maxPairwise(path),
    looks,
    endS,
  };
}

// ---------------------------------------------------------------------------
// The code as the camera sees it in a visit.
// ---------------------------------------------------------------------------

interface LookNoise {
  /** Per-look yaw error (deg, sigma): systematic within a look. */
  readonly yawNoiseDeg: number;
  /** Per-look horizontal position error (m, sigma per axis). */
  readonly lookPosM: number;
  /** Per-detection jitter: yaw (deg) and position (m) sigmas. */
  readonly detYawDeg: number;
  readonly detPosM: number;
  /** Chance per detection that the next one comes after a dropout. */
  readonly dropoutP: number;
  /** A dropout's length, uniform in [min, max] seconds. */
  readonly dropoutS: readonly [number, number];
  /** The code really turned by this much (deg) before every look after
   *  the first: a re-hung poster, for the "moved" gate. */
  readonly laterLooksTurnDeg?: number;
}
const DEFAULT_LOOK: LookNoise = {
  yawNoiseDeg: 2,
  lookPosM: 0.05,
  detYawDeg: 2,
  detPosM: 0.02,
  dropoutP: 0.03,
  dropoutS: [0.5, 3],
};

interface Detection {
  readonly look: number;
  readonly tS: number;
  readonly pose: Pose;
}

function codePoseAt(
  run: VisitRun,
  tS: number,
  yawErrDeg: number,
  offset: NE,
): Pose {
  const world: Vector3 = [
    CODE_WORLD[0] + offset[0],
    CODE_WORLD[1],
    CODE_WORLD[2] + offset[1],
  ];
  const f = frameAt(run, tS);
  return {
    position: nueToWebxr(odomNueAt(run, world, tS)),
    rotation: yawQuat(
      Math.PI / 2 - f.yaw - rad(CODE_HEADING_DEG) + rad(yawErrDeg),
    ),
  };
}

function lookDetections(
  run: VisitRun,
  look: number,
  noise: LookNoise,
  rng: () => number,
): Detection[] {
  const [from, to] = run.looks[look]!;
  const lookYaw =
    noise.yawNoiseDeg * gaussian(rng) +
    (look > 0 ? (noise.laterLooksTurnDeg ?? 0) : 0);
  const lookOffset: NE = [
    noise.lookPosM * gaussian(rng),
    noise.lookPosM * gaussian(rng),
  ];
  const out: Detection[] = [];
  let t = from;
  while (t <= to) {
    const offset: NE = [
      lookOffset[0] + noise.detPosM * gaussian(rng),
      lookOffset[1] + noise.detPosM * gaussian(rng),
    ];
    out.push({
      look,
      tS: t,
      pose: codePoseAt(
        run,
        t,
        lookYaw + noise.detYawDeg * gaussian(rng),
        offset,
      ),
    });
    const [lo, hi] = noise.dropoutS;
    t +=
      rng() < noise.dropoutP
        ? lo + rng() * (hi - lo)
        : DETECTION_INTERVAL_MS / 1000;
  }
  return out;
}

function visitDetections(
  run: VisitRun,
  noise: LookNoise,
  seed: number,
): Detection[] {
  const rng = stream(run.spec.seed * 31 + seed, 4);
  return run.looks.flatMap((_, i) => lookDetections(run, i, noise, rng));
}

// ---------------------------------------------------------------------------
// Per-visit estimates, in the truth frame.
// ---------------------------------------------------------------------------

/** One visit's estimate of the code, in the truth frame (N, E metres from
 *  ORIGIN; the face normal's bearing), with the quality the visit knows. */
interface VisitEstimate {
  readonly n: number;
  readonly e: number;
  readonly normalDeg: number;
  readonly accuracyM: number;
  readonly baselineM: number;
}

function normalBearingDeg(q: Quaternion): number {
  // +z (out of the printed face) rotated by q, then the bearing of (N, E).
  const [x, y, z, w] = q;
  const nx = 2 * (x * z + w * y);
  const nz = 1 - 2 * (x * x + y * y);
  return deg(Math.atan2(nz, nx));
}

/** A minted geo pose in the truth frame: N, E metres from ORIGIN and the
 *  printed face's bearing. */
function truthPose(geo: QrGeoPose): {
  n: number;
  e: number;
  normalDeg: number;
} {
  const nue = calcRelativeCoordsInMeters(
    ORIGIN,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  if (geo.rotation === undefined) throw new Error("the mint wrote no rotation");
  return { n: nue[0], e: nue[2], normalDeg: normalBearingDeg(geo.rotation) };
}

function estimateFromGeo(geo: QrGeoPose, run: VisitRun): VisitEstimate {
  return {
    ...truthPose(geo),
    accuracyM: run.spec.accuracyM,
    baselineM: run.baselineM,
  };
}

function alignmentAt(run: VisitRun, tS: number): FixSnapshot | null {
  let found: FixSnapshot | null = null;
  for (const fix of run.fixes) {
    if (fix.tMs > tS * 1000) break;
    found = fix;
  }
  return found;
}

/**
 * The Tour Viewer's visit composition today (`visit-settle.ts`,
 * "measured-here"): the code's stable pose from the visit's LAST look,
 * through the visit's alignment at its END.
 */
function endAlignmentEstimate(
  run: VisitRun,
  detections: readonly Detection[],
): VisitEstimate | null {
  const lastLook = Math.max(...detections.map((d) => d.look));
  const poses = detections
    .filter((d) => d.look === lastLook)
    .map((d) => d.pose)
    .slice(-32);
  const aggregate = aggregateQrPose(poses);
  const end = run.fixes[run.fixes.length - 1]?.alignment ?? null;
  if (aggregate === null || end === null) return null;
  const world = throughAlignment(odomNueFromWebXr(aggregate.pose), end);
  if (world === null) return null;
  const geo = mintQrGeoPose({
    worldNuePosition: {
      x: world.position[0],
      y: world.position[1],
      z: world.position[2],
    },
    worldNueRotation: [...world.rotation],
    zero: run.zero,
  });
  return estimateFromGeo(geo, run);
}

interface AccumulatorParams {
  readonly gapMs: number;
  readonly halfLifeS: number;
  readonly maxSpreadDeg: number;
}
const RECORDER_DEFAULTS: AccumulatorParams = {
  gapMs: 4000,
  halfLifeS: 60,
  maxSpreadDeg: 15,
};

/**
 * The Recorder's mint, run on ONE visit's detections: each detection carries
 * the alignment as it stood then (what the Recorder's feeder snapshots), the
 * accumulator folds them into sightings by the gap, and the mint gates the
 * rotation spread, places every sighting through the visit's END alignment
 * (`currentAlignment`, as the Recorder's save does) and weights the position
 * by recency.
 */
function accumulatorEstimate(
  run: VisitRun,
  detections: readonly Detection[],
  p: AccumulatorParams,
): {
  estimate: VisitEstimate | null;
  refused: string | null;
  sightings: number;
  spreadDeg: number;
} {
  const acc = createQrSightingAccumulator({ gapMs: p.gapMs });
  for (const d of detections) {
    const fix = alignmentAt(run, d.tS);
    const observation: QrSightingObservation = {
      text: CODE_TEXT,
      timestamp: EPOCH_MS + d.tS * 1000,
      odomPose: d.pose,
      sizeM: CODE_SIZE_M,
      alignmentMatrix: (fix?.alignment ??
        null) as QrSightingObservation["alignmentMatrix"],
      zero: run.zero,
      alignmentSampleCount: fix?.sampleCount ?? 0,
      gpsAccuracyM: run.spec.accuracyM,
    };
    acc.observe(observation);
  }
  const sightings = acc.sightingsIncludingOpen(CODE_TEXT);
  const spreadDeg = maxPairwiseRotationDeg(
    sightings.map((s) => s.odomPose.rotation),
  );
  const end = run.fixes[run.fixes.length - 1];
  const result = mintQrAnchorFromSightings({
    sightings,
    spansFrameChange: false,
    nowIso: new Date(EPOCH_MS).toISOString(),
    maxFixedRotationSpreadDeg: p.maxSpreadDeg,
    recencyHalfLifeS: p.halfLifeS,
    ...(end === undefined
      ? {}
      : {
          currentAlignment: {
            alignmentMatrix: (end.alignment ??
              null) as QrSightingObservation["alignmentMatrix"],
            zero: run.zero,
            alignmentSampleCount: end.sampleCount,
            segment: 0,
          },
        }),
  });
  if (!result.ok) {
    return {
      estimate: null,
      refused: result.reason,
      sightings: sightings.length,
      spreadDeg,
    };
  }
  const geo = result.level.ok ? result.level.level.qr.geo : undefined;
  return {
    estimate: geo === undefined ? null : estimateFromGeo(geo, run),
    refused: null,
    sightings: sightings.length,
    spreadDeg,
  };
}

function errorOf(est: { n: number; e: number; normalDeg: number }): {
  m: number;
  deg: number;
} {
  return {
    m: Math.hypot(est.n - CODE_WORLD[0], est.e - CODE_WORLD[2]),
    deg: Math.abs(wrapDeg(est.normalDeg - CODE_NORMAL_DEG)),
  };
}

const SHORT_SPEC: VisitSpec = {
  seed: 1,
  accuracyM: 5,
  walkM: 30,
  shape: "loop",
  gps: { gmFrac: 0, gmTauS: 60, whiteFrac: 0 },
  drift: NO_DRIFT,
};
const QUIET_LOOK: LookNoise = {
  ...DEFAULT_LOOK,
  yawNoiseDeg: 0,
  lookPosM: 0,
  detYawDeg: 0,
  detPosM: 0,
};

describe("M3a fixture: the synthetic multi-visit replay is sound", () => {
  // Why this test matters: every table of the spike rests on the fixture's
  // frame math (an arbitrary per-visit WebXR yaw, the raw-to-NUE basis, the
  // solver's alignment). With exact GPS and an exact camera, the real solver
  // and the Tour Viewer's composition must put the code where it is - for
  // both walk shapes and several arbitrary frames. A 90° basis slip or a
  // sign error would show as metres and tens of degrees here.
  it.each([
    ["loop", 1],
    ["loop", 2],
    ["line", 3],
    ["line", 4],
  ] as const)(
    "exact GPS and camera recover the code (%s, seed %i)",
    (shape, seed) => {
      const run = runVisit({ ...SHORT_SPEC, shape, seed });
      const est = endAlignmentEstimate(
        run,
        visitDetections(run, QUIET_LOOK, 0),
      );
      expect(est).not.toBeNull();
      const err = errorOf(est!);
      expect(err.m).toBeLessThan(0.05);
      expect(err.deg).toBeLessThan(0.2);
    },
  );

  // Why this test matters: the sweeps add each visit's constant GPS bias
  // AFTER the solve, which is only honest if the solver's answer to a
  // constant bias is exactly that bias as a translation, with no turn. This
  // proves it on the real solver, with the time-varying GPS error present,
  // for two bias directions. If a later solver version trimmed or weighted
  // positions non-uniformly, this would fail and the sweeps would have to
  // run the bias inside the solve.
  it.each([
    [[8, -6] as NE, 11],
    [[-12, 3] as NE, 12],
  ])(
    "a constant GPS bias %j moves the estimate by exactly that bias",
    (bias, seed) => {
      const spec: VisitSpec = {
        ...SHORT_SPEC,
        seed,
        accuracyM: 8,
        gps: DEFAULT_GPS,
      };
      const plain = runVisit(spec);
      const biased = runVisit({ ...spec, biasInSolve: bias });
      const look = visitDetections(plain, DEFAULT_LOOK, 0);
      const a = endAlignmentEstimate(plain, look)!;
      const b = endAlignmentEstimate(
        biased,
        visitDetections(biased, DEFAULT_LOOK, 0),
      )!;
      expect(Math.hypot(b.n - a.n - bias[0], b.e - a.e - bias[1])).toBeLessThan(
        0.02,
      );
      expect(Math.abs(wrapDeg(b.normalDeg - a.normalDeg))).toBeLessThan(0.01);
    },
  );

  // Why this test matters: it pins the Recorder's mint running on one
  // visit's detections through the same fixture, so the threshold sweeps
  // compare like with like. With exact inputs it must agree with the truth
  // as well as the Tour Viewer's composition does.
  it("the Recorder's per-visit mint recovers the code with exact inputs", () => {
    const run = runVisit({ ...SHORT_SPEC, seed: 5 });
    const result = accumulatorEstimate(
      run,
      visitDetections(run, QUIET_LOOK, 0),
      RECORDER_DEFAULTS,
    );
    expect(result.refused).toBeNull();
    expect(result.sightings).toBeGreaterThanOrEqual(2);
    const err = errorOf(result.estimate!);
    expect(err.m).toBeLessThan(0.1);
  });
});

// ===========================================================================
// The measured sweeps (opt-in). Each prints its table; the assertions pin
// only the qualitative verdicts the M3a results doc draws from them.
// ===========================================================================

const SPIKE = process.env.CODE_ESTIMATE_SPIKE;
const runs = (part: string): boolean => SPIKE === "1" || SPIKE === part;
/** Plain text on stdout (vitest swallows console output of passing tests). */
const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const WALKS_M = [15, 30, 60, 120] as const;

/** Which visits a pool holds: the reported accuracy's range and the walk
 *  lengths (each walked as a line and as a loop). */
interface PoolMix {
  readonly name: string;
  readonly accuracyM: readonly [number, number];
  readonly walksM: readonly number[];
}
/** The spike's default: accuracy 3-15 m, walks of 15-120 m. */
const MIX_DEFAULT: PoolMix = {
  name: "accuracy 3-15 m, walks 15/30/60/120 m",
  accuracyM: [3, 15],
  walksM: WALKS_M,
};
/** A hurried author (M3a/M3b review #4): poorer GPS and short walks. */
const MIX_HURRIED: PoolMix = {
  name: "accuracy 4-20 m, walks 10/15/20/30 m",
  accuracyM: [4, 20],
  walksM: [10, 15, 20, 30],
};

/** A pool of independent visits: accuracy uniform in the mix's range, the
 *  walk lengths and shapes cycled so every cell is equally filled. */
function buildPool(
  size: number,
  gps: GpsModel = DEFAULT_GPS,
  drift: DriftModel = DEFAULT_DRIFT,
  seedBase = 1000,
  mix: PoolMix = MIX_DEFAULT,
): VisitRun[] {
  const pool: VisitRun[] = [];
  const [lo, hi] = mix.accuracyM;
  const walks = mix.walksM;
  for (let i = 0; i < size; i += 1) {
    const rng = stream(seedBase + i, 9);
    pool.push(
      runVisit({
        seed: seedBase + i,
        accuracyM: lo + (hi - lo) * rng(),
        walkM: walks[i % walks.length]!,
        shape: Math.floor(i / walks.length) % 2 === 0 ? "loop" : "line",
        gps,
        drift,
      }),
    );
  }
  return pool;
}

function quantile(values: readonly number[], q: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i]!;
}
const fmt = (v: number, digits = 1): string =>
  Number.isFinite(v) ? v.toFixed(digits) : "-";
function cell(values: readonly number[], digits = 1): string {
  return `${fmt(quantile(values, 0.5), digits)} / ${fmt(quantile(values, 0.9), digits)}`;
}

// ---------------------------------------------------------------------------
// Combining strategies over several visits' estimates.
// ---------------------------------------------------------------------------

type Pose2 = { n: number; e: number; normalDeg: number };
type Strategy = (visits: readonly VisitEstimate[]) => Pose2;

function circularMeanDeg(
  degrees: readonly number[],
  weights: readonly number[],
): number {
  let s = 0;
  let c = 0;
  degrees.forEach((d, i) => {
    s += weights[i]! * Math.sin(rad(d));
    c += weights[i]! * Math.cos(rad(d));
  });
  return deg(Math.atan2(s, c));
}
function weightedMean(
  visits: readonly VisitEstimate[],
  posW: readonly number[],
  headW: readonly number[],
): Pose2 {
  const total = posW.reduce((a, b) => a + b, 0);
  return {
    n: visits.reduce((sum, v, i) => sum + v.n * posW[i]!, 0) / total,
    e: visits.reduce((sum, v, i) => sum + v.e * posW[i]!, 0) / total,
    normalDeg: circularMeanDeg(
      visits.map((v) => v.normalDeg),
      headW,
    ),
  };
}
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** The model's per-visit heading sigma (rad): code noise and
 *  `atan(accuracy / baseline)` (plan §3.3), for weighting only. */
const headingSigma = (v: VisitEstimate, codeSigmaDeg = 2): number =>
  Math.hypot(rad(codeSigmaDeg), Math.atan(v.accuracyM / v.baselineM));

/** The most accurate visits, as many as minimise `sqrt(k) / sum(1/a)` -
 *  `combineCodeVisits`' position subset (M3a/M3b review #3). */
function bestPrefix(vs: readonly VisitEstimate[]): VisitEstimate[] {
  const sorted = [...vs].sort((a, b) => a.accuracyM - b.accuracyM);
  let bestK = 1;
  let best = Number.POSITIVE_INFINITY;
  let inverse = 0;
  sorted.forEach((v, i) => {
    inverse += 1 / v.accuracyM;
    const p = Math.sqrt(i + 1) / inverse;
    if (p <= best) {
      best = p;
      bestK = i + 1;
    }
  });
  return sorted.slice(0, bestK);
}

/** What `combineCodeVisits` ships: position by 1/accuracy over the best
 *  prefix, heading by the heading model over `headingVisits` (every visit
 *  unless a variant says otherwise). */
function subsetStrategy(
  vs: readonly VisitEstimate[],
  codeSigmaDeg = 2,
  headingOverSubset = false,
): Pose2 {
  const subset = bestPrefix(vs);
  const position = weightedMean(
    subset,
    subset.map((v) => 1 / v.accuracyM),
    subset.map(() => 1),
  );
  const headingVisits = headingOverSubset ? subset : vs;
  const heading = weightedMean(
    headingVisits,
    headingVisits.map(() => 1),
    headingVisits.map((v) => 1 / headingSigma(v, codeSigmaDeg) ** 2),
  );
  return { n: position.n, e: position.e, normalDeg: heading.normalDeg };
}

const STRATEGIES: Record<string, Strategy> = {
  first: (vs) => vs[0]!,
  last: (vs) => vs[vs.length - 1]!,
  mean: (vs) =>
    weightedMean(
      vs,
      vs.map(() => 1),
      vs.map(() => 1),
    ),
  /** §3.3's candidate: weighted by each visit's GPS quality - position by
   *  1/accuracy², heading by 1/sigma² of the heading model. */
  weighted: (vs) =>
    weightedMean(
      vs,
      vs.map((v) => 1 / v.accuracyM ** 2),
      vs.map((v) => 1 / headingSigma(v) ** 2),
    ),
  /** Position unweighted, heading weighted by the heading model: trusts
   *  only the baseline, which the page measures itself. */
  headWeighted: (vs) =>
    weightedMean(
      vs,
      vs.map(() => 1),
      vs.map((v) => 1 / headingSigma(v) ** 2),
    ),
  /** Position by 1/accuracy (half the trust in the reported accuracy),
   *  heading by the heading model. */
  hybrid: (vs) =>
    weightedMean(
      vs,
      vs.map((v) => 1 / v.accuracyM),
      vs.map((v) => 1 / headingSigma(v) ** 2),
    ),
  /** SHIPPED (M3a/M3b review #3): `hybrid` over the best prefix by
   *  accuracy for the position, the heading over every visit. */
  subset: (vs) => subsetStrategy(vs),
  /** The same with the heading over the prefix too: measures what the
   *  heading would lose by following the position's subset. */
  subsetHead: (vs) => subsetStrategy(vs, 2, true),
  /** Coordinate-wise median, heading as the median offset from the mean. */
  median: (vs) => {
    const mean = circularMeanDeg(
      vs.map((v) => v.normalDeg),
      vs.map(() => 1),
    );
    return {
      n: median(vs.map((v) => v.n)),
      e: median(vs.map((v) => v.e)),
      normalDeg: mean + median(vs.map((v) => wrapDeg(v.normalDeg - mean))),
    };
  },
};

// ---------------------------------------------------------------------------
// Bias models: what each visit's constant GPS bias is.
// ---------------------------------------------------------------------------

interface BiasModel {
  /** `coupled`: |bias| = accuracy x U(0.6, 1.4) - the reported accuracy
   *  predicts the error. `independent`: |bias| ~ U(3, 15) whatever the
   *  accuracy says. */
  readonly coupling: "coupled" | "independent";
  /** How far the visits' bias directions spread around a common one
   *  (degrees, full width): 360 = independent directions, 0 = the same
   *  direction every visit (fully correlated). */
  readonly directionSpreadDeg: number;
}

function biases(
  visits: readonly VisitEstimate[],
  model: BiasModel,
  rng: () => number,
): NE[] {
  const common = rng() * 2 * Math.PI;
  return visits.map((v) => {
    const size =
      model.coupling === "coupled"
        ? v.accuracyM * (0.6 + 0.8 * rng())
        : 3 + 12 * rng();
    const dir = common + rad(model.directionSpreadDeg) * (rng() - 0.5);
    return [size * Math.cos(dir), size * Math.sin(dir)];
  });
}

function withBias(v: VisitEstimate, b: NE): VisitEstimate {
  return { ...v, n: v.n + b[0], e: v.e + b[1] };
}

/** Every pool visit's Tour Viewer estimate (no bias yet) for one look noise. */
function poolEstimates(
  pool: readonly VisitRun[],
  look: LookNoise,
): VisitEstimate[] {
  return pool.map((run) => {
    const est = endAlignmentEstimate(run, visitDetections(run, look, 0));
    if (est === null) throw new Error(`visit ${run.spec.seed} has no estimate`);
    return est;
  });
}

function sampleVisits(
  estimates: readonly VisitEstimate[],
  k: number,
  rng: () => number,
): VisitEstimate[] {
  const chosen = new Set<number>();
  while (chosen.size < k) chosen.add(Math.floor(rng() * estimates.length));
  return [...chosen].map((i) => estimates[i]!);
}

interface TrialOutcome {
  readonly visits: readonly VisitEstimate[];
  readonly errors: Record<string, { m: number; deg: number }>;
}

function runTrials(
  estimates: readonly VisitEstimate[],
  k: number,
  model: BiasModel,
  trials: number,
  seed: number,
): TrialOutcome[] {
  const rng = mulberry32(seed);
  const out: TrialOutcome[] = [];
  for (let t = 0; t < trials; t += 1) {
    const chosen = sampleVisits(estimates, k, rng);
    const bs = biases(chosen, model, rng);
    const visits = chosen.map((v, i) => withBias(v, bs[i]!));
    const errors: Record<string, { m: number; deg: number }> = {};
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      errors[name] = errorOf(strategy(visits));
    }
    out.push({ visits, errors });
  }
  return out;
}

const POOL_SIZE = 320;
const TRIALS = 2000;

function strategyTable(
  estimates: readonly VisitEstimate[],
  model: BiasModel,
): Map<number, TrialOutcome[]> {
  const byK = new Map<number, TrialOutcome[]>();
  print(`k | ${Object.keys(STRATEGIES).join(" || ")}`);
  for (let k = 1; k <= 5; k += 1) {
    const outcomes = runTrials(
      estimates,
      k,
      model,
      TRIALS,
      k * 97 + model.directionSpreadDeg,
    );
    byK.set(k, outcomes);
    const cells = Object.keys(STRATEGIES).map(
      (name) =>
        `${cell(outcomes.map((o) => o.errors[name]!.m))} m, ${cell(outcomes.map((o) => o.errors[name]!.deg))}°`,
    );
    print(`${k} | ${cells.join(" || ")}`);
  }
  return byK;
}

/** A spike estimate as the production combiner takes it. */
function asCodeVisit(v: VisitEstimate): CodeVisitPose {
  const ll = calcGpsCoords(ORIGIN, [v.n, CODE_WORLD[1], v.e]);
  const half = (-(v.normalDeg - 90) * Math.PI) / 360;
  return {
    geo: {
      lat: ll.lat,
      lon: ll.lon,
      alt: CODE_WORLD[1],
      rotation: [0, Math.sin(half), 0, Math.cos(half)],
    },
    gpsAccuracyM: v.accuracyM,
    baselineM: v.baselineM,
  };
}

describe("M3a: the production combiner is the spike's subset strategy", () => {
  // Why this test matters: the spike's tables measure the test-local
  // `subset` strategy; `combineCodeVisits` is what the summary ships. This
  // pins that the two are the same computation, on real fixture visits
  // with biases added, so the tables stay evidence for the shipped code.
  // The accuracies (3, 6, 9, 12 m) make the best prefix two visits, so the
  // subset path itself is compared, not only a plain weighted mean.
  it("agrees with the subset strategy on biased fixture visits", () => {
    const estimates = [21, 22, 23, 24].map((seed, i) => {
      const run = runVisit({
        ...SHORT_SPEC,
        seed,
        accuracyM: 3 + 3 * i,
        walkM: 15 * (i + 1),
        shape: i % 2 === 0 ? "line" : "loop",
        gps: DEFAULT_GPS,
      });
      return endAlignmentEstimate(run, visitDetections(run, DEFAULT_LOOK, 0))!;
    });
    const rng = mulberry32(77);
    const visits = estimates.map((v) =>
      withBias(v, [8 * gaussian(rng), 8 * gaussian(rng)]),
    );
    const spike = STRATEGIES["subset"]!(visits);
    const combined = combineCodeVisits(visits.map(asCodeVisit))!;
    expect(combined.positionVisitCount).toBe(2);
    expect(bestPrefix(visits)).toHaveLength(2);
    const shipped = truthPose(combined.geo);
    expect(Math.hypot(shipped.n - spike.n, shipped.e - spike.e)).toBeLessThan(
      0.01,
    );
    expect(Math.abs(wrapDeg(shipped.normalDeg - spike.normalDeg))).toBeLessThan(
      0.01,
    );
  });
});

describe.runIf(runs("strategies"))(
  "M3a strategies: one world pose from several visits",
  () => {
    // Why this test matters: it is the measured answer to question 1 of
    // M3a - which way of combining a code's visits is closest to the truth,
    // under which GPS error structure. The pins are the qualitative
    // verdicts; the numbers are in the printed tables.
    it("compares first, last, mean, weighted and median", () => {
      const pool = buildPool(POOL_SIZE);
      for (const yawNoiseDeg of [1, 3, 5]) {
        const estimates = poolEstimates(pool, {
          ...DEFAULT_LOOK,
          yawNoiseDeg,
        });
        for (const coupling of ["coupled", "independent"] as const) {
          for (const directionSpreadDeg of [360, 90, 0]) {
            print(
              `\n### yaw noise ${yawNoiseDeg}°, bias ${coupling}, direction spread ${directionSpreadDeg}°: horizontal p50 / p90, heading p50 / p90`,
            );
            const byK = strategyTable(estimates, {
              coupling,
              directionSpreadDeg,
            });
            if (directionSpreadDeg !== 360) continue;
            const five = byK.get(5)!;
            const p50 = (name: string): number =>
              quantile(
                five.map((o) => o.errors[name]!.m),
                0.5,
              );
            // Independent bias directions: averaging five visits must beat
            // keeping the first one.
            expect(p50("mean")).toBeLessThan(p50("first"));
            expect(p50("weighted")).toBeLessThan(p50("first"));
          }
        }
      }
    }, 1_800_000);
  },
);

// ---------------------------------------------------------------------------
// The heading model of plan §3.3.
// ---------------------------------------------------------------------------

/** `atan(accuracy / baseline)` in degrees: plan §3.3's heading error model. */
const modelHeadingDeg = (v: VisitEstimate): number =>
  deg(Math.atan(v.accuracyM / v.baselineM));

interface ModelArm {
  readonly name: string;
  readonly gps: GpsModel;
  readonly drift: DriftModel;
}
const MODEL_ARMS: readonly ModelArm[] = [
  {
    name: "default (gm 0.25, tau 60 s, white 0.15)",
    gps: DEFAULT_GPS,
    drift: NO_DRIFT,
  },
  { name: "gm 0.10", gps: { ...DEFAULT_GPS, gmFrac: 0.1 }, drift: NO_DRIFT },
  { name: "gm 0.50", gps: { ...DEFAULT_GPS, gmFrac: 0.5 }, drift: NO_DRIFT },
  { name: "tau 20 s", gps: { ...DEFAULT_GPS, gmTauS: 20 }, drift: NO_DRIFT },
  { name: "tau 180 s", gps: { ...DEFAULT_GPS, gmTauS: 180 }, drift: NO_DRIFT },
  {
    name: "white only 0.5",
    gps: { gmFrac: 0, gmTauS: 60, whiteFrac: 0.5 },
    drift: NO_DRIFT,
  },
  {
    name: "default + drift 1°/100 m, 1 %",
    gps: DEFAULT_GPS,
    drift: DEFAULT_DRIFT,
  },
  {
    name: "default + drift 3°/100 m, 3 %",
    gps: DEFAULT_GPS,
    drift: { yawDegPer100m: 3, posFrac: 0.03 },
  },
];

/** The heading-model pool per GPS arm: 200 visits per walk length and
 *  shape (4 x 2 cells). It was 96 (12 per cell) until the M3a/M3b review
 *  (#4) - too few for a p90. About 2.3 minutes per arm, 19 in all. */
const MODEL_POOL_SIZE = 1600;

describe.runIf(runs("model"))(
  "M3a heading model: atan(GPS error / walked baseline)",
  () => {
    // Why this test matters: plan §3.3 quotes `atan(GPS error / walked
    // baseline)` (18° at 5 m over 15 m, 6° over 50 m) as what governs the
    // geo facing line. This measures the alignment's real heading error per
    // walk length and shape, with the code itself exact, and reports the
    // ratio to the model, for several GPS error structures. It also answers
    // "from more directions": a line and a loop of the same length.
    it("measures the alignment's heading error against the model", () => {
      let defaultRatios: number[] = [];
      for (const arm of MODEL_ARMS) {
        const pool = buildPool(MODEL_POOL_SIZE, arm.gps, arm.drift, 5000);
        const estimates = poolEstimates(pool, QUIET_LOOK);
        if (arm === MODEL_ARMS[0]) {
          defaultRatios = estimates.map(
            (v) => errorOf(v).deg / modelHeadingDeg(v),
          );
        }
        print(
          `\n### ${arm.name}: heading err p50 / p90 | ratio to model p50 / p90 | position err (no bias) p50 / p90 | share over model (visits per row)`,
        );
        for (const walk of WALKS_M) {
          for (const shape of ["line", "loop"] as const) {
            const rows = estimates.filter(
              (_, i) =>
                pool[i]!.spec.walkM === walk && pool[i]!.spec.shape === shape,
            );
            const errs = rows.map((v) => errorOf(v));
            const ratios = rows.map(
              (v, i) => errs[i]!.deg / modelHeadingDeg(v),
            );
            const over = ratios.filter((r) => r > 1).length / ratios.length;
            print(
              `${walk} m ${shape} (baseline ${fmt(rows[0]!.baselineM)} m) | ${cell(errs.map((e) => e.deg))}° | ${cell(ratios, 2)} | ${cell(errs.map((e) => e.m))} m | ${fmt(100 * over, 0)} % (n ${String(rows.length)})`,
            );
          }
        }
      }
      // The pin: with the default GPS model the model is an upper bound
      // for most visits (the measured error sits below it at the median).
      expect(defaultRatios).toHaveLength(MODEL_POOL_SIZE);
      expect(quantile(defaultRatios, 0.5)).toBeLessThan(1);
    }, 1_800_000);
  },
);

// ---------------------------------------------------------------------------
// The Recorder's three guesses inside one visit (question 2).
// ---------------------------------------------------------------------------

let thresholdPool: VisitRun[] | null = null;
const getThresholdPool = (): VisitRun[] =>
  (thresholdPool ??= buildPool(160, DEFAULT_GPS, DEFAULT_DRIFT, 7000));

const SPREAD_LIMITS_DEG = [5, 8, 10, 15, 20, 30] as const;
const NO_GATE: AccumulatorParams = { ...RECORDER_DEFAULTS, maxSpreadDeg: 360 };

describe.runIf(runs("thresholds"))(
  "M3a thresholds: the Recorder's 15°, 60 s and 4 s inside one visit",
  () => {
    // Why this test matters: the 15° "moved" gate compares sightings'
    // odometry rotations, which inside ONE visit share a frame. Too low and
    // an honest code is refused for pose noise; too high and a re-hung
    // poster passes. This measures both rates per yaw noise.
    it("sweeps the rotation-spread gate", () => {
      const pool = getThresholdPool();
      print(
        `\n### spread gate: % of visits refused as "moved" at limits ${SPREAD_LIMITS_DEG.join(", ")}° | spread p50 / p90 / p99`,
      );
      for (const yawNoiseDeg of [1, 2, 3, 5]) {
        for (const turn of [0, 10, 20, 30]) {
          const look = {
            ...DEFAULT_LOOK,
            yawNoiseDeg,
            laterLooksTurnDeg: turn,
          };
          const spreads = pool.map(
            (run, i) =>
              accumulatorEstimate(run, visitDetections(run, look, i), NO_GATE)
                .spreadDeg,
          );
          const refused = SPREAD_LIMITS_DEG.map(
            (limit) =>
              `${fmt((100 * spreads.filter((s) => s > limit).length) / spreads.length, 0)} %`,
          );
          print(
            `yaw ${yawNoiseDeg}°, turned ${turn}° | ${refused.join(" | ")} | ${fmt(quantile(spreads, 0.5))} / ${fmt(quantile(spreads, 0.9))} / ${fmt(quantile(spreads, 0.99))}°`,
          );
        }
      }
      expect(pool.length).toBe(160);
    }, 1_800_000);

    // Why this test matters: the half-life weights a visit's sightings by
    // recency. Until 2026-10-02 each was composed through the alignment of
    // ITS moment (DEC-3); the mint now places them all through the visit's
    // END alignment, like the Tour Viewer's settle, which composes only the
    // last look. This measures both, so the choice is evidence, not habit.
    it("sweeps the recency half-life against the end-alignment composition", () => {
      const pool = getThresholdPool();
      const look = DEFAULT_LOOK;
      const ends = pool.map((run, i) =>
        errorOf(endAlignmentEstimate(run, visitDetections(run, look, i))!),
      );
      print(
        `\n### half-life (no gate, gap 4 s, yaw noise 2°): position p50 / p90 (no bias), heading p50 / p90`,
      );
      print(
        `end alignment, last look (Tour Viewer) | ${cell(
          ends.map((e) => e.m),
          2,
        )} m | ${cell(ends.map((e) => e.deg))}°`,
      );
      for (const halfLifeS of [5, 15, 30, 60, 120, 600, 1e6]) {
        const errs = pool.map((run, i) => {
          const r = accumulatorEstimate(run, visitDetections(run, look, i), {
            ...NO_GATE,
            halfLifeS,
          });
          return r.estimate === null
            ? { m: NaN, deg: NaN }
            : errorOf(r.estimate);
        });
        print(
          `half-life ${halfLifeS} s | ${cell(
            errs.map((e) => e.m),
            2,
          )} m | ${cell(errs.map((e) => e.deg))}°`,
        );
      }
      expect(ends.length).toBe(160);
    }, 1_800_000);

    // Why this test matters: the gap decides how many sightings one visit
    // becomes. More sightings means more pairs for the spread gate (more
    // false "moved") and, under recency weighting, a split look counted
    // twice. This measures the count, the false refusals at 15° and the
    // error per gap, with short and with long tracking dropouts.
    it("sweeps the sighting gap", () => {
      const pool = getThresholdPool();
      for (const dropoutS of [
        [0.5, 3],
        [0.5, 10],
      ] as const) {
        print(
          `\n### gap, dropouts ${dropoutS[0]}-${dropoutS[1]} s: sightings per visit p50 / p90 | refused at 15° | position p50 / p90 | heading p50 / p90`,
        );
        const look = { ...DEFAULT_LOOK, dropoutP: 0.05, dropoutS };
        for (const gapMs of [500, 1000, 2000, 4000, 8000, 30_000]) {
          const results = pool.map((run, i) =>
            accumulatorEstimate(run, visitDetections(run, look, i), {
              ...RECORDER_DEFAULTS,
              gapMs,
            }),
          );
          const refused =
            results.filter((r) => r.refused !== null).length / results.length;
          const errs = results.map((r) =>
            r.estimate === null ? { m: NaN, deg: NaN } : errorOf(r.estimate),
          );
          print(
            `gap ${gapMs / 1000} s | ${cell(
              results.map((r) => r.sightings),
              0,
            )} | ${fmt(100 * refused, 0)} % | ${cell(
              errs.map((e) => e.m),
              2,
            )} m | ${cell(errs.map((e) => e.deg))}°`,
          );
        }
      }
      expect(pool.length).toBe(160);
    }, 1_800_000);
  },
);

// ---------------------------------------------------------------------------
// The per-code verdict (question 3).
// ---------------------------------------------------------------------------

/** What the summary screen can know about a combined code: the predicted
 *  horizontal and heading sigma from the visits' own quality, as
 *  `combineCodeVisits` computes them (the position over the best prefix,
 *  the heading over every visit, with the code's yaw sigma
 *  `codeSigmaDeg`). */
function predicted(
  visits: readonly VisitEstimate[],
  codeSigmaDeg = 2,
): {
  posM: number;
  headDeg: number;
} {
  const subset = bestPrefix(visits);
  const inv = subset.reduce((sum, v) => sum + 1 / v.accuracyM, 0);
  const headW = visits.reduce(
    (sum, v) => sum + 1 / headingSigma(v, codeSigmaDeg) ** 2,
    0,
  );
  return {
    posM: Math.sqrt(subset.length) / inv,
    headDeg: deg(1 / Math.sqrt(headW)),
  };
}

const VERDICT_POS_M = [3, 4, 5, 6, 8] as const;
const VERDICT_HEAD_DEG = [3, 5, 8, 12] as const;

/** The bias arms the verdict is measured under: the results doc's four. */
const VERDICT_BIAS_ARMS: readonly BiasModel[] = [
  { coupling: "coupled", directionSpreadDeg: 360 },
  { coupling: "independent", directionSpreadDeg: 360 },
  { coupling: "coupled", directionSpreadDeg: 90 },
  { coupling: "coupled", directionSpreadDeg: 0 },
];

/** `codeVerdict`'s walk factor at a code yaw sigma: the walk (x accuracy)
 *  one visit needs for the heading model to meet the adopted limit. */
const walkFactor = (codeSigmaDeg: number): number =>
  1 /
  Math.tan(rad(Math.sqrt(VERDICT_GOOD_HEADING_DEG ** 2 - codeSigmaDeg ** 2)));

describe.runIf(runs("verdict"))(
  "M3a verdict: when is a combined code Good?",
  () => {
    // Why this test matters: the summary screen's per-code "Good" or "Scan
    // more" has no threshold yet (plan §3.3). This measures, for a grid of
    // thresholds on the PREDICTED error (what the page can compute), how
    // often "Good" is right about the ACTUAL error, under each GPS error
    // structure - so a threshold is chosen with its precision and its
    // reversal point in view, not guessed.
    it("sweeps the verdict thresholds against the actual error", () => {
      const pool = buildPool(POOL_SIZE);
      const estimates = poolEstimates(pool, {
        ...DEFAULT_LOOK,
        yawNoiseDeg: 3,
      });
      for (const target of [
        { m: 5, deg: 5 },
        { m: 3, deg: 3 },
        { m: 8, deg: 8 },
      ]) {
        for (const model of [
          { coupling: "coupled", directionSpreadDeg: 360 },
          { coupling: "coupled", directionSpreadDeg: 90 },
          { coupling: "independent", directionSpreadDeg: 360 },
        ] as const) {
          const outcomes = [1, 2, 3, 4, 5].flatMap((k) =>
            runTrials(estimates, k, model, TRIALS / 2, 500 + k),
          );
          const rows = outcomes.map((o) => ({
            p: predicted(o.visits),
            a: o.errors["subset"]!,
            k: o.visits.length,
          }));
          const meets = (r: (typeof rows)[number]): boolean =>
            r.a.m <= target.m && r.a.deg <= target.deg;
          const base = rows.filter(meets).length / rows.length;
          print(
            `\n### target <= ${target.m} m and <= ${target.deg}°, ${model.coupling}, spread ${model.directionSpreadDeg}°: Good share / precision / recall (base rate ${fmt(100 * base, 0)} %, n ${String(rows.length)} codes)`,
          );
          print(
            `pos \\ head | ${VERDICT_HEAD_DEG.map((h) => `${h}°`).join(" | ")}`,
          );
          for (const posM of VERDICT_POS_M) {
            const cells = VERDICT_HEAD_DEG.map((headDeg) => {
              const good = rows.filter(
                (r) => r.p.posM <= posM && r.p.headDeg <= headDeg,
              );
              const goodMeets = good.filter(meets).length;
              const allMeets = rows.filter(meets).length;
              return `${fmt((100 * good.length) / rows.length, 0)} / ${fmt((100 * goodMeets) / Math.max(1, good.length), 0)} / ${fmt((100 * goodMeets) / Math.max(1, allMeets), 0)}`;
            });
            print(`${posM} m | ${cells.join(" | ")}`);
          }
        }
      }
      expect(estimates.length).toBe(POOL_SIZE);
    }, 1_800_000);

    // Why this test matters (M3a/M3b review #4): the adopted verdict
    // (Good at a predicted 5 m and 12°) was measured at ONE yaw noise (3°),
    // one visit mix and one code yaw sigma (2°, `CODE_YAW_NOISE_DEG`),
    // while the heading prediction and the "walk further" distance both
    // rest on that sigma. This reports the verdict at the adopted
    // thresholds across yaw noise 1/3/5°, the two visit mixes, the sigma
    // 1/2/3/5° and the four bias arms, so a reader sees which of them
    // would reverse it.
    it("holds the adopted verdict across yaw noise, the code's yaw sigma and two visit mixes", () => {
      const tight = { m: 5, deg: 5 };
      const loose = { m: 8, deg: 8 };
      print(
        `\n### adopted verdict (Good at predicted <= ${String(VERDICT_GOOD_HORIZONTAL_M)} m and <= ${String(VERDICT_GOOD_HEADING_DEG)}°): Good share | precision within 5 m & 5° | within 8 m & 8° | recall of 5 m & 5° | actual heading of Good codes p50 / p90 | of all codes p50 / p90 (n codes per row: 1-5 visits each, ${String(TRIALS / 2)} per visit count)`,
      );
      print(
        `walk factor (x accuracy) at sigma 1/2/3/5°: ${[1, 2, 3, 5].map((s) => fmt(walkFactor(s), 2)).join(" / ")}`,
      );
      for (const [m, mix] of [MIX_DEFAULT, MIX_HURRIED].entries()) {
        const pool = buildPool(
          POOL_SIZE,
          DEFAULT_GPS,
          DEFAULT_DRIFT,
          9000 + 1000 * m,
          mix,
        );
        for (const yawNoiseDeg of [1, 3, 5]) {
          const estimates = poolEstimates(pool, {
            ...DEFAULT_LOOK,
            yawNoiseDeg,
          });
          for (const model of VERDICT_BIAS_ARMS) {
            const outcomes = [1, 2, 3, 4, 5].flatMap((k) =>
              runTrials(estimates, k, model, TRIALS / 2, 900 + k),
            );
            for (const codeSigmaDeg of [1, 2, 3, 5]) {
              const rows = outcomes.map((o) => ({
                p: predicted(o.visits, codeSigmaDeg),
                a: errorOf(subsetStrategy(o.visits, codeSigmaDeg)),
              }));
              const within = (
                r: (typeof rows)[number],
                t: { m: number; deg: number },
              ): boolean => r.a.m <= t.m && r.a.deg <= t.deg;
              const good = rows.filter(
                (r) =>
                  r.p.posM <= VERDICT_GOOD_HORIZONTAL_M &&
                  r.p.headDeg <= VERDICT_GOOD_HEADING_DEG,
              );
              const pct = (a: number, b: number): string =>
                `${fmt((100 * a) / Math.max(1, b), 0)} %`;
              const goodTight = good.filter((r) => within(r, tight)).length;
              print(
                `${mix.name}, yaw ${String(yawNoiseDeg)}°, ${model.coupling} ${String(model.directionSpreadDeg)}°, sigma ${String(codeSigmaDeg)}° | ${pct(good.length, rows.length)} | ${pct(goodTight, good.length)} | ${pct(good.filter((r) => within(r, loose)).length, good.length)} | ${pct(goodTight, rows.filter((r) => within(r, tight)).length)} | ${cell(good.map((r) => r.a.deg))}° | ${cell(rows.map((r) => r.a.deg))}° (n ${String(rows.length)})`,
              );
            }
          }
        }
        expect(pool).toHaveLength(POOL_SIZE);
      }
    }, 1_800_000);
  },
);
