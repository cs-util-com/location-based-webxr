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
 * Measured result (2026-10-01, synthetic only; pool of 320 visits, 2,000
 * trials per cell):
 * - Combining: with five visits whose biases point in independent
 *   directions, the first visit alone errs 9.2 m p50, the mean 4.0 m,
 *   1/accuracy² 2.9 m and 1/accuracy 3.1 m when the bias follows the
 *   reported accuracy; 9.6 / 3.8 / 4.7 / 4.0 m when it does not. The
 *   heading weighted by `atan(accuracy / baseline)` wins in every arm
 *   (2.2° p50, 5.4° p90 against 5.0° / 19° for the first visit). With
 *   correlated bias directions (90°, 0°) averaging buys little.
 *   `combineCodeVisits` ships the robust middle (1/accuracy, heading model).
 * - The heading model is a conservative bound: measured/model 0.1-0.4 at
 *   p50, 0.3-0.8 at p90 (white-noise-only GPS up to 1.6). Per metre WALKED
 *   a line (out and back) beats a loop, because it reaches further; per
 *   metre of extent a long loop is slightly better (ratio 0.17-0.18 vs
 *   0.26-0.28 at 60-120 m). The extent is the lever, not the directions.
 * - The Recorder's per-visit mint (each sighting through the alignment of
 *   its moment) gets the heading badly wrong when a visit starts at the
 *   code (89° p50): the first look's alignment has no walk behind it, and
 *   the mint's rotation average is unweighted, so no half-life helps. The
 *   end-of-visit alignment (the Tour Viewer's settle) gives 5.0° p50.
 * - The 15° spread gate refuses 0 % of honest visits at 1-3° yaw noise
 *   (5 % at 5°) and catches a 20° re-hang 75-100 %; the 4 s gap and the
 *   60 s half-life change nothing in the Tour Viewer's flow.
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
 * the alignment as it stood then (DEC-3), the accumulator folds them into
 * sightings by the gap, and the mint gates the rotation spread and weights
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
  const result = mintQrAnchorFromSightings({
    sightings,
    spansFrameChange: false,
    nowIso: new Date(EPOCH_MS).toISOString(),
    maxFixedRotationSpreadDeg: p.maxSpreadDeg,
    recencyHalfLifeS: p.halfLifeS,
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

/** A pool of independent visits: accuracy uniform in [3, 15] m, the walk
 *  lengths and shapes cycled so every cell is equally filled. */
function buildPool(
  size: number,
  gps: GpsModel = DEFAULT_GPS,
  drift: DriftModel = DEFAULT_DRIFT,
  seedBase = 1000,
): VisitRun[] {
  const pool: VisitRun[] = [];
  for (let i = 0; i < size; i += 1) {
    const rng = stream(seedBase + i, 9);
    pool.push(
      runVisit({
        seed: seedBase + i,
        accuracyM: 3 + 12 * rng(),
        walkM: WALKS_M[i % WALKS_M.length]!,
        shape: Math.floor(i / WALKS_M.length) % 2 === 0 ? "loop" : "line",
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

describe("M3a: the production combiner is the spike's hybrid strategy", () => {
  // Why this test matters: the spike's tables measure the test-local
  // `hybrid` strategy; `combineCodeVisits` is what M3b would ship. This
  // pins that the two are the same computation, on real fixture visits
  // with biases added, so the tables stay evidence for the shipped code.
  it("agrees with the hybrid strategy on biased fixture visits", () => {
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
    const spike = STRATEGIES["hybrid"]!(visits);
    const combined = combineCodeVisits(visits.map(asCodeVisit))!;
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
      for (const arm of MODEL_ARMS) {
        const pool = buildPool(96, arm.gps, arm.drift, 5000);
        const estimates = poolEstimates(pool, QUIET_LOOK);
        print(
          `\n### ${arm.name}: heading err p50 / p90 | ratio to model p50 / p90 | position err (no bias) p50 / p90 | share over model`,
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
              `${walk} m ${shape} (baseline ${fmt(rows[0]!.baselineM)} m) | ${cell(errs.map((e) => e.deg))}° | ${cell(ratios, 2)} | ${cell(errs.map((e) => e.m))} m | ${fmt(100 * over, 0)} %`,
            );
          }
        }
      }
      // The pin: with the default GPS model the model is an upper bound
      // for most visits (the measured error sits below it at the median).
      const pool = buildPool(96, DEFAULT_GPS, NO_DRIFT, 5000);
      const ratios = poolEstimates(pool, QUIET_LOOK).map(
        (v) => errorOf(v).deg / modelHeadingDeg(v),
      );
      expect(quantile(ratios, 0.5)).toBeLessThan(1);
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
    // recency, each composed through the alignment of ITS moment (DEC-3).
    // The Tour Viewer composes through the visit's END alignment instead.
    // This measures both, so the choice is evidence, not habit.
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
 *  horizontal and heading sigma from the visits' own quality. */
function predicted(visits: readonly VisitEstimate[]): {
  posM: number;
  headDeg: number;
} {
  // The hybrid weights 1/accuracy: if each visit errs by ~its accuracy,
  // the combined sigma is sqrt(k) / sum(1/accuracy).
  const inv = visits.reduce((sum, v) => sum + 1 / v.accuracyM, 0);
  const headW = visits.reduce((sum, v) => sum + 1 / headingSigma(v) ** 2, 0);
  return {
    posM: Math.sqrt(visits.length) / inv,
    headDeg: deg(1 / Math.sqrt(headW)),
  };
}

const VERDICT_POS_M = [3, 4, 5, 6, 8] as const;
const VERDICT_HEAD_DEG = [3, 5, 8, 12] as const;

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
            a: o.errors["hybrid"]!,
            k: o.visits.length,
          }));
          const meets = (r: (typeof rows)[number]): boolean =>
            r.a.m <= target.m && r.a.deg <= target.deg;
          const base = rows.filter(meets).length / rows.length;
          print(
            `\n### target <= ${target.m} m and <= ${target.deg}°, ${model.coupling}, spread ${model.directionSpreadDeg}°: Good share / precision / recall (base rate ${fmt(100 * base, 0)} %)`,
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
  },
);
