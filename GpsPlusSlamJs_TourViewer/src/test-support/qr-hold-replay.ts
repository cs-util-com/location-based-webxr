/**
 * TEST ONLY (imported by `*.test.ts` files alone, never by the app): the
 * QR-first M0 replay instrument (QR-first alignment plan 2026-10-14-0445,
 * §3 M0, §7 #1-#8). It answers one question first - when a held code and
 * the alignment part ways, is it because GPS PULLS the alignment off the
 * kept pose, or because the kept pose, frozen at the last lock, stops
 * matching odometry that drifted? - and gives the levers of M2 their knobs.
 *
 * Three parts:
 *
 * - **Geometry and metrics.** A code placed through an alignment
 *   ({@link codeInWorld}) and read from its stored geo ({@link codeAtGeo}),
 *   both through the production vote geometry (`localPlaneOffset`, the
 *   double-precision quaternion rotation), so "zero" means "the votes agree".
 *   {@link resightingSplit} splits the honest end-to-end residual at a
 *   re-sighting into PULL (the alignment against the kept pose: only GPS, or
 *   another vote, can make it non-zero) and DRIFT (the fresh pose against
 *   the kept one, in odometry: no GPS involved). Exactly: total = pull + the
 *   alignment's turn of the drift (property-tested). The plain "code
 *   residual" of plan §3 is `pull` at a moment with no fresh pose: a
 *   diagnostic only, because the keep-alive re-votes the very pose it is
 *   measured against (§7 #4).
 * - **Knobs.** {@link VotePathKnobs}: the keep-alive's hold and fade (time,
 *   or lever L1's distance measured from the kept pose:
 *   {@link createDistanceHold}), votes per lock and per fix, ring radius,
 *   synthetic accuracy, the accuracy exponent (global, from the zero on:
 *   §7 #6), the soft trim, the compass (off, or biased:
 *   {@link withCompassBias}), GPS on or ignored, and whether a re-sighting's
 *   own votes are withheld (the witness rule of §7 #4).
 * - **The engine.** {@link replayVotePath} drives one ordered list of
 *   {@link ReplayEvent}s - from a recording ({@link parseViewerRecording}) or
 *   a synthetic scenario - through the viewer's own vote path: the
 *   production vote sink (`viewer-vote-sink.ts`), the production keep-alive
 *   (`qr-vote-keep-alive.ts`) and vote builder, into a store with the
 *   viewer's reducers. Every synthetic event of a recording is stripped and
 *   regenerated; at today's knobs the regenerated actions must equal the
 *   recorded ones (the check the opt-in suite runs first: a replay that
 *   disagrees with the phone is a broken instrument, not a finding).
 *
 * A locked frame goes through the PRODUCTION controller configuration
 * (`buildViewerControllerConfig`, in the tracking controller's order:
 * detection, stable pose, votes, lock), so the per-code budget, the re-arm
 * of a stale code and the keep-alive's keep or relock are the viewer's own.
 * The stable pose a frame offers is the scenario's (`stablePose`), the one
 * the phone voted from (`voted`), or - for a re-sighting the phone never
 * voted in, which a knob may make re-arm - the production fused pose over the
 * replayed detections. Before a code's first voted sighting, and within a
 * sighting the phone voted in, a frame the phone did not vote on offers none
 * (the phone's fused pose was not stable there).
 *
 * What the engine keeps AS RECORDED, whatever the knobs (stated so no arm
 * is read as more than it is): the moved-code veto's moment (or none, per
 * `veto`), the device fixes and their odometry. A distance hold (L1)
 * replaces the keep-alive's time hold and its pose freshness rule, but not
 * the core's recency kernel (§7 #7 names it; a core change).
 *
 * The engine stores its own dispatches in `dispatched` (gpsData actions only)
 * so a test can compare them to a recording's or to the production path's.
 */

import {
  calcRelativeCoordsInMeters,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  webxrToNUE,
  type LatLong,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import {
  buildQrGpsVotes,
  localPlaneOffset,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  rotateVectorByQuaternion,
  type Pose,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import {
  createSlamAppStore,
  qrDetectedReducer,
  recordGpsEvent,
  resetGpsSessionData,
  setAlignmentOverrides,
  selectQrFusedEntries,
  setZeroPos,
  type AlignmentOverrides,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { createQrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";

import {
  buildViewerControllerConfig,
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_KEEP_ALIVE_FADE_MS,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
} from "../qr-viewer-mode.js";
import {
  createQrVoteKeepAlive,
  keepAliveShare,
  type QrVoteKeepAlive,
} from "../qr-vote-keep-alive.js";
import { startEntryVoteSink, VIEWER_SOFT_TRIM } from "../viewer-vote-sink.js";

// ---------------------------------------------------------------------------
// Geometry and metrics
// ---------------------------------------------------------------------------

/** A code's place in GPS-world NUE (metres from the zero; up = absolute
 *  altitude) and the compass bearing of its local +x axis (degrees). */
interface CodePlacement {
  readonly n: number;
  readonly e: number;
  readonly up: number;
  readonly axisBearingDeg: number;
}

/** A horizontal difference: its north/east vector, length and signed yaw. */
interface Residual {
  readonly n: number;
  readonly e: number;
  readonly m: number;
  /** Signed, wrapped to (-180, 180]. */
  readonly deg: number;
}

const LOCAL_X: Vector3 = [1, 0, 0];
const deg = (r: number): number => (r * 180) / Math.PI;
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const bearingDeg = (n: number, e: number): number =>
  (deg(Math.atan2(e, n)) + 360) % 360;

/** world = A * odomNue (column-major 4x4, the store's convention). */
function mapNue(a: ArrayLike<number>, o: readonly number[]): Vector3 {
  return [
    a[0]! * o[0]! + a[4]! * o[1]! + a[8]! * o[2]! + a[12]!,
    a[1]! * o[0]! + a[5]! * o[1]! + a[9]! * o[2]! + a[13]!,
    a[2]! * o[0]! + a[6]! * o[1]! + a[10]! * o[2]! + a[14]!,
  ];
}

/** The pose's centre and the tip of its local +x, odometry NUE. */
function odomAxis(pose: Pose): { c: Vector3; x: Vector3 } {
  const r = rotateVectorByQuaternion(pose.rotation, LOCAL_X);
  const p = pose.position;
  return {
    c: webxrToNUE(p),
    x: webxrToNUE([p[0] + r[0], p[1] + r[1], p[2] + r[2]]),
  };
}

/** Where `alignment` puts a code whose odometry pose is `pose` (raw WebXR). */
export function codeInWorld(
  pose: Pose,
  alignment: ArrayLike<number>,
): CodePlacement {
  const { c, x } = odomAxis(pose);
  const wc = mapNue(alignment, c);
  const wx = mapNue(alignment, x);
  return {
    n: wc[0],
    up: wc[1],
    e: wc[2],
    axisBearingDeg: bearingDeg(wx[0] - wc[0], wx[2] - wc[2]),
  };
}

/** Where the code's stored geo says it is, relative to `zero`. */
export function codeAtGeo(geo: QrGeoPose, zero: LatLong): CodePlacement {
  const c = calcRelativeCoordsInMeters(
    zero,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
  );
  const axis = localPlaneOffset(LOCAL_X, geo);
  return {
    n: c[0],
    up: c[1],
    e: c[2],
    axisBearingDeg: bearingDeg(axis.north, axis.east),
  };
}

function residual(a: CodePlacement, b: CodePlacement): Residual {
  const n = a.n - b.n;
  const e = a.e - b.e;
  return {
    n,
    e,
    m: Math.hypot(n, e),
    deg: wrap180(a.axisBearingDeg - b.axisBearingDeg),
  };
}

/** The fresh pose against the kept one, in odometry NUE. */
function odometryDrift(fresh: Pose, kept: Pose): Residual {
  const f = odomAxis(fresh);
  const k = odomAxis(kept);
  const n = f.c[0] - k.c[0];
  const e = f.c[2] - k.c[2];
  return {
    n,
    e,
    m: Math.hypot(n, e),
    deg: wrap180(
      bearingDeg(f.x[0] - f.c[0], f.x[2] - f.c[2]) -
        bearingDeg(k.x[0] - k.c[0], k.x[2] - k.c[2]),
    ),
  };
}

interface ResightingSplit {
  /** The freshly measured code through the alignment, against its geo. */
  readonly total: Residual;
  /** The kept pose through the alignment, against the geo: GPS's pull. */
  readonly pull: Residual;
  /** The fresh pose against the kept pose, odometry NUE: the drift. */
  readonly drift: Residual;
}

export function resightingSplit(input: {
  readonly alignment: ArrayLike<number>;
  readonly fresh: Pose;
  readonly kept: Pose;
  readonly geo: QrGeoPose;
  readonly zero: LatLong;
}): ResightingSplit {
  const truth = codeAtGeo(input.geo, input.zero);
  return {
    total: residual(codeInWorld(input.fresh, input.alignment), truth),
    pull: residual(codeInWorld(input.kept, input.alignment), truth),
    drift: odometryDrift(input.fresh, input.kept),
  };
}

function quantile(values: readonly number[], q: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

interface NoiseFloor {
  readonly n: number;
  /** Horizontal distance of each pose from the set's median (m). */
  readonly p50M: number;
  readonly p90M: number;
  /** |yaw| of each pose's +x against the set's median yaw (deg). */
  readonly p50Deg: number;
  readonly p90Deg: number;
  /** The median pose's odometry centre and +x yaw: the robust fresh pose. */
  readonly median: {
    readonly n: number;
    readonly e: number;
    readonly yawDeg: number;
  } | null;
}

/** The scatter of a set of single-frame poses of one code: the floor a
 *  drift has to clear before it is drift. */
export function poseNoiseFloor(poses: readonly Pose[]): NoiseFloor {
  if (poses.length === 0) {
    return {
      n: 0,
      p50M: Number.NaN,
      p90M: Number.NaN,
      p50Deg: Number.NaN,
      p90Deg: Number.NaN,
      median: null,
    };
  }
  const axes = poses.map(odomAxis);
  const yaws = axes.map((a) => bearingDeg(a.x[0] - a.c[0], a.x[2] - a.c[2]));
  const ref = yaws[0]!;
  const rel = yaws.map((y) => wrap180(y - ref));
  const mYaw = quantile(rel, 0.5);
  const mn = quantile(
    axes.map((a) => a.c[0]),
    0.5,
  );
  const me = quantile(
    axes.map((a) => a.c[2]),
    0.5,
  );
  const dist = axes.map((a) => Math.hypot(a.c[0] - mn, a.c[2] - me));
  const dYaw = rel.map((r) => Math.abs(wrap180(r - mYaw)));
  return {
    n: poses.length,
    p50M: quantile(dist, 0.5),
    p90M: quantile(dist, 0.9),
    p50Deg: quantile(dYaw, 0.5),
    p90Deg: quantile(dYaw, 0.9),
    median: { n: mn, e: me, yawDeg: (ref + mYaw + 360) % 360 },
  };
}

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

type RawAbsoluteOrientation = NonNullable<
  RecordGpsEventPayload["rawAbsoluteOrientation"]
>;

/**
 * A compass reading turned about the vertical so the core's AR-north bearing
 * (`arNorthBearingDeg`) reads `biasDeg` more: the sensor quaternion maps the
 * device into East-North-Up, so a turn about Up applied after it is a
 * heading error of the magnetometer and nothing else. The sign is pinned by
 * a test against the core's own reader.
 */
export function withCompassBias(
  reading: RawAbsoluteOrientation,
  biasDeg: number,
): RawAbsoluteOrientation {
  if (biasDeg === 0) return reading;
  const h = (-biasDeg * Math.PI) / 360;
  const qz: Quaternion = [0, 0, Math.sin(h), Math.cos(h)];
  const [x, y, z, w] = reading.quaternion;
  const [bx, by, bz, bw] = qz;
  return {
    ...reading,
    quaternion: [
      bw * x + bx * w + by * z - bz * y,
      bw * y - bx * z + by * w + bz * x,
      bw * z + bx * y - by * x + bz * w,
      bw * w - bx * x - by * y - bz * z,
    ],
  };
}

/** Whether a recorded GPS event is a code's vote (a lock's or the
 *  keep-alive's) rather than a device fix: the core's source stamp, or a
 *  vote id prefix for an unstamped build. */
export function isSyntheticEvent(event: RecordGpsEventPayload): boolean {
  const p = event.rawGpsPoint as { source?: unknown; id?: unknown };
  if (p.source === GPS_POINT_SOURCE_SYNTHETIC_QR) return true;
  return typeof p.id === "string" && p.id.startsWith("qr-");
}

/** How lever L1 measures "the walk since the last lock", from the KEPT pose
 *  (§7 #1): straight-line reach now, the largest reach so far, or the path
 *  length (every step summed: the measure the core dropped as jittery). */
type DistanceMeasure = "reach" | "excursion" | "path";

interface DistanceHoldSettings {
  readonly measure: DistanceMeasure;
  readonly holdM: number;
  readonly fadeM: number;
}

interface DistanceHold {
  /** Restart from `origin` (odometry north/east, m): the kept pose. */
  keep(origin: readonly [number, number]): void;
  /** The phone at `at` (odometry north/east): the hold's share now. */
  share(at: readonly [number, number]): number;
  /** The measured distance so far (m). */
  distance(): number;
}

export function createDistanceHold(s: DistanceHoldSettings): DistanceHold {
  let origin: readonly [number, number] = [0, 0];
  let last: readonly [number, number] = [0, 0];
  let excursion = 0;
  let path = 0;
  let current = 0;
  return {
    keep(o) {
      origin = o;
      last = o;
      excursion = 0;
      path = 0;
      current = 0;
    },
    share(at) {
      const reach = Math.hypot(at[0] - origin[0], at[1] - origin[1]);
      excursion = Math.max(excursion, reach);
      path += Math.hypot(at[0] - last[0], at[1] - last[1]);
      last = at;
      current =
        s.measure === "reach"
          ? reach
          : s.measure === "excursion"
            ? excursion
            : path;
      return keepAliveShare(current, s.holdM, s.fadeM);
    },
    distance: () => current,
  };
}

export interface VotePathKnobs {
  /** The keep-alive's time hold and fade after the kept code's last lock. */
  readonly holdMs: number;
  readonly fadeMs: number;
  /** Lever L1: when set, the hold is over distance from the kept pose
   *  instead of time (the time hold is then unused). */
  readonly distanceHold?: DistanceHoldSettings;
  readonly votesPerLock: number;
  readonly votesPerFix: number;
  readonly baselineM: number;
  readonly syntheticAccuracyM: number;
  /** `gpsAccuracyExponent` for the whole session from the zero on (the core
   *  default, 0.1, when absent): global, so it re-weights GPS-only solving
   *  too (§7 #6). */
  readonly accuracyExponent?: number;
  /** The solver keys the sink turns on before the first vote; null = the
   *  core's shipped hard trim. */
  readonly softTrim: Readonly<AlignmentOverrides> | null;
  /** `off` strips every compass reading from the device fixes. */
  readonly compass: "on" | "off";
  /** Added to every compass reading's AR-north bearing (deg). */
  readonly compassBiasDeg: number;
  /** `off`: device fixes are not stored (the keep-alive still answers each
   *  one, ring only) - the "GPS ignored" arm. */
  readonly gps: "on" | "off";
  /** Withhold the votes of every voted sighting of a code after its first
   *  one, so later sightings are pure witnesses (§7 #4). */
  readonly witnessResightings?: boolean;
  /** `as-recorded`: the recording's moved-code veto retracts the votes where
   *  it did; `none`: no veto (today's rule did not veto the 2026-10-10
   *  session). Synthetic scenarios carry none either way. */
  readonly veto?: "as-recorded" | "none";
}

/** The viewer's shipped values (`qr-viewer-mode.ts`, `viewer-vote-sink.ts`). */
export const TODAY_KNOBS: VotePathKnobs = Object.freeze({
  holdMs: VIEWER_KEEP_ALIVE_HOLD_MS,
  fadeMs: VIEWER_KEEP_ALIVE_FADE_MS,
  votesPerLock: VIEWER_VOTE_COUNT,
  votesPerFix: VIEWER_VOTE_COUNT,
  baselineM: VIEWER_VOTE_BASELINE_M,
  syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
  softTrim: VIEWER_SOFT_TRIM,
  compass: "on",
  compassBiasDeg: 0,
  gps: "on",
  veto: "as-recorded",
});

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** One step of a session, in the order the viewer saw it. */
export type ReplayEvent =
  | { readonly kind: "zero"; readonly zero: LatLong }
  /** An AR entry: the sink clears every override, a fresh keep-alive. */
  | { readonly kind: "entry" }
  | {
      readonly kind: "fix";
      /** When the fix ARRIVED, on the clock the locks are timed on. */
      readonly arrivalMs: number;
      readonly payload: RecordGpsEventPayload;
    }
  | {
      /** A locked frame of `text` (the controller's onLocked). */
      readonly kind: "lock";
      readonly text: string;
      /** The detection's time (the keep-alive's clock). */
      readonly atMs: number;
      /** The frame's single-frame pose (raw WebXR). */
      readonly detectionPose: Pose;
      /** The code's level (geo and printed size); absent: geo-less. */
      readonly level?: { readonly geo: QrGeoPose; readonly sizeM: number };
      /** What the stable-pose gate offers on this frame, when the source
       *  says so (synthetic sessions); absent: see the engine's header. */
      readonly stablePose?: Pose | null;
      /** Present when the phone voted on this frame: the stable pose its
       *  votes were built from, the level, and the votes' stamp. */
      readonly voted?: {
        readonly pose: Pose;
        readonly geo: QrGeoPose;
        readonly sizeM: number;
        readonly stampMs: number;
      };
    }
  /** The moved-code veto ignored `text` (D20) and, when `retracted`, took
   *  every vote back; false where the phone had no vote sink and retracted
   *  nothing (its recovery left no action in the recording). */
  | {
      readonly kind: "veto";
      readonly text: string;
      readonly retracted: boolean;
    }
  /** The GPS history was reset outside a veto (an AR exit). */
  | { readonly kind: "reset" }
  /** Any other recorded action the store should see, dispatched as is. */
  | {
      readonly kind: "action";
      readonly action: { readonly type: string; readonly payload?: unknown };
    };

/** The store the engine builds: the viewer's reducers, dev checks off
 *  (production strips them; the vote-strength harness pins the equality). */
export function createReplayStore() {
  return createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    extraReducers: { qrDetected: qrDetectedReducer },
    enableDevChecks: false,
  });
}

type ReplayStore = ReturnType<typeof createReplayStore>;

/** What the engine knows about the code it keeps (for the metrics). */
interface KeptState {
  readonly text: string;
  readonly pose: Pose;
  readonly geo: QrGeoPose;
  /** The kept code's last voted lock (ms, lock clock). */
  readonly keptAtMs: number;
  /** The phone's odometry north/east at that lock. */
  readonly phoneAtKeep: readonly [number, number] | null;
}

interface ReplayHooks {
  /** Before each event is applied; `index` into the event list. */
  before?(event: ReplayEvent, index: number, ctx: ReplayContext): void;
  /** After each event is applied. */
  after?(event: ReplayEvent, index: number, ctx: ReplayContext): void;
}

interface ReplayContext {
  readonly store: ReplayStore;
  /** The code the keep-alive keeps now, or null. */
  kept(): KeptState | null;
  /** The keep-alive's share at `atMs` for the kept code (0 when none). */
  holdShare(atMs: number): number;
  /** The phone's last odometry north/east (from the last device fix). */
  phone(): readonly [number, number] | null;
  /** Synthetic events the engine cast per event index (regenerated). */
  readonly castAt: ReadonlyMap<number, readonly RecordGpsEventPayload[]>;
}

interface ReplayResult {
  readonly store: ReplayStore;
  /** Every gpsData action the engine dispatched, in order. */
  readonly dispatched: readonly {
    readonly type: string;
    readonly payload?: unknown;
  }[];
  readonly castAt: ReadonlyMap<number, readonly RecordGpsEventPayload[]>;
}

/** A keep-alive whose share comes from a {@link DistanceHold}: lever L1.
 *  Mirrors `createQrVoteKeepAlive`'s credit accumulator and its ring
 *  minimum; its freshness rule is distance too. */
function createDistanceKeepAlive(
  knobs: VotePathKnobs,
  settings: DistanceHoldSettings,
  phone: () => readonly [number, number] | null,
): QrVoteKeepAlive {
  const hold = createDistanceHold(settings);
  let kept: Parameters<QrVoteKeepAlive["keep"]>[0] | null = null;
  let credit = 0;
  let share = 0;
  const origin = (pose: Pose): [number, number] => {
    const c = webxrToNUE(pose.position);
    return [c[0], c[2]];
  };
  const fresh = (text: string): boolean =>
    kept?.text === text && hold.distance() <= settings.holdM;
  return {
    keep(code) {
      if (kept?.text !== code.text) credit = 0;
      kept = code;
      hold.keep(origin(code.qrPoseWorld));
      const p = phone();
      share = p === null ? 1 : hold.share(p);
    },
    relock(text) {
      if (!fresh(text) || kept === null) return;
      hold.keep(origin(kept.qrPoseWorld));
      const p = phone();
      share = p === null ? 1 : hold.share(p);
    },
    holdsFreshPose: (text) => fresh(text),
    votesForFix({ stampMs }) {
      if (kept === null || !Number.isFinite(stampMs)) return [];
      const p = phone();
      share = p === null ? share : hold.share(p);
      if (share === 0) return [];
      credit += knobs.votesPerFix * share;
      const count = Math.floor(credit);
      if (count < 3) return [];
      credit -= count;
      return buildQrGpsVotes({
        qrPoseWorld: kept.qrPoseWorld,
        sizeM: kept.sizeM,
        qrGeo: kept.qrGeo,
        syntheticAccuracyM: knobs.syntheticAccuracyM,
        baselineM: knobs.baselineM,
        count,
        timestamp: stampMs,
        idPrefix: "qr-keep",
      });
    },
    phase: () =>
      kept === null
        ? { kind: "none" }
        : share >= 1
          ? { kind: "holding", text: kept.text, remainingMs: 0 }
          : share > 0
            ? { kind: "fading", text: kept.text, share }
            : { kind: "ended", text: kept.text },
    stop() {
      kept = null;
      credit = 0;
    },
  };
}

/** The device fix as the knobs see it: compass stripped or biased. */
function fixUnderKnobs(
  payload: RecordGpsEventPayload,
  knobs: VotePathKnobs,
): RecordGpsEventPayload {
  const ao = payload.rawAbsoluteOrientation;
  if (ao === undefined) return payload;
  if (knobs.compass === "off") {
    const { rawAbsoluteOrientation: _dropped, ...rest } = payload;
    return rest;
  }
  if (knobs.compassBiasDeg === 0) return payload;
  return {
    ...payload,
    rawAbsoluteOrientation: withCompassBias(ao, knobs.compassBiasDeg),
  };
}

/**
 * Drive `events` through the viewer's vote path under `knobs`. Deterministic;
 * a fresh store per call.
 */
export function replayVotePath(
  events: readonly ReplayEvent[],
  knobs: VotePathKnobs,
  hooks: ReplayHooks = {},
): ReplayResult {
  const store = createReplayStore();
  const dispatched: { type: string; payload?: unknown }[] = [];
  const castAt = new Map<number, RecordGpsEventPayload[]>();
  let currentIndex = -1;
  const noteCast = (votes: readonly RecordGpsEventPayload[]): void => {
    if (votes.length === 0) return;
    castAt.set(currentIndex, [...(castAt.get(currentIndex) ?? []), ...votes]);
  };
  /** Every dispatch goes through here: recorded, and the sink's override
   *  payloads mapped to the knobs' solver (identity at today's values). */
  const tracked = {
    dispatch(action: { type: string; payload?: unknown }): unknown {
      let a = action;
      if (a.type === setAlignmentOverrides.type) {
        a = setAlignmentOverrides(
          overridesUnderKnobs(a.payload as AlignmentOverrides | null),
        );
      }
      dispatched.push(a);
      return store.dispatch(a as never);
    },
    getState: store.getState,
  };
  function overridesUnderKnobs(
    payload: AlignmentOverrides | null,
  ): AlignmentOverrides | null {
    const exponent =
      knobs.accuracyExponent === undefined
        ? {}
        : { gpsAccuracyExponent: knobs.accuracyExponent };
    if (payload === null) {
      return Object.keys(exponent).length === 0 ? null : exponent;
    }
    // The sink turns VIEWER_SOFT_TRIM on over whatever is set: keep the rest,
    // swap that part for the knobs' solver.
    const rest = Object.fromEntries(
      Object.entries(payload).filter(([k]) => !(k in VIEWER_SOFT_TRIM)),
    );
    const merged = { ...rest, ...exponent, ...(knobs.softTrim ?? {}) };
    return Object.keys(merged).length === 0 ? null : merged;
  }

  let phone: readonly [number, number] | null = null;
  let sink: ReturnType<typeof startEntryVoteSink> | null = null;
  let keepAlive: QrVoteKeepAlive | null = null;
  let config: ReturnType<typeof buildViewerControllerConfig> | null = null;
  let budget = createQrVoteBudget(MAX_VOTED_LOCKS_PER_CODE);
  let fused: ReturnType<typeof createFusedQrPoseSource> | null = null;
  let kept: KeptState | null = null;
  const ignored = new Set<string>();

  // Sightings (a gap over 2 s, or another code, starts a new one), and
  // whether the source says the phone voted in each.
  const sightingOf = new Map<number, number>();
  const sightingVotedOnPhone: boolean[] = [];
  {
    let last: { text: string; atMs: number } | null = null;
    events.forEach((e, i) => {
      if (e.kind !== "lock") return;
      if (last === null || last.text !== e.text || e.atMs - last.atMs > 2000) {
        sightingVotedOnPhone.push(false);
      }
      last = { text: e.text, atMs: e.atMs };
      const s = sightingVotedOnPhone.length - 1;
      sightingOf.set(i, s);
      if (e.voted !== undefined) sightingVotedOnPhone[s] = true;
    });
  }
  /** Per code: the sighting of its first votes in this replay. */
  const firstVotedSighting = new Map<string, number>();
  let currentLock: {
    event: Extract<ReplayEvent, { kind: "lock" }>;
    sighting: number;
  } | null = null;

  const newKeepAlive = (): QrVoteKeepAlive => {
    const inner =
      knobs.distanceHold === undefined
        ? createQrVoteKeepAlive({
            holdMs: knobs.holdMs,
            fadeMs: knobs.fadeMs,
            votesPerFix: knobs.votesPerFix,
            baselineM: knobs.baselineM,
            syntheticAccuracyM: knobs.syntheticAccuracyM,
          })
        : createDistanceKeepAlive(knobs, knobs.distanceHold, () => phone);
    // Observed, not changed: the metrics read the pose it keeps.
    return {
      ...inner,
      keep(code, atMs) {
        inner.keep(code, atMs);
        kept = {
          text: code.text,
          pose: code.qrPoseWorld,
          geo: code.qrGeo,
          keptAtMs: atMs,
          phoneAtKeep: phone,
        };
      },
      votesForFix(fix) {
        const votes = inner.votesForFix(fix);
        if (inner.phase(fix.atMs).kind === "none") kept = null;
        return votes;
      },
      stop() {
        inner.stop();
        kept = null;
      },
    };
  };

  /** The stable pose the gate offers on the current frame. */
  function stablePoseNow(text: string): Pose | null {
    if (currentLock === null || currentLock.event.text !== text) return null;
    const { event, sighting } = currentLock;
    const first = firstVotedSighting.get(text);
    const later = first !== undefined && sighting !== first;
    if (knobs.witnessResightings === true && later) return null;
    if (event.stablePose !== undefined) return event.stablePose;
    if (event.voted !== undefined) return event.voted.pose;
    if (later && sightingVotedOnPhone[sighting] !== true) {
      return fused?.resolve(text) ?? null;
    }
    return null;
  }

  function startEntry(): void {
    keepAlive?.stop();
    kept = null;
    keepAlive = newKeepAlive();
    budget = createQrVoteBudget(MAX_VOTED_LOCKS_PER_CODE);
    ignored.clear();
    firstVotedSighting.clear();
    sink = startEntryVoteSink(tracked);
    const entrySink = sink;
    fused = createFusedQrPoseSource({
      entriesOf: (text) => selectQrFusedEntries(store.getState(), text),
      optionsFor: (text) => {
        const sizeM = sizeOf.get(text);
        return sizeM === undefined ? {} : { sizeM };
      },
    });
    config = buildViewerControllerConfig({
      frontEnd: {
        kind: "barcode-detector",
        detect: () => Promise.resolve(null),
      },
      solvePose: () => null,
      getIntrinsics: () => null,
      getLevels: () => null,
      dispatchVotes: (votes) => {
        noteCast(votes);
        entrySink.castLockVotes(votes);
        if (
          currentLock !== null &&
          !firstVotedSighting.has(currentLock.event.text)
        ) {
          firstVotedSighting.set(currentLock.event.text, currentLock.sighting);
        }
      },
      canAcceptVotes: () => store.getState().gpsData?.zero != null,
      resolveStablePose: stablePoseNow,
      recordDetection: () => undefined,
      onError: () => undefined,
      keepAlive,
      voteBudget: budget,
      isIgnored: (text) => ignored.has(text),
      now: () => currentLock?.event.atMs ?? 0,
    });
  }

  /** Each code's printed size, for the fused pose. */
  const sizeOf = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "lock") continue;
    const size = e.level?.sizeM ?? e.voted?.sizeM;
    if (size !== undefined && Number.isFinite(size) && !sizeOf.has(e.text)) {
      sizeOf.set(e.text, size);
    }
  }

  const ctx: ReplayContext = {
    store,
    kept: () => kept,
    holdShare: (atMs) => {
      if (kept === null || keepAlive === null) return 0;
      const p = keepAlive.phase(atMs);
      return p.kind === "holding" ? 1 : p.kind === "fading" ? p.share : 0;
    },
    phone: () => phone,
    castAt,
  };

  events.forEach((event, index) => {
    currentIndex = index;
    hooks.before?.(event, index, ctx);
    switch (event.kind) {
      case "zero":
        tracked.dispatch(setZeroPos(event.zero));
        if (knobs.accuracyExponent !== undefined) {
          tracked.dispatch(setAlignmentOverrides(null));
        }
        break;
      case "entry":
        startEntry();
        break;
      case "fix": {
        const c = webxrToNUE(event.payload.odomPosition);
        phone = [c[0], c[2]];
        const payload = fixUnderKnobs(event.payload, knobs);
        const ring =
          keepAlive?.votesForFix({
            atMs: event.arrivalMs,
            stampMs: payload.rawGpsPoint.timestamp,
          }) ?? [];
        noteCast(ring);
        if (sink === null) {
          if (knobs.gps === "on") tracked.dispatch(recordGpsEvent(payload));
        } else if (knobs.gps === "on") {
          sink.recordFix(payload, ring);
        } else if (ring.length > 0) {
          sink.castLockVotes(ring);
        }
        break;
      }
      case "lock": {
        if (config === null) break;
        currentLock = { event, sighting: sightingOf.get(index) ?? -1 };
        // The tracking controller's order for one locked frame.
        config.onDetection?.({
          text: event.text,
          timestamp: event.atMs,
          qrPoseWorld: event.detectionPose,
        } as QrDetectionEvent);
        const geo = event.level?.geo ?? event.voted?.geo;
        const sizeM = event.level?.sizeM ?? event.voted?.sizeM;
        const level: QrLevel = {
          version: 1,
          qr:
            geo === undefined || sizeM === undefined
              ? {}
              : { geo, physicalSizeM: sizeM },
        };
        if (level.qr.geo !== undefined && sizeM !== undefined) {
          const pose = config.resolveStablePose?.(event.text) ?? null;
          if (pose !== null) {
            config.dispatchVotes(
              buildQrGpsVotes({
                qrPoseWorld: pose,
                sizeM,
                qrGeo: level.qr.geo,
                syntheticAccuracyM: knobs.syntheticAccuracyM,
                baselineM: knobs.baselineM,
                count: knobs.votesPerLock,
                timestamp: event.voted?.stampMs ?? event.atMs,
              }),
            );
          }
        }
        config.onLocked?.({} as never, level);
        currentLock = null;
        break;
      }
      case "veto":
        if (knobs.veto === "none") break;
        // viewer-placement's vetoMovedCode: ignore, stop its hold, take
        // every vote back (only where the phone did), give every other code
        // its budget back (always: the viewer resets it after either).
        ignored.add(event.text);
        if (kept?.text === event.text) keepAlive?.stop();
        if (event.retracted) sink?.retractVotes();
        budget.reset();
        break;
      case "reset":
        keepAlive?.stop();
        tracked.dispatch(resetGpsSessionData());
        break;
      case "action":
        tracked.dispatch(event.action);
        break;
    }
    hooks.after?.(event, index, ctx);
  });
  return { store, dispatched, castAt };
}
