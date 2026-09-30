/**
 * M0 of the Tour Viewer authoring plan (2026-09-28-0953, §3.2 "stronger code
 * votes, measured first", decision D3): how strongly does a stable QR scan's
 * synthetic-GPS vote batch pull the GPS-to-AR alignment, and for how long?
 *
 * Why this file matters: D3 says the votes are strengthened ONLY if the
 * current system is shown to be too weak. This is that showing. It drives
 * the REAL viewer store (`createTourViewerStore`) and the REAL reducers and
 * solver of the published `gps-plus-slam-js` - nothing about the solve is
 * mocked - and the votes go through the viewer's own dispatch path
 * (`buildViewerControllerConfig(...).dispatchVotes`, i.e. its per-code
 * budget and zero gate) built by `buildQrGpsVotes` exactly as the tracking
 * controller calls it.
 *
 * Scenario (deterministic, no randomness):
 * - Odometry is EXACT: the true GPS-to-AR alignment is a 40° yaw plus a
 *   translation, and every AR position is the true world position mapped
 *   back through it.
 * - GPS is the truth plus a CONSTANT horizontal bias of B metres (bearing
 *   60°), 1 Hz, 3 m reported accuracy, true altitude. A constant bias leaves
 *   the GPS-only alignment's rotation exact and shifts its translation by B,
 *   so the pre-scan error at the code is B and the heading error ~0.
 * - ~48 s walk on an L-shaped path (~58 m) to a spot 2 m in front of a
 *   vertical printed code; the visitor stands there while the code is locked
 *   at ~8 Hz (one vote batch per locked frame until the budget is spent);
 *   then walks a 3 m-radius loop in front of the code at 0.5 m/s while
 *   biased GPS continues for 300 s.
 * - Measured after every dispatch: the alignment's horizontal position error
 *   AT THE CODE (where `alignment · odom(code)` lands vs the code's true
 *   position relative to the session zero) and its heading error (the
 *   code's face normal mapped through the alignment's rotation vs the truth).
 *
 * Decision rule (plan §3.2): today's votes are strong enough if the scan
 * brings the alignment at the code within 0.3 m and 2°, AND keeps it within
 * 0.5 m for 120 s of continued biased GPS.
 *
 * What is NOT modelled, deliberately: GPS noise around the bias (a constant
 * bias is the easiest case for the solver to be consistently wrong in, and
 * keeps the run exact), odometry drift, a vote pose error (the votes sit at
 * the TRUE code pose, i.e. a perfectly minted level), the fused-pose
 * convergence gate (the stable pose is simply given), and the vertical
 * error (reported, not judged: the rule is about the horizontal placement).
 * Not swept either: the pre-scan walk length (a longer walk gives the GPS
 * more history, so it can only make the votes weaker), the bias bearing, and
 * the GPS accuracy (3 m -> weight 0.90 vs a vote's 0.85 at 5 m: the
 * accuracy weight is too flat to matter, which the `acc 1` arm confirms).
 *
 * Measured result (2026-09-28): today's votes FAIL the rule at every bias.
 * The scan puts the code's POSITION right (0.06-0.39 m) but tilts the
 * HEADING (5.9° / 18.1° / 30.8° at B = 3 / 8 / 15 m): the votes pin one
 * point while the biased walk pulls the rest, and the compromise is a
 * rotation about the code. The GPS then takes the alignment back: at
 * B >= 8 m, i.e. above the 5 m outlier threshold, the votes are rejected
 * outright within ~30 s (error exactly B, heading exactly 0); at B = 3 m
 * they fade (2.4 m at +60 s). No single swept knob meets the rule; the
 * hypothetical keep-alive re-vote (`revoteBatchesPerFix`) is the only arm
 * that HOLDS the position, and it does not fix the post-scan heading.
 *
 * M0b (owner decision D8, 2026-09-28; opt-in sweeps `m0b-core`, `m0b-fine`,
 * `m0b-attr` at the bottom): wide rings, the count, a minted heading error
 * and a linearly fading keep-alive re-vote. Radius matters strongly (heading
 * right after the scan at N = 4, B = 8: 18.1° at 2 m, 3.4° at 10 m, 0.45° at
 * 30 m, 0.04° at 100 m); layout (circle vs a horizontal line) barely does.
 * At N >= 8 and r >= 5 m the scan is exact because the 5 m hard outlier trim
 * throws the biased GPS out, so above B = 5 m the solve is BISTABLE: a
 * keep-alive fading over 240 s meets the rule, but the hand-off to GPS is a
 * jump of ~2.5-6 m in one fix. Below the threshold (B = 3 m) the hand-off is
 * smooth but the votes only blend (hold 0.51-0.58 m, just over the rule).
 * `m0b-attr` confirms the trim as the jump's cause: a threshold above B makes
 * the same fade smooth (<= 0.37 m per fix) and too weak (0.73 m at the scan).
 * A minted heading error passes straight through (the alignment takes the
 * mint's 1°/3°) at every radius >= 5 m; the radius does not amplify it.
 *
 * M2b (2026-09-30): the viewer now SHIPS the 30 m ring of 8 votes and a
 * keep-alive (hold 120 s, fade 120 s). `TODAY` is those constants; M0's pins
 * and sweeps run on the explicit `M0_VIEWER` (2 m, 4 votes) so they stay
 * the evidence they were; the `shippedKeepAlive` arm drives the viewer's own
 * keep-alive module. Under today's hard trim it meets the rule at B = 3, 8
 * and 15 m and fails at 5 m, and above the trim the hand-off is still one
 * jump (2.97 m at B = 8) or none (B = 15): see the M2b block at the bottom
 * (`VOTE_STRENGTH_SWEEP=m2b`).
 */

import { describe, expect, it } from "vitest";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  webxrToNUE,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import {
  createSlamAppStore,
  qrDetectedReducer,
  recordGpsEvent,
  selectAlignmentMatrix,
  setAlignmentOverrides,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import {
  buildQrGpsVotes,
  localPlaneOffset,
  offsetGeo,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { transformPoint } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { createQrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  buildViewerControllerConfig,
  createViewerKeepAlive,
  VIEWER_KEEP_ALIVE_FADE_MS,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// ---------------------------------------------------------------------------
// Scenario geometry. World frame: NUE metres relative to ORIGIN, Up = absolute
// altitude (the stack's GPS-world convention).
// ---------------------------------------------------------------------------

// The library gates its geodesy helpers on a licence the framework store
// activates; the module-level constants below call them, so build one first.
createTourViewerStore();

/**
 * `createTourViewerStore`'s exact configuration minus RTK's dev-only
 * serializable/immutable checks. Those walk the whole state on every
 * dispatch (~150 ms each once the history holds a few hundred fixes, which
 * made one scenario take minutes) and are stripped from the production
 * build, so they are not what a visitor's phone runs. A test below pins that
 * this store and the viewer's own produce the identical alignment.
 */
function createMeasuredStore() {
  return createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    extraReducers: { qrDetected: qrDetectedReducer },
    enableDevChecks: false,
  });
}

const ORIGIN = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
/** The true AR-to-world alignment: world = Ry(yaw) · odomNue + T. */
const TRUE_YAW_DEG = 40;
const TRUE_T: Vector3 = [5, 400, -8];
/** The printed code: centre 1.5 m above ground at 400 m, vertical poster. */
const CODE_WORLD: Vector3 = [0, 401.5, 0];
/** Local +x points east, so the printed face looks south (normal 180°). */
const CODE_HEADING_DEG = 90;
const CODE_NORMAL_BEARING_DEG = CODE_HEADING_DEG + 90;
const CODE_SIZE_M = 0.2;
const CODE_TEXT = "https://gps.csutil.com/tour/?qr=vote-strength";
const PHONE_ALT = 401.4;
const GPS_ACCURACY_M = 3;
const BIAS_BEARING_DEG = 60;
const GPS_INTERVAL_MS = 1000;
/** ~8 Hz: the camera-frame cadence the viewer's detection runs at. */
const LOCK_INTERVAL_MS = 125;
const WALK_SPEED_MPS = 1.2;
/** Pre-scan walk (N, E): east along one street, then north to the code. */
const WALK: readonly (readonly [number, number])[] = [
  [-30, -25],
  [-30, 5],
  [-2, 0], // the standing spot, 2 m in front of the printed face
];
const LOOP_CENTRE: readonly [number, number] = [-5, 0];
const LOOP_RADIUS_M = 3;
const LOOP_SPEED_MPS = 0.5;
const POST_SCAN_S = 300;
const IDENTITY_Q: Quaternion = [0, 0, 0, 1];

const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Rotation about Up (NUE y) by `a` radians - the only rotation in play. */
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

function odomNueFromWorld(w: Vector3): Vector3 {
  return rotY(-rad(TRUE_YAW_DEG), [
    w[0] - TRUE_T[0],
    w[1] - TRUE_T[1],
    w[2] - TRUE_T[2],
  ]);
}
const worldToLatLon = (w: Vector3): { lat: number; lon: number } =>
  calcGpsCoords(ORIGIN, w);

const CODE_GEO: QrGeoPose = {
  ...(() => {
    const ll = worldToLatLon(CODE_WORLD);
    return { lat: ll.lat, lon: ll.lon };
  })(),
  alt: CODE_WORLD[1],
  headingDeg: CODE_HEADING_DEG,
};
/**
 * The code's pose in raw-WebXR odometry, as the stable fused pose would give
 * it. A vertical poster at heading h maps its local axes into NUE by
 * `Ry(-h)`, so into odometry-NUE by `Ry(-h - yaw)`. The pose's rotation maps
 * the SAME local axes into raw WebXR, i.e. it is that rotation COMPOSED with
 * the NUE-to-WebXR basis change (`Ry(+90°)`: [n,u,e] -> [e,u,-n]) - not
 * conjugated by it, which is what `webxrQuaternionToNUE` does for device
 * rotations (`qr-geo-pose-minting.ts`: world rotation = WEBXR_TO_NUE node
 * times the WebXR pose). Getting this wrong puts the vote ring 90° off the
 * GPS track; the sanity test below catches exactly that.
 */
const CODE_POSE_ODOM = {
  position: nueToWebxr(odomNueFromWorld(CODE_WORLD)),
  rotation: yawQuat(Math.PI / 2 - rad(CODE_HEADING_DEG) - rad(TRUE_YAW_DEG)),
};

/** The code's level as minted with a heading error of `errDeg`. */
const mintedGeo = (errDeg: number): QrGeoPose => ({
  ...CODE_GEO,
  headingDeg: CODE_HEADING_DEG + errDeg,
});

/**
 * M0b's horizontal-only layout: `count` (even) points along the code's local
 * +X at the code's own height, in ± pairs evenly spaced out to `baselineM`
 * (count 4 → ±r/2, ±r). The payload is built exactly as `buildQrGpsVotes`
 * builds its ring (odometry through the solved pose, geo through the level's
 * heading, the same id/accuracy/timestamp/rotation stamping) - only the local
 * points differ. Test-local on purpose: production is not changed by M0b.
 */
function buildLineVotes(input: {
  qrGeo: QrGeoPose;
  syntheticAccuracyM: number;
  baselineM: number;
  count: number;
  timestamp: number;
}): RecordGpsEventPayload[] {
  const { qrGeo, syntheticAccuracyM, baselineM, count, timestamp } = input;
  if (count < 2 || count % 2 !== 0) {
    throw new RangeError(`line layout needs an even count >= 2, got ${count}`);
  }
  const half = count / 2;
  const locals: Vector3[] = [];
  for (let j = 1; j <= half; j += 1) {
    const x = (baselineM * j) / half;
    locals.push([x, 0, 0], [-x, 0, 0]);
  }
  return locals.map((local, i) => {
    const geo = offsetGeo(qrGeo, localPlaneOffset(local, qrGeo));
    return {
      odomPosition: transformPoint(local, CODE_POSE_ODOM),
      odomRotation: CODE_POSE_ODOM.rotation,
      rawGpsPoint: {
        id: `qr-${String(timestamp)}-${String(i)}`,
        latitude: geo.latitude,
        longitude: geo.longitude,
        altitude: geo.altitude,
        latLongAccuracy: syntheticAccuracyM,
        timestamp,
      },
    };
  });
}

/** The point 20 m in front of the printed face (face normal 180°: south). */
const P20_WORLD: Vector3 = [
  CODE_WORLD[0] + 20 * Math.cos(rad(CODE_NORMAL_BEARING_DEG)),
  CODE_WORLD[1],
  CODE_WORLD[2] + 20 * Math.sin(rad(CODE_NORMAL_BEARING_DEG)),
];

// ---------------------------------------------------------------------------
// The visitor's timeline.
// ---------------------------------------------------------------------------

function polylinePoint(distance: number): readonly [number, number] {
  let left = distance;
  for (let i = 1; i < WALK.length; i += 1) {
    const a = WALK[i - 1]!;
    const b = WALK[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len) {
      const f = left / len;
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    left -= len;
  }
  return WALK[WALK.length - 1]!;
}
const WALK_LENGTH_M = WALK.slice(1).reduce(
  (sum, b, i) => sum + Math.hypot(b[0] - WALK[i]![0], b[1] - WALK[i]![1]),
  0,
);
const ARRIVE_MS = Math.ceil(WALK_LENGTH_M / WALK_SPEED_MPS) * 1000;
/** The first lock, half a fix after the visitor arrives. */
const SCAN_START_MS = ARRIVE_MS + 500;

// ---------------------------------------------------------------------------
// The measured run.
// ---------------------------------------------------------------------------

interface VoteParams {
  /** Constant horizontal GPS bias, metres. */
  biasM: number;
  /** Voted locks per code (MAX_VOTED_LOCKS_PER_CODE today). */
  budget: number;
  /** Synthetic accuracy stamped on each vote (VIEWER_SYNTHETIC_ACCURACY_M). */
  voteAccuracyM: number;
  /** Correspondences per lock (VIEWER_VOTE_COUNT). */
  voteCount: number;
  /** Solver `weightByTimeFactor` (250 shipped); via `setAlignmentOverrides`. */
  timeFactor: number;
  /** Solver outlier threshold (5 m shipped); via `setAlignmentOverrides`. */
  outlierThresholdM: number;
  /**
   * `viewer`: the votes go through `buildViewerControllerConfig`'s own
   * `dispatchVotes` (its budget is today's constant, so `budget` must equal
   * it). `replica`: the same three steps (zero gate, `createQrVoteBudget`,
   * dispatch) with a budget of our choosing - pinned equal to `viewer` below.
   */
  path: "viewer" | "replica";
  /** Store factory; `measured` (default) drops only the dev checks. */
  store?: "viewer" | "measured";
  /**
   * HYPOTHETICAL (not today's viewer): vote batches re-cast from the
   * remembered stable pose on every GPS fix after the scan, stamped with the
   * fix time - a keep-alive that keeps the votes as recent as the GPS.
   */
  revoteBatchesPerFix?: number;
  /** Seconds of biased GPS after the scan (default 300). */
  postScanS?: number;
  /** M0b: ring radius (m); default `VIEWER_VOTE_BASELINE_M`. */
  baselineM?: number;
  /**
   * M0b: where the synthetic points sit. `circle` = today's regular polygon
   * in the code plane (`buildQrGpsVotes`, half the points above/below the
   * code); `line` = the test-local {@link buildLineVotes}: pairs along the
   * code's local +X at the code's height, evenly spaced out to ±radius.
   */
  layout?: "circle" | "line";
  /**
   * M0b: the minted level's heading error (°): the votes' GEO points are
   * built from `CODE_HEADING_DEG + codeHeadingErrDeg` while the odometry
   * pose stays true, so each ring point is displaced by ~r·err.
   */
  codeHeadingErrDeg?: number;
  /**
   * M0b HYPOTHETICAL keep-alive: after the scan, every GPS fix is followed by
   * re-cast votes (same layout, stamped with the fix time) whose vote count
   * falls linearly from `voteCount` at the scan to zero at `fadeS` seconds.
   * Counts are carried in a credit accumulator so the mean rate is exactly
   * linear while each emitted batch stays a symmetric layout (circle ≥ 3
   * points, line an even count ≥ 2).
   */
  keepAliveFadeS?: number;
  /**
   * M2b, SHIPPED: the viewer's own keep-alive (`createViewerKeepAlive`:
   * hold 120 s after the code's last lock, fade 120 s), handed to the
   * viewer config and fed each lock in the controller's order, its votes
   * cast after every GPS fix as `viewer-placement` casts them. Viewer path
   * only; replaces the test-local `keepAliveFadeS` schedule.
   */
  shippedKeepAlive?: boolean;
}

interface Measured {
  preScanM: number;
  preScanDeg: number;
  /** Right after the last VOTED lock. */
  scanEndM: number;
  scanEndDeg: number;
  scanSeconds: number;
  at60M: number;
  at120M: number;
  at300M: number;
  /** Worst horizontal / heading error over the 120 s after the scan. */
  max120M: number;
  max120Deg: number;
  at300Deg: number;
  scanEndVerticalM: number;
  votesDispatched: number;
  /** Error after every post-scan fix; `s` = seconds since the last vote. */
  trace: { s: number; m: number; deg: number }[];
  /** Horizontal error of the point 20 m in front of the code's face. */
  scanEndP20M: number;
  max120P20M: number;
  /**
   * Largest change between consecutive post-scan fixes of the code's mapped
   * horizontal position (m) and its mapped face heading (°): the visible
   * jump. `AfterFade` restricts it to fixes after the keep-alive fade ended
   * (the whole post-scan window when there is no keep-alive).
   */
  maxStepM: number;
  maxStepDeg: number;
  maxStepAfterFadeM: number;
  maxStepAfterFadeDeg: number;
  /** Error at the end of the run (the GPS answer is B m, 0°). */
  endM: number;
  endDeg: number;
}

/** The viewer's shipped vote constants, through its own dispatch path. */
const TODAY: VoteParams = {
  biasM: 8,
  budget: MAX_VOTED_LOCKS_PER_CODE,
  voteAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
  voteCount: VIEWER_VOTE_COUNT,
  timeFactor: 250,
  outlierThresholdM: 5,
  path: "viewer",
};

/**
 * The viewer as M0 measured it, before M2b: a 2 m ring of 4 votes per lock
 * and no keep-alive. Kept explicit so M0's pins and sweeps stay the
 * evidence they were (D3), whatever the shipped constants become.
 */
const M0_VIEWER: VoteParams = { ...TODAY, baselineM: 2, voteCount: 4 };

/** The decision rule of plan §3.2. */
function meetsRule(m: Measured): boolean {
  return m.scanEndM <= 0.3 && m.scanEndDeg <= 2 && m.max120M <= 0.5;
}

function runScenario(p: VoteParams): Measured {
  const store =
    p.store === "viewer" ? createTourViewerStore() : createMeasuredStore();
  const bias: Vector3 = [
    p.biasM * Math.cos(rad(BIAS_BEARING_DEG)),
    0,
    p.biasM * Math.sin(rad(BIAS_BEARING_DEG)),
  ];

  let zero: { lat: number; lon: number } | null = null;
  let votesDispatched = 0;
  const dispatchVote = (payload: RecordGpsEventPayload): void => {
    votesDispatched += 1;
    store.dispatch(recordGpsEvent(payload));
  };
  const canAcceptVotes = (): boolean => store.getState().gpsData?.zero != null;
  const keepAlive =
    p.shippedKeepAlive === true ? createViewerKeepAlive() : undefined;
  if (keepAlive !== undefined && p.path !== "viewer") {
    throw new Error("the shipped keep-alive runs on the viewer path");
  }

  // The viewer's own dispatch path (budget + zero gate), stubs elsewhere.
  const viewerConfig = buildViewerControllerConfig({
    frontEnd: { kind: "barcode-detector", detect: () => Promise.resolve(null) },
    solvePose: () => null,
    getIntrinsics: () => null,
    getLevels: () => null,
    dispatchVote,
    canAcceptVotes,
    // The votes sit at the TRUE code pose (a perfectly measured code).
    resolveStablePose: () => CODE_POSE_ODOM,
    recordDetection: () => undefined,
    onError: () => undefined,
    ...(keepAlive !== undefined ? { keepAlive } : {}),
  });
  const replicaBudget = createQrVoteBudget(p.budget);
  if (p.path === "viewer" && p.budget !== MAX_VOTED_LOCKS_PER_CODE) {
    throw new Error("the viewer path's budget is today's constant");
  }
  /** One lock's vote batch, as `qr-tracking-controller` builds it (its
   *  `timestamp` defaults to `Date.now()`, the clock GPS fixes carry). */
  const qrGeo = mintedGeo(p.codeHeadingErrDeg ?? 0);
  const baselineM = p.baselineM ?? VIEWER_VOTE_BASELINE_M;
  const level: QrLevel = {
    version: 1,
    qr: { physicalSizeM: CODE_SIZE_M, geo: qrGeo },
  };
  const buildVotes = (
    t: number,
    count: number = p.voteCount,
  ): RecordGpsEventPayload[] =>
    p.layout === "line"
      ? buildLineVotes({
          qrGeo,
          syntheticAccuracyM: p.voteAccuracyM,
          baselineM,
          count,
          timestamp: EPOCH_MS + t,
        })
      : buildQrGpsVotes({
          qrPoseWorld: CODE_POSE_ODOM,
          sizeM: CODE_SIZE_M,
          qrGeo,
          syntheticAccuracyM: p.voteAccuracyM,
          baselineM,
          count,
          timestamp: EPOCH_MS + t,
        });
  /** One locked frame; returns whether it voted. */
  const lock = (t: number): boolean => {
    const votes = buildVotes(t);
    const before = votesDispatched;
    if (p.path === "viewer") {
      // The controller's order: detection, stable pose, votes, lock.
      viewerConfig.onDetection?.({
        text: CODE_TEXT,
        timestamp: EPOCH_MS + t,
      } as QrDetectionEvent);
      viewerConfig.resolveStablePose?.(CODE_TEXT);
      viewerConfig.dispatchVotes(votes);
      viewerConfig.onLocked?.({} as never, level);
    } else if (canAcceptVotes() && replicaBudget.tryConsume(CODE_TEXT)) {
      for (const v of votes) dispatchVote(v);
    }
    return votesDispatched > before;
  };

  const gps = (t: number, ne: readonly [number, number]): void => {
    const truth: Vector3 = [ne[0], PHONE_ALT, ne[1]];
    const measured: Vector3 = [
      truth[0] + bias[0],
      truth[1],
      truth[2] + bias[2],
    ];
    const ll = worldToLatLon(measured);
    if (zero === null) {
      zero = ll;
      store.dispatch(setZeroPos(ll));
      const overrides: {
        timeWeightFactor?: number;
        outlierThresholdMeters?: number;
      } = {};
      if (p.timeFactor !== 250) overrides.timeWeightFactor = p.timeFactor;
      if (p.outlierThresholdM !== 5)
        overrides.outlierThresholdMeters = p.outlierThresholdM;
      if (Object.keys(overrides).length > 0) {
        store.dispatch(setAlignmentOverrides(overrides));
      }
    }
    store.dispatch(
      recordGpsEvent({
        odomPosition: nueToWebxr(odomNueFromWorld(truth)),
        odomRotation: IDENTITY_Q,
        rawGpsPoint: {
          id: `gps-${String(t)}`,
          latitude: ll.lat,
          longitude: ll.lon,
          altitude: measured[1],
          latLongAccuracy: GPS_ACCURACY_M,
          timestamp: EPOCH_MS + t,
        },
      }),
    );
    // The shipped keep-alive answers every device fix (viewer-placement).
    for (const v of keepAlive?.votesForFix(EPOCH_MS + t) ?? []) {
      dispatchVote(v);
    }
  };

  const errorAtCode = (): {
    m: number;
    deg: number;
    vertical: number;
    /** The code's mapped horizontal position (N, E) and signed heading error. */
    n: number;
    e: number;
    signedDeg: number;
    p20M: number;
  } => {
    const a = selectAlignmentMatrix(store.getState());
    if (a === null || zero === null) {
      return {
        m: NaN,
        deg: NaN,
        vertical: NaN,
        n: NaN,
        e: NaN,
        signedDeg: NaN,
        p20M: NaN,
      };
    }
    const map = (o: Vector3): Vector3 => [
      a[0] * o[0] + a[4] * o[1] + a[8] * o[2] + a[12],
      a[1] * o[0] + a[5] * o[1] + a[9] * o[2] + a[13],
      a[2] * o[0] + a[6] * o[1] + a[10] * o[2] + a[14],
    ];
    const mapped = map(webxrToNUE(CODE_POSE_ODOM.position));
    const p20Mapped = map(odomNueFromWorld(P20_WORLD));
    const p20Truth = calcRelativeCoordsInMeters(
      zero,
      worldToLatLon(P20_WORLD),
      P20_WORLD[1],
    );
    const truth = calcRelativeCoordsInMeters(zero, CODE_GEO, CODE_GEO.alt);
    const n = rotY(-rad(CODE_HEADING_DEG) - rad(TRUE_YAW_DEG), [0, 0, 1]);
    const nMapped: Vector3 = [
      a[0] * n[0] + a[4] * n[1] + a[8] * n[2],
      a[1] * n[0] + a[5] * n[1] + a[9] * n[2],
      a[2] * n[0] + a[6] * n[1] + a[10] * n[2],
    ];
    const bearing = deg(Math.atan2(nMapped[2], nMapped[0]));
    const dBearing =
      ((((bearing - CODE_NORMAL_BEARING_DEG) % 360) + 540) % 360) - 180;
    return {
      m: Math.hypot(mapped[0] - truth[0], mapped[2] - truth[2]),
      deg: Math.abs(dBearing),
      vertical: mapped[1] - truth[1],
      n: mapped[0],
      e: mapped[2],
      signedDeg: dBearing,
      p20M: Math.hypot(p20Mapped[0] - p20Truth[0], p20Mapped[2] - p20Truth[2]),
    };
  };

  // 1. The walk to the code, 1 Hz.
  let t = 0;
  for (; t <= ARRIVE_MS; t += GPS_INTERVAL_MS) {
    gps(t, polylinePoint((t / 1000) * WALK_SPEED_MPS));
  }
  const pre = errorAtCode();

  // 2. The scan: the visitor stands still, a lock every 125 ms, GPS goes on.
  // `budget + 5` locks are attempted so the spent budget is exercised.
  const locks = p.budget + 5;
  let nextGps = t;
  let lastVoteT = SCAN_START_MS;
  for (let i = 0; i < locks; i += 1) {
    const tl = SCAN_START_MS + i * LOCK_INTERVAL_MS;
    while (nextGps <= tl) {
      gps(nextGps, WALK[WALK.length - 1]!);
      nextGps += GPS_INTERVAL_MS;
    }
    if (lock(tl)) lastVoteT = tl;
  }
  const scanEnd = errorAtCode();
  // Measured from the last VOTED lock; the few non-voting locks after it
  // only hold the visitor still for another ~0.6 s.

  // 3. Biased GPS continues on a loop in front of the code.
  const loopStart = SCAN_START_MS + locks * LOCK_INTERVAL_MS;
  let at60M = NaN;
  let at120M = NaN;
  let at300M = NaN;
  let at300Deg = NaN;
  let max120M = scanEnd.m;
  let max120Deg = scanEnd.deg;
  let max120P20M = scanEnd.p20M;
  let maxStepM = 0;
  let maxStepDeg = 0;
  let maxStepAfterFadeM = 0;
  let maxStepAfterFadeDeg = 0;
  let prev = scanEnd;
  const fadeS =
    keepAlive !== undefined
      ? (VIEWER_KEEP_ALIVE_HOLD_MS + VIEWER_KEEP_ALIVE_FADE_MS) / 1000
      : (p.keepAliveFadeS ?? 0);
  let keepAliveCredit = 0;
  const minKeepAlive = p.layout === "line" ? 2 : 3;
  const trace: { s: number; m: number; deg: number }[] = [
    { s: 0, m: scanEnd.m, deg: scanEnd.deg },
  ];
  for (
    ;
    nextGps <= lastVoteT + (p.postScanS ?? POST_SCAN_S) * 1000;
    nextGps += GPS_INTERVAL_MS
  ) {
    const s = Math.max(0, (nextGps - loopStart) / 1000);
    const angle = (s * LOOP_SPEED_MPS) / LOOP_RADIUS_M;
    const pos: [number, number] =
      nextGps < loopStart
        ? [WALK[WALK.length - 1]![0], WALK[WALK.length - 1]![1]]
        : [
            LOOP_CENTRE[0] + LOOP_RADIUS_M * Math.cos(angle),
            LOOP_CENTRE[1] + LOOP_RADIUS_M * Math.sin(angle),
          ];
    gps(nextGps, pos);
    for (let k = 0; k < (p.revoteBatchesPerFix ?? 0); k += 1) {
      for (const v of buildVotes(nextGps)) dispatchVote(v);
    }
    const dt = (nextGps - lastVoteT) / 1000;
    if (keepAlive === undefined && fadeS > 0 && dt < fadeS) {
      keepAliveCredit += p.voteCount * (1 - dt / fadeS);
      let k = Math.floor(keepAliveCredit);
      if (p.layout === "line") k -= k % 2;
      if (k >= minKeepAlive) {
        for (const v of buildVotes(nextGps, k)) dispatchVote(v);
        keepAliveCredit -= k;
      }
    }
    const e = errorAtCode();
    const stepM = Math.hypot(e.n - prev.n, e.e - prev.e);
    const stepDeg = Math.abs(
      ((((e.signedDeg - prev.signedDeg) % 360) + 540) % 360) - 180,
    );
    maxStepM = Math.max(maxStepM, stepM);
    maxStepDeg = Math.max(maxStepDeg, stepDeg);
    if (dt > fadeS) {
      maxStepAfterFadeM = Math.max(maxStepAfterFadeM, stepM);
      maxStepAfterFadeDeg = Math.max(maxStepAfterFadeDeg, stepDeg);
    }
    prev = e;
    if (dt <= 120) {
      max120M = Math.max(max120M, e.m);
      max120Deg = Math.max(max120Deg, e.deg);
      max120P20M = Math.max(max120P20M, e.p20M);
    }
    if (dt <= 60) at60M = e.m;
    if (dt <= 120) at120M = e.m;
    if (dt >= POST_SCAN_S - 1) at300M = e.m;
    if (dt >= POST_SCAN_S - 1) at300Deg = e.deg;
    trace.push({ s: dt, m: e.m, deg: e.deg });
  }

  return {
    preScanM: pre.m,
    preScanDeg: pre.deg,
    scanEndM: scanEnd.m,
    scanEndDeg: scanEnd.deg,
    scanSeconds: (lastVoteT - SCAN_START_MS) / 1000,
    at60M,
    at120M,
    at300M,
    max120M,
    max120Deg,
    at300Deg,
    scanEndVerticalM: scanEnd.vertical,
    votesDispatched,
    trace,
    scanEndP20M: scanEnd.p20M,
    max120P20M,
    maxStepM,
    maxStepDeg,
    maxStepAfterFadeM,
    maxStepAfterFadeDeg,
    endM: prev.m,
    endDeg: prev.deg,
  };
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

function row(
  label: string,
  p: VoteParams,
  m: Measured,
): Record<string, unknown> {
  return {
    arm: label,
    B: p.biasM,
    budget: p.budget,
    acc: p.voteAccuracyM,
    count: p.voteCount,
    f: p.timeFactor,
    thr: p.outlierThresholdM,
    votes: m.votesDispatched,
    "pre m": r2(m.preScanM),
    "scan m": r2(m.scanEndM),
    "scan °": r2(m.scanEndDeg),
    "+60 m": r2(m.at60M),
    "+120 m": r2(m.at120M),
    "max120 m": r2(m.max120M),
    "max120 °": r2(m.max120Deg),
    "+300 m": r2(m.at300M),
    rule: meetsRule(m) ? "MEETS" : "fails",
  };
}

/** Plain-text table on stdout (vitest swallows console output of passing tests). */
function printTable(title: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]!);
  const cells = [keys, ...rows.map((r) => keys.map((k) => String(r[k])))];
  const widths = keys.map((_, i) =>
    Math.max(...cells.map((c) => (c[i] as string).length)),
  );
  const lines = cells.map((c) =>
    c.map((v, i) => v.padStart(widths[i]!)).join(" | "),
  );
  process.stdout.write(`\n${title}\n${lines.join("\n")}\n`);
}

describe("viewer vote strength (plan M0)", () => {
  it("sanity: every vote pairs its odometry point with its geo point through the TRUE alignment", () => {
    // Why this matters: the whole measurement assumes the votes sit at the
    // truth (a perfectly minted level). A basis slip in the code's WebXR pose
    // would make the votes disagree with the GPS track by a rotation and the
    // "vote strength" numbers would measure that slip instead.
    const votes = buildQrGpsVotes({
      qrPoseWorld: CODE_POSE_ODOM,
      sizeM: CODE_SIZE_M,
      qrGeo: CODE_GEO,
      syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
      baselineM: VIEWER_VOTE_BASELINE_M,
      count: VIEWER_VOTE_COUNT,
      timestamp: EPOCH_MS,
    });
    expect(votes).toHaveLength(VIEWER_VOTE_COUNT);
    for (const v of votes) {
      const o = rotY(rad(TRUE_YAW_DEG), webxrToNUE(v.odomPosition));
      const world: Vector3 = [
        o[0] + TRUE_T[0],
        o[1] + TRUE_T[1],
        o[2] + TRUE_T[2],
      ];
      const geo = calcRelativeCoordsInMeters(
        ORIGIN,
        { lat: v.rawGpsPoint.latitude, lon: v.rawGpsPoint.longitude },
        v.rawGpsPoint.altitude,
      );
      expect(
        Math.hypot(world[0] - geo[0], world[1] - geo[1], world[2] - geo[2]),
      ).toBeLessThan(0.001);
    }
  });

  it("sanity (M0b): the line layout pairs through the TRUE alignment, and a minted heading error displaces a ring point by r·err", () => {
    // Why this matters: M0b's horizontal-only layout is a test-local builder,
    // not production code, so it gets the same "votes sit at the truth" proof
    // as the ring above - at the widest swept radius, where a basis slip or a
    // float32 loss would be largest. The second half pins the premise of the
    // code-heading-error arms: a minted heading error of e degrees moves a
    // point r metres out along the code by r·e (0.17 m per degree per 10 m),
    // and moves a point straight above the code not at all.
    const truthOf = (v: RecordGpsEventPayload): number => {
      const o = rotY(rad(TRUE_YAW_DEG), webxrToNUE(v.odomPosition));
      const world: Vector3 = [
        o[0] + TRUE_T[0],
        o[1] + TRUE_T[1],
        o[2] + TRUE_T[2],
      ];
      const geo = calcRelativeCoordsInMeters(
        ORIGIN,
        { lat: v.rawGpsPoint.latitude, lon: v.rawGpsPoint.longitude },
        v.rawGpsPoint.altitude,
      );
      return Math.hypot(
        world[0] - geo[0],
        world[1] - geo[1],
        world[2] - geo[2],
      );
    };
    const line = (err: number, count = 4) =>
      buildLineVotes({
        qrGeo: mintedGeo(err),
        syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
        baselineM: 100,
        count,
        timestamp: EPOCH_MS,
      });
    expect(line(0, 16)).toHaveLength(16);
    for (const v of line(0, 16)) expect(truthOf(v)).toBeLessThan(0.001);
    // index 2 is the +r point (pairs ±r/2 first, then ±r).
    expect(truthOf(line(3)[2]!)).toBeCloseTo(100 * rad(3), 2);
    const ring = buildQrGpsVotes({
      qrPoseWorld: CODE_POSE_ODOM,
      sizeM: CODE_SIZE_M,
      qrGeo: mintedGeo(1),
      syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
      baselineM: 10,
      count: 4,
      timestamp: EPOCH_MS,
    });
    expect(truthOf(ring[0]!)).toBeCloseTo(10 * rad(1), 3); // local +x
    expect(truthOf(ring[1]!)).toBeLessThan(0.001); // straight above
  });

  it("sanity: with unbiased GPS the alignment is exact before and after the scan", () => {
    // Why this matters: the end-to-end half of the check above. With B = 0
    // the votes and the GPS agree, so any error here would be the harness's
    // (frames, clocks, the zero) and not the votes' strength.
    const m = runScenario({ ...TODAY, biasM: 0, postScanS: 30 });
    expect(m.preScanM).toBeLessThan(0.01);
    expect(m.preScanDeg).toBeLessThan(0.05);
    expect(m.scanEndM).toBeLessThan(0.01);
    expect(m.scanEndDeg).toBeLessThan(0.05);
    expect(m.max120M).toBeLessThan(0.01);
  }, 60_000);

  it("the harness's shortcuts change nothing: dev-check-free store and replica budget equal the viewer's own", () => {
    // Why this matters: the sweep uses a store without RTK's dev checks (for
    // speed) and a budget replica (to vary the budget). Both must reproduce
    // the viewer path bit for bit, or the sweep measures something else.
    const short = { ...TODAY, biasM: 8, postScanS: 20 };
    const viewer = runScenario({ ...short, store: "viewer" });
    expect(runScenario({ ...short, store: "measured" })).toEqual(viewer);
    expect(runScenario({ ...short, path: "replica" })).toEqual(viewer);
    expect(viewer.votesDispatched).toBe(
      MAX_VOTED_LOCKS_PER_CODE * VIEWER_VOTE_COUNT,
    );
  }, 60_000);

  // M0's viewer (a 2 m ring of 4 votes per lock, no keep-alive; the
  // constants before M2b), measured 2026-09-28 with gps-plus-slam-js 1.25.0.
  // Why these pins matter: they are M0's evidence for decision D3. They
  // assert the numbers as MEASURED, whichever way the rule falls, so any
  // later change to the votes or the solver shows up here as a diff to
  // re-read against the plan rather than as a silent shift.
  const PINNED: readonly {
    biasM: number;
    scanEndM: number;
    scanEndDeg: number;
    at60M: number;
    at120M: number;
    max120M: number;
    at300M: number;
  }[] = [
    {
      biasM: 3,
      scanEndM: 0.39,
      scanEndDeg: 5.87,
      at60M: 2.41,
      at120M: 2.74,
      max120M: 2.74,
      at300M: 2.87,
    },
    {
      biasM: 8,
      scanEndM: 0.1,
      scanEndDeg: 18.1,
      at60M: 8,
      at120M: 8,
      max120M: 8,
      at300M: 8,
    },
    {
      biasM: 15,
      scanEndM: 0.06,
      scanEndDeg: 30.79,
      at60M: 15,
      at120M: 15,
      max120M: 15,
      at300M: 15,
    },
  ];
  it.each(PINNED)(
    "M0's votes (2 m ring, 4 per lock), GPS biased $biasM m: the scan fixes the position at the code but not the heading, and GPS takes it back",
    (pin) => {
      const m = runScenario({ ...M0_VIEWER, biasM: pin.biasM });
      expect(m.preScanM).toBeCloseTo(pin.biasM, 2);
      expect(m.scanEndM).toBeCloseTo(pin.scanEndM, 1);
      expect(m.scanEndDeg).toBeCloseTo(pin.scanEndDeg, 0);
      expect(m.at60M).toBeCloseTo(pin.at60M, 1);
      expect(m.at120M).toBeCloseTo(pin.at120M, 1);
      expect(m.max120M).toBeCloseTo(pin.max120M, 1);
      expect(m.at300M).toBeCloseTo(pin.at300M, 1);
      // The decision rule: M0's votes do NOT meet it at any bias - the
      // heading after the scan is > 2°, and the position does not hold.
      expect(m.scanEndDeg).toBeGreaterThan(2);
      expect(m.max120M).toBeGreaterThan(0.5);
      expect(meetsRule(m)).toBe(false);
    },
    60_000,
  );
});

/**
 * The parameter sweep (owner rule: a one-value verdict is provisional). One
 * knob at a time from today's constants, at every bias. The solver's cost
 * grows with the history (every vote is its own `recordGpsEvent` and a full
 * re-solve), so this is opt-in: `VOTE_STRENGTH_SWEEP=1` runs the arms below
 * in a few minutes; `=heavy` adds the 1000-lock budget (≈4000 votes, over
 * ten minutes per bias on a loaded machine).
 */
const SWEEP = process.env.VOTE_STRENGTH_SWEEP;
describe.runIf(SWEEP === "1" || SWEEP === "heavy")(
  "vote strength sweep",
  () => {
    it("prints the sweep table", () => {
      const rows: Record<string, unknown>[] = [];
      for (const biasM of [3, 8, 15]) {
        const base: VoteParams = { ...M0_VIEWER, biasM };
        const r: VoteParams = { ...base, path: "replica" };
        const arms: [string, VoteParams][] = [
          ["today", base],
          ["budget 100", { ...r, budget: 100 }],
          ...(SWEEP === "heavy"
            ? ([["budget 1000", { ...r, budget: 1000, postScanS: 125 }]] as [
                string,
                VoteParams,
              ][])
            : []),
          ["acc 1", { ...r, voteAccuracyM: 1 }],
          ["count 40", { ...r, voteCount: 40 }],
          ["f 25", { ...r, timeFactor: 25 }],
          ["thr 10", { ...r, outlierThresholdM: 10 }],
          ["revote 1/fix", { ...r, revoteBatchesPerFix: 1, postScanS: 125 }],
          ["revote 3/fix", { ...r, revoteBatchesPerFix: 3, postScanS: 125 }],
          [
            "revote 3/fix thr 10",
            {
              ...r,
              revoteBatchesPerFix: 3,
              outlierThresholdM: 10,
              postScanS: 125,
            },
          ],
        ];
        for (const [label, p] of arms) {
          const t0 = performance.now();
          const m = runScenario(p);
          const out = {
            ...row(label, p, m),
            ms: Math.round(performance.now() - t0),
          };
          rows.push(out);
          process.stdout.write(`ROW ${JSON.stringify(out)}\n`);
        }
      }
      printTable(
        "vote strength sweep (m = horizontal error at the code, ° = heading error)",
        rows,
      );
      for (const r of rows)
        expect(Number.isFinite(r["scan m"] as number)).toBe(true);
    }, 3_600_000);
  },
);

/**
 * M0b (owner decision D8): wide synthetic pairs, a count/weight found
 * systematically, and a graceful fade after ~2 min. Opt-in like the sweep
 * above: `VOTE_STRENGTH_SWEEP=m0b-core` runs the radius × layout × count core
 * at B = 8 m and a true code heading; `=m0b-fine` runs the chosen arms across
 * bias, code heading error and keep-alive fade. Same scenario and rule as M0;
 * the replica path (budget 10 = today's) carries every arm.
 */
function rowM0b(
  label: string,
  p: VoteParams,
  m: Measured,
): Record<string, unknown> {
  return {
    arm: label,
    layout: p.layout ?? "circle",
    r: p.baselineM ?? VIEWER_VOTE_BASELINE_M,
    N: p.voteCount,
    fade: p.keepAliveFadeS ?? 0,
    B: p.biasM,
    err: p.codeHeadingErrDeg ?? 0,
    votes: m.votesDispatched,
    "scan m": r2(m.scanEndM),
    "scan °": r2(m.scanEndDeg),
    "+60 m": r2(m.at60M),
    "+120 m": r2(m.at120M),
    "max120 m": r2(m.max120M),
    "max120 °": r2(m.max120Deg),
    "p20 scan": r2(m.scanEndP20M),
    "p20 max120": r2(m.max120P20M),
    "step m": r2(m.maxStepM),
    "step °": r2(m.maxStepDeg),
    "stepAF m": r2(m.maxStepAfterFadeM),
    "stepAF °": r2(m.maxStepAfterFadeDeg),
    "end m": r2(m.endM),
    "end °": r2(m.endDeg),
    rule: meetsRule(m) ? "MEETS" : "fails",
  };
}

const M0B_BASE: VoteParams = {
  ...M0_VIEWER,
  path: "replica",
  postScanS: 125,
};

function m0bArms(which: string): [string, VoteParams][] {
  const arms: [string, VoteParams][] = [];
  if (which === "m0b-core") {
    for (const layout of ["circle", "line"] as const) {
      for (const baselineM of [2, 5, 10, 30, 100]) {
        for (const voteCount of [4, 8, 16]) {
          arms.push([
            "core",
            { ...M0B_BASE, biasM: 8, layout, baselineM, voteCount },
          ]);
        }
      }
    }
  }
  if (which === "m0b-fine") {
    /** A keep-alive arm runs its fade plus 60 s of GPS alone (≥ the 120 s rule). */
    const fade = (
      base: VoteParams,
      keepAliveFadeS: number,
      more: Partial<VoteParams> = {},
    ): VoteParams => ({
      ...base,
      keepAliveFadeS,
      postScanS: Math.max(125, keepAliveFadeS + 60),
      ...more,
    });
    // The core's picks (B = 8, true heading): N = 8 is the smallest count
    // whose scan is exact at r >= 5; r = 10 and r = 30 bracket the radius
    // (10: a 3° mint error moves the ends 0.52 m; 30: 1.57 m); the line
    // layout differs from the circle by < 0.6° anywhere in the core, so it
    // gets the B = 8 fades and the 3° error only.
    const c10: VoteParams = {
      ...M0B_BASE,
      layout: "circle",
      baselineM: 10,
      voteCount: 8,
    };
    const c30: VoteParams = {
      ...M0B_BASE,
      layout: "circle",
      baselineM: 30,
      voteCount: 8,
    };
    const l30: VoteParams = {
      ...M0B_BASE,
      layout: "line",
      baselineM: 30,
      voteCount: 8,
    };
    for (const [name, x] of [
      ["c10n8", c10],
      ["c30n8", c30],
    ] as const) {
      for (const s of [60, 120, 240])
        arms.push([name, fade(x, s, { biasM: 8 })]);
      for (const biasM of [3, 15]) {
        for (const s of [120, 240]) arms.push([name, fade(x, s, { biasM })]);
      }
      for (const codeHeadingErrDeg of [1, 3]) {
        arms.push([name, fade(x, 240, { biasM: 8, codeHeadingErrDeg })]);
      }
      arms.push([name, fade(x, 240, { biasM: 15, codeHeadingErrDeg: 3 })]);
    }
    for (const s of [60, 120, 240])
      arms.push(["l30n8", fade(l30, s, { biasM: 8 })]);
    arms.push(["l30n8", fade(l30, 240, { biasM: 8, codeHeadingErrDeg: 3 })]);
    // The widest radius that stays safe at a 3° mint error (circle, N = 8,
    // fade 240): the radii the arms above do not cover at B = 8, and all five
    // at B = 3 (below the outlier threshold, where no trimming hides it).
    for (const baselineM of [2, 5, 100]) {
      arms.push([
        "r@3°",
        fade(c10, 240, { biasM: 8, codeHeadingErrDeg: 3, baselineM }),
      ]);
    }
    for (const baselineM of [2, 5, 10, 30, 100]) {
      arms.push([
        "r@3°",
        fade(c10, 240, { biasM: 3, codeHeadingErrDeg: 3, baselineM }),
      ]);
    }
    // No keep-alive at the other biases, for reference.
    for (const biasM of [3, 15]) arms.push(["c30n8 none", { ...c30, biasM }]);
  }
  if (which === "m0b-attr") {
    // Attribution check, beyond the brief's grid: the fine arms jump by
    // metres in one fix whenever B exceeds the 5 m outlier threshold and
    // never below it. If the hard trim's bistability is the cause, lifting
    // the threshold above B must make the same fade smooth.
    const c30: VoteParams = {
      ...M0B_BASE,
      layout: "circle",
      baselineM: 30,
      voteCount: 8,
      keepAliveFadeS: 240,
      postScanS: 300,
    };
    arms.push(["c30n8 thr10", { ...c30, biasM: 8, outlierThresholdM: 10 }]);
    arms.push(["c30n8 thr20", { ...c30, biasM: 15, outlierThresholdM: 20 }]);
  }
  return arms;
}

describe.runIf(SWEEP?.startsWith("m0b") === true)(
  "vote strength M0b sweep",
  () => {
    it("prints the M0b table", () => {
      const rows: Record<string, unknown>[] = [];
      for (const [label, p] of m0bArms(SWEEP ?? "")) {
        const t0 = performance.now();
        const m = runScenario(p);
        const out = {
          ...rowM0b(label, p, m),
          ms: Math.round(performance.now() - t0),
        };
        rows.push(out);
        process.stdout.write(`ROW ${JSON.stringify(out)}\n`);
      }
      printTable(
        "M0b (m = horizontal error at the code, ° = heading error, p20 = error 20 m in front, step = largest per-fix jump, AF = after the fade)",
        rows,
      );
      for (const r of rows)
        expect(Number.isFinite(r["scan m"] as number)).toBe(true);
    }, 7_200_000);
  },
);

/**
 * M2b, the SHIPPED viewer (authoring plan 2026-09-28-0953): the 30 m ring of
 * 8 votes per lock and the viewer's own keep-alive (hold 120 s after the
 * code's last lock, fade 120 s, one ring per GPS fix) under TODAY's solver -
 * the published core's defaults, hard 5 m outlier trim on. The soft
 * trimming M0c adopted needs M2a's override keys and a core release; until
 * the viewer dispatches them this is what visitors get.
 *
 * Measured 2026-09-30 (gps-plus-slam-js 1.25.0), swept over the bias (owner
 * rule: a one-value verdict is provisional) and pinned as MEASURED, so a
 * change to the votes, the keep-alive or the solver shows up as a diff:
 * - B = 3 m meets the rule (0.37 m worst hold) and hands off smoothly
 *   (largest step 0.07 m); B = 5 m just fails it (0.34 m at the scan, 0.62 m
 *   hold) - below the trim the votes only blend with the GPS.
 * - B = 8 m holds exactly, then hands back to GPS in ONE fix during the
 *   fade: 2.97 m / 1.77° - the bistable hard trim M0b/M0c found.
 * - B = 15 m holds exactly and never hands off within 60 s of the
 *   keep-alive's end: once the votes own the solve the biased GPS stays
 *   trimmed.
 * The rule's verdict therefore flips between 3 and 5 m and again above the
 * 5 m trim, and the graceful hand-off the owner asked for (D8) is not met
 * above the trim: that is what the soft settings of M0c are for.
 *
 * Opt-in (`VOTE_STRENGTH_SWEEP=m2b`): each 300 s arm re-solves ~1,500
 * votes and took 1-4 minutes on a loaded machine. The default run keeps the
 * cheap wiring check below.
 */
const SHIPPED: VoteParams = {
  ...TODAY,
  shippedKeepAlive: true,
  postScanS: 300,
};

describe("the shipped keep-alive through the harness (M2b)", () => {
  it("casts the burst, then one full ring after every fix of the hold", () => {
    // Why this matters: the opt-in pins below measure the SHIPPED keep-alive
    // only if the harness drives it the way the viewer does. 20 s after the
    // scan every fix is inside the hold, so each adds exactly one ring.
    const m = runScenario({ ...SHIPPED, biasM: 8, postScanS: 20 });
    const burst = MAX_VOTED_LOCKS_PER_CODE * VIEWER_VOTE_COUNT;
    const fixesAfterFirstVote = m.trace.length - 1 + 2; // + 2 during the scan
    expect(m.votesDispatched).toBe(
      burst + fixesAfterFirstVote * VIEWER_VOTE_COUNT,
    );
    expect(m.scanEndM).toBeLessThan(0.01);
    expect(m.max120M).toBeLessThan(0.01);
  }, 120_000);
});

describe.runIf(SWEEP === "m2b")(
  "the shipped viewer under today's solver (M2b)",
  () => {
    const PINS = [
      {
        biasM: 3,
        scanEndM: 0.2,
        scanEndDeg: 0.18,
        max120M: 0.37,
        stepM: 0.07,
        endM: 1.14,
        meets: true,
      },
      {
        biasM: 5,
        scanEndM: 0.34,
        scanEndDeg: 0.3,
        max120M: 0.62,
        stepM: 0.12,
        endM: 1.9,
        meets: false,
      },
      {
        biasM: 8,
        scanEndM: 0,
        scanEndDeg: 0,
        max120M: 0,
        stepM: 2.97,
        endM: 3.04,
        meets: true,
      },
      {
        biasM: 15,
        scanEndM: 0,
        scanEndDeg: 0,
        max120M: 0,
        stepM: 0,
        endM: 0,
        meets: true,
      },
    ] as const;
    it.each(PINS)(
      "GPS biased $biasM m: as measured on 2026-09-30",
      (pin) => {
        const m = runScenario({ ...SHIPPED, biasM: pin.biasM });
        expect(m.scanEndM).toBeCloseTo(pin.scanEndM, 1);
        expect(m.scanEndDeg).toBeCloseTo(pin.scanEndDeg, 1);
        expect(m.max120M).toBeCloseTo(pin.max120M, 1);
        expect(m.maxStepM).toBeCloseTo(pin.stepM, 1);
        expect(m.endM).toBeCloseTo(pin.endM, 1);
        expect(meetsRule(m)).toBe(pin.meets);
      },
      1_800_000,
    );
  },
);
