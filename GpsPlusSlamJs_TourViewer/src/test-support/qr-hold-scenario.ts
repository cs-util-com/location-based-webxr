/**
 * TEST ONLY (imported by `*.test.ts` files alone, never by the app):
 * synthetic visitor sessions for the QR-first M0 replay (plan
 * 2026-10-14-0445, §3 M0, §7 #3): a code scanned once, then a walk, with the
 * two candidate causes of a held code drifting off made explicit and
 * separately controllable -
 *
 * - **GPS error** ({@link GpsErrorModel}): a constant bias plus a
 *   Gauss-Markov wander and white noise (the synthetic arms), or a REAL
 *   per-fix error series (the corpus arm: a cross-day bias and a real walk's
 *   residuals around its own alignment);
 * - **odometry drift** ({@link OdometryDrift}): the measured odometry frame
 *   turns and slides against the true one as the session goes on - a yaw
 *   rate over time and a translation that grows with the path walked since
 *   the scan, the rotation pivoting at the odometry origin. Every device fix,
 *   and every later sighting of the code, is measured through the drifted
 *   frame; the code's votes come from the pose measured at the scan.
 *
 * The code's stored geo is the TRUTH (a perfectly measured code), so a
 * re-sighting's residual is the alignment's error and nothing else.
 *
 * Geometry (deterministic): zero at 48.137 N 11.575 E; the true alignment a
 * 40 degree yaw plus a translation (the vote-strength harness's); a
 * vertical code 1.5 m up facing south-east; the phone starts 2 m in front of
 * it. Walks: `kitchen` - a slow closed wander inside a 5 m x 4 m room
 * beside the code (the owner's kitchen and living room); `out-and-back` - a
 * straight walk away from the code and back (S3's shape).
 */

import {
  calcGpsCoords,
  webxrToNUE,
  type LatLong,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import { createReplayStore, type ReplayEvent } from "./qr-hold-replay.js";

// The core's geodesy is licence-gated and the constants below call it; a
// store activates it, as the page does at boot.
createReplayStore();

export const SCENARIO_ZERO: LatLong = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const TRUE_YAW_DEG = 40;
const TRUE_T: Vector3 = [5, 400, -8];
const CODE_HEADING_DEG = 135;
/** The code's true world NUE (metres from the zero; up = altitude). */
const CODE_WORLD: Vector3 = [2, 401.5, 1];
const PHONE_UP = 400.3;
const SCENARIO_CODE_TEXT = "https://gps.csutil.com/?qr=qr-hold-scenario";
const SIZE_M = 0.16;
const LOCKS = 10;
const LOCK_INTERVAL_MS = 125;

const rad = (d: number): number => (d * Math.PI) / 180;

function rotY(a: number, v: readonly number[]): Vector3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0]! + s * v[2]!, v[1]!, -s * v[0]! + c * v[2]!];
}
const yawQuat = (a: number): Quaternion => [
  0,
  Math.sin(a / 2),
  0,
  Math.cos(a / 2),
];
function mulQuat(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
const nueToWebxr = (v: readonly number[]): Vector3 => [v[2]!, v[1]!, -v[0]!];

/** True world NUE to true odometry NUE (the inverse of the true alignment). */
function odomFromWorld(w: readonly number[]): Vector3 {
  return rotY(-rad(TRUE_YAW_DEG), [
    w[0]! - TRUE_T[0],
    w[1]! - TRUE_T[1],
    w[2]! - TRUE_T[2],
  ]);
}

/** The true alignment, column-major (world = Ry(yaw) odomNue + t). */
export const SCENARIO_TRUE_ALIGNMENT: readonly number[] = (() => {
  const c = Math.cos(rad(TRUE_YAW_DEG));
  const s = Math.sin(rad(TRUE_YAW_DEG));
  return [
    c,
    0,
    -s,
    0,
    0,
    1,
    0,
    0,
    s,
    0,
    c,
    0,
    TRUE_T[0],
    TRUE_T[1],
    TRUE_T[2],
    1,
  ];
})();

export const SCENARIO_CODE_GEO: QrGeoPose = {
  ...calcGpsCoords(SCENARIO_ZERO, CODE_WORLD),
  alt: CODE_WORLD[1],
  headingDeg: CODE_HEADING_DEG,
};

/** The code's TRUE odometry pose (raw WebXR): a vertical poster at heading
 *  h maps its local axes by Ry(pi/2 - h - yaw) (the vote-strength harness's
 *  derivation; the default run pins that its votes pair through the truth). */
export const SCENARIO_CODE_POSE: Pose = {
  position: nueToWebxr(odomFromWorld(CODE_WORLD)),
  rotation: yawQuat(Math.PI / 2 - rad(CODE_HEADING_DEG) - rad(TRUE_YAW_DEG)),
};

type GpsErrorModel =
  | {
      readonly kind: "synthetic";
      readonly biasM: number;
      readonly biasBearingDeg: number;
      /** Gauss-Markov wander: stationary sigma per axis (m) and its time
       *  constant (s). */
      readonly wanderM: number;
      readonly wanderTauS: number;
      /** White noise per axis (m). */
      readonly whiteM: number;
      /** Reported accuracy of every fix (m). */
      readonly accuracyM: number;
    }
  | {
      readonly kind: "series";
      /** Per fix: the error north/east (m) and the reported accuracy; the
       *  series repeats if the session is longer. */
      readonly errors: readonly (readonly [number, number, number])[];
      readonly label: string;
    };

interface OdometryDrift {
  /** Translation per metre of path walked since the scan (a fraction). */
  readonly perM: number;
  /** Its direction in odometry NUE (deg clockwise from odometry north). */
  readonly bearingDeg: number;
  /** Yaw drift (deg per minute since the scan), about the odometry origin. */
  readonly yawDegPerMin: number;
}

export interface ScenarioParams {
  readonly seed: number;
  /** Device fixes before the scan (s), the phone standing at the code. */
  readonly preScanS: number;
  /** Seconds of walking after the scan. */
  readonly afterS: number;
  readonly walk: "kitchen" | "out-and-back";
  readonly speedMps: number;
  /** Out-and-back: how far out (m). */
  readonly outM?: number;
  readonly gps: GpsErrorModel;
  readonly odometry: OdometryDrift;
}

export interface Scenario {
  readonly events: ReplayEvent[];
  readonly zero: LatLong;
  /** The last voted lock (ms): the keep-alive's time base. */
  readonly scanMs: number;
  /** The code as the drifted odometry measures it at `atMs` (raw WebXR):
   *  a perfect re-sighting at that moment. */
  freshPoseAt(atMs: number): Pose;
  /** Path walked since the scan at `atMs` (m, true). */
  pathAt(atMs: number): number;
  /** Straight-line distance from the code at `atMs` (m, true). */
  reachAt(atMs: number): number;
}

/** mulberry32 + Box-Muller, deterministic. */
function gaussian(seed: number): () => number {
  let a = seed >>> 0;
  const u = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** The phone's true horizontal place (world N, E) `s` seconds after the scan. */
function walkAt(p: ScenarioParams, s: number): [number, number] {
  const start: [number, number] = [CODE_WORLD[0] - 2, CODE_WORLD[2] - 0.5];
  if (s <= 0) return start;
  const d = s * p.speedMps;
  if (p.walk === "out-and-back") {
    const out = p.outM ?? 200;
    const along =
      d % (2 * out) <= out ? d % (2 * out) : 2 * out - (d % (2 * out));
    // Away from the code's face, south-west.
    return [start[0] - along * Math.SQRT1_2, start[1] - along * Math.SQRT1_2];
  }
  // The kitchen: a slow Lissajous wander in a 5 m x 4 m room whose corner
  // is the standing spot, so the phone keeps coming back near the code.
  // d / 2.1 makes the speed along this curve close to speedMps (the
  // reported path is the true one either way).
  const w = d / 2.1;
  return [
    start[0] - 2.5 + 2.5 * Math.cos(w),
    start[1] - 2 + 2 * Math.cos(w * 0.77 + Math.PI / 3) + 1,
  ];
}

export function buildScenario(p: ScenarioParams): Scenario {
  const g = gaussian(p.seed);
  const scanStartMs = EPOCH_MS + p.preScanS * 1000 + 300;
  const scanMs = scanStartMs + (LOCKS - 1) * LOCK_INTERVAL_MS;
  const sAfter = (ms: number): number => Math.max(0, (ms - scanMs) / 1000);

  // The true path length since the scan, sampled finely.
  const pathAt = (ms: number): number => {
    const s = sAfter(ms);
    let total = 0;
    let prev = walkAt(p, 0);
    for (let t = 0.25; t <= s + 1e-9; t += 0.25) {
      const q = walkAt(p, t);
      total += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
    return total;
  };
  /** The drifted odometry frame at `ms`: odomMeasured = D(odomTrue). */
  const drift = (ms: number) => {
    const yaw = rad((p.odometry.yawDegPerMin * sAfter(ms)) / 60);
    const shift = p.odometry.perM * pathAt(ms);
    const b = rad(p.odometry.bearingDeg);
    return {
      yaw,
      point: (o: readonly number[]): Vector3 => {
        const r = rotY(yaw, o);
        return [r[0] + shift * Math.cos(b), r[1], r[2] + shift * Math.sin(b)];
      },
    };
  };
  const measuredPose = (truePose: Pose, ms: number): Pose => {
    const d = drift(ms);
    return {
      position: nueToWebxr(d.point(webxrToNUE(truePose.position))),
      rotation: mulQuat(yawQuat(d.yaw), truePose.rotation),
    };
  };

  // GPS error per fix.
  let gmN = 0;
  let gmE = 0;
  let fixNo = 0;
  const gpsError = (dtS: number): [number, number, number] => {
    const m = p.gps;
    if (m.kind === "series") {
      const e = m.errors[fixNo % m.errors.length]!;
      fixNo += 1;
      return [e[0], e[1], e[2]];
    }
    fixNo += 1;
    const phi = m.wanderTauS > 0 ? Math.exp(-dtS / m.wanderTauS) : 0;
    const k = m.wanderM * Math.sqrt(1 - phi * phi);
    gmN = phi * gmN + k * g();
    gmE = phi * gmE + k * g();
    const b = rad(m.biasBearingDeg);
    return [
      m.biasM * Math.cos(b) + gmN + m.whiteM * g(),
      m.biasM * Math.sin(b) + gmE + m.whiteM * g(),
      m.accuracyM,
    ];
  };

  const events: ReplayEvent[] = [];
  let zeroSet = false;
  const fixAt = (ms: number): void => {
    const s = (ms - scanMs) / 1000;
    const [n, e] = walkAt(p, s);
    const world: Vector3 = [n, PHONE_UP, e];
    const [errN, errE, acc] = gpsError(1);
    const ll = calcGpsCoords(SCENARIO_ZERO, [
      world[0] + errN,
      world[1],
      world[2] + errE,
    ]);
    if (!zeroSet) {
      events.push({ kind: "zero", zero: ll }, { kind: "entry" });
      zeroSet = true;
    }
    const d = drift(ms);
    const payload: RecordGpsEventPayload = {
      odomPosition: nueToWebxr(d.point(odomFromWorld(world))),
      odomRotation: yawQuat(d.yaw),
      rawGpsPoint: {
        id: `gps-${String(fixNo)}`,
        latitude: ll.lat,
        longitude: ll.lon,
        altitude: world[1],
        latLongAccuracy: acc,
        timestamp: ms,
      },
    };
    events.push({ kind: "fix", arrivalMs: ms + 150, payload });
  };

  for (let ms = EPOCH_MS; ms < scanStartMs; ms += 1000) fixAt(ms);
  for (let i = 0; i < LOCKS; i += 1) {
    const at = scanStartMs + i * LOCK_INTERVAL_MS;
    const pose = measuredPose(SCENARIO_CODE_POSE, at);
    events.push({
      kind: "lock",
      text: SCENARIO_CODE_TEXT,
      atMs: at,
      detectionPose: pose,
      voted: { pose, geo: SCENARIO_CODE_GEO, sizeM: SIZE_M, stampMs: at },
    });
  }
  const endMs = scanMs + p.afterS * 1000;
  for (
    let ms = EPOCH_MS + Math.ceil((scanMs - EPOCH_MS) / 1000) * 1000;
    ms <= endMs;
    ms += 1000
  ) {
    fixAt(ms);
  }
  return {
    events,
    zero: (events[0] as { zero: LatLong }).zero,
    scanMs,
    freshPoseAt: (ms) => measuredPose(SCENARIO_CODE_POSE, ms),
    pathAt,
    reachAt: (ms) => {
      const [n, e] = walkAt(p, sAfter(ms));
      return Math.hypot(n - CODE_WORLD[0], e - CODE_WORLD[2]);
    },
  };
}
