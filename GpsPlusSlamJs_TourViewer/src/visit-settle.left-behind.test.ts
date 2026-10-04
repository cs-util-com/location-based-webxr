/**
 * The authoring settle for objects LEFT BEHIND in a long visit (authoring
 * plan 2026-09-28-0953 §3.2, D10b; the Recorder's D28 revised as the
 * analogue).
 *
 * Why this file matters: the settle (`visit-settle.ts`) recomputes the geo
 * of the code measured in a visit AND of every note placed in it through ONE
 * alignment: the visit's alignment at its end, or, when the visit saw a
 * stored code, that alignment corrected through the code (D10b). The
 * Recorder's mint showed that composing through the END alignment regresses
 * an object seen early and then walked away from, because SLAM drift after
 * the object is folded into it (8.6 m at 500 m and 1 % / 1 degree per
 * 100 m; fixed there by "the first mature alignment after the last sighting,
 * 80 m of GPS extent"). This file asks the same question of the settle, at
 * the settle's own seam: the REAL store and solver of the published
 * `gps-plus-slam-js` (nothing about the solve is mocked) and the real
 * `planVisitSettle`, fed the way `creator-setup.ts` feeds it.
 *
 * ONE AUTHORING VISIT, deterministic per seed (the Recorder sweep's
 * scenario and its drift model, `integrated-slam-drift.ts`, shared):
 * - the author stands 2 m in front of the code and looks at it (4 s, the
 *   entry hint), then walks two 60 m out-and-back lines from that stand
 *   (within 60 degrees of the face normal), each followed by a 4 s look;
 * - at the end of the third look the code is MEASURED (when the tour has
 *   no stored code) and a pin is placed 4 m from the stand on the floor;
 * - then the author walks `L` m away (straight, 50 m legs turning up to 60
 *   degrees, or out and back to the stand; out and back ends with a 4 s
 *   look at the code) and the visit ends there, which is when it settles;
 * - odometry: an arbitrary yaw and origin, plus SLAM drift INTEGRATED along
 *   the walk (yaw `yawDegPer100m`, translation `transPct` % of the distance
 *   in one random direction);
 * - GPS at 1 Hz, accuracy 5 m: Gauss-Markov wander 0.25 x accuracy over 60
 *   s plus white noise 0.15 x accuracy (the Recorder sweep's model);
 * - each look's code pose carries a systematic yaw error (2 degrees sigma)
 *   and 2 cm of position noise.
 *
 * Default run: the fixture is sound (exact inputs recover the code and the
 * pin through the settle). The sweep is opt-in:
 * `VISIT_SETTLE_LEFT_BEHIND_SWEEP=1` (seeds per cell in
 * `VISIT_SETTLE_LEFT_BEHIND_SEEDS`, default 30; the table goes to the file
 * `VISIT_SETTLE_LEFT_BEHIND_OUT` names, else the console).
 *
 * WHAT SHIPS (D33 settle, D34 floor of 40 m; re-measured 2026-10-04, same
 * grid, 30 visits per cell; the SHIPPED columns run `visit-alignment-picks.ts`
 * and `planVisitSettle` with its picks, fed as `creator-setup.ts` feeds
 * them, at the shared `MATURE_GPS_EXTENT_M`):
 * - Note and code measured mid-visit: SHIPPED equals m40 in every row of
 *   every cell (288 rows; it is m40, through the real tracker): notes
 *   1.0-1.4 m p50, 1.6-2.8 m p90 (at 80 m, D33 as first shipped: 1.1-1.7 /
 *   1.8-3.8); 500 m at 1 deg / 1 %: 1.0 / 1.6 m against 8.4 / 11.2 m through
 *   the end alignment, and 1.1 / 1.7 m against 15.8 / 24.5 m on a 500 m
 *   meander at 2 / 2.
 * - THE NUMBER TO WATCH (D34): a code measured mid-visit keeps 1.0-1.5 /
 *   1.7-2.8 m, but its heading p90 is 4.3-6.8 degrees at 40 m against
 *   3.8-5.6 at 80 m; the worst cells are 2 % translation drift (6.8 degrees
 *   at 0.5 deg / 2 %, 6.7 on a 500 m meander at 2 / 2; p50 2.5-2.6). The
 *   sweep on real recordings is the check on it.
 * - Code measured at the visit's START (R4 of the D33 review): 1.2-2.3 /
 *   1.9-3.6 m, heading p90 3.8-6.9 degrees. 40 m fixes the case 80 m lost
 *   (120 m walks at 2 / 2: 1.6 / 2.7 m against 5.3 / 7.6 m), and on a
 *   100 m out and back it is 2.3 / 3.1 m against the end alignment's
 *   4.0 / 6.2 m.
 * - Short visits: the 80 m floor's known limit is gone. 100 m out and back,
 *   note: SHIPPED = m40 = 1.0-1.1 / 1.6-1.7 m, where 80 m and the end
 *   alignment gave 1.2-1.7 / 2.6-3.8 m.
 * - Stored code (D10b, sighted at the first look and, out and back, at the
 *   last): unchanged by D34 in every cell (the correction does not depend on
 *   the alignment it starts from, and the bound refuses nothing at either
 *   floor). The correction goes through the sighting NEAREST the pin, so an
 *   out-and-back start note keeps the start sighting's 1.2-2.5 m (500 m,
 *   1 / 1: 1.2 / 1.5 m against 11.2 / 15.2 m through the latest; 2 / 2:
 *   2.5 / 2.8 m against 22.5 / 30.4 m). The bound, judged through the
 *   sighting's own alignment, refuses nothing in any cell (the end
 *   alignment refused 1 / 2 / 5 of 30 on the 500 m meanders at 2 deg). A
 *   refusal is counted from the basis, so a silent fallback could not hide.
 *   Where the start sighting is the only one (straight and meander leaves),
 *   SHIPPED equals the end-alignment path by construction, and what is left
 *   is the drift between the sighting and the tap (5.2 / 6.6 m after 240 m
 *   of walks at 2 / 2, the worst cell).
 * - "grown80" (the other reading of D33: the extent GROWN by 80 m since the
 *   placement) is no better than m80: 0.9-1.7 / 1.8-3.8 m, with p90 up to
 *   3.0-3.3 m where m80 has 2.1-2.7.
 *
 * Measured result BEFORE D33 (2026-10-03, 30 visits per cell, horizontal
 * p50 / p90; "end" = what shipped then, "tap" = the alignment at the tap,
 * "m40"/"m80" = the first alignment at or after the tap whose session GPS
 * extent reaches 40 / 80 m, else the end one):
 * - NO STORED CODE, the note: the shipped settle regresses a note left
 *   behind exactly as the Recorder's save-time mint did. 500 m straight:
 *   2.5 / 3.8 m at 0.5 deg / 0.5 %, 8.4 / 11.2 m at 1 deg / 1 %, 18.1 /
 *   20.8 m at 2 deg / 2 %; 300 m: 1.3-3.6 m p50 (8.4 at 2 deg / 2 % out
 *   and back). Out and back is the worst path (500 m, 1 deg / 1 %: 10.6 /
 *   16.2 m). At 100 m it is no worse than the rest (1.0-1.7 m). tap, m40
 *   and m80 are flat in L: 1.0-1.4 / 1.6-2.8 m, except m80 on 100 m out
 *   and back (1.2-1.7 / 2.6-3.8 m: 80 m of extent comes only at the end).
 * - A code measured mid-visit regresses the same way (500 m, 1 deg / 1 %:
 *   8.7 m, heading 3.4 / 6.1 deg) and is fixed the same way (m80: 1.2-1.3 m,
 *   heading 1.4-1.6 / 4.6-5.4 deg, the best heading of the candidates; m40
 *   2.5-2.7 deg, tap 2.7-3.0). A code measured at the visit's start: tap is
 *   the immature alignment (85 / 160 deg); m40 / m80 1.2-2.9 m and 2-4 deg;
 *   with 120 m walks m80 matures only after them (2 deg / 2 %: 5.3 m
 *   against 1.6 m for m40).
 * - Walks of 15 m before the pin: tap is immature for heading (5-6 / 12
 *   deg for a code measured then), m80 is not (1.5-2.1 deg).
 * - What the author sees: the rigid preview drifts with the odometry, so at
 *   the end of an out-and-back visit it shows the note where the settle then
 *   puts it (within 1.1-1.5 m p50); after a 500 m straight or meandering
 *   leave the author is far away and the settle lands 6-28 m from where the
 *   drifted preview would be. The stored geo jumps from tap-time to settled
 *   by about the settle's own error (500 m, 1 deg / 1 %: 8.9 m p50).
 * - STORED CODE seen at the visit's start (D10b, the stored pose true): the
 *   correction does not depend on the alignment it starts from, so the note
 *   carries only the drift between the SIGHTING and the tap: flat in L
 *   (0.6 m at 0.5 / 0.5, 1.2 m at 1 / 1, 2.5 m at 2 / 2 after 120 m of
 *   walks; 2.6 / 5.2 m after 240 m). It is the left-behind case again when
 *   the code is seen at the END (out and back): the settle corrects through
 *   the latest sighting, so the note carries the drift between the tap and
 *   that sighting (500 m, 1 / 1: 11.2 / 15.2 m against 1.2 m through the
 *   start sighting). On long meanders at 2 deg per 100 m the plausibility
 *   bound, judged through the END alignment, refuses the start sighting's
 *   correction and the note falls back to the plain end alignment: 500 m
 *   meander, 2 deg per 100 m, in 1 / 2 / 5 of 30 visits at 0.5 / 1 / 2 %
 *   (p90 24.5 m at 2 %); no refusal in any other cell.
 * - Reverses: drift under about 0.5 % and 0.5 deg per 100 m, or a leave
 *   under about 100 m (the settle is then as good as the rest); m80 loses to
 *   m40 when 80 m of extent comes long after the object (a code measured at
 *   the start of long first walks).
 */

import { writeFileSync } from "node:fs";
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
  recordGpsEvent,
  selectAlignmentMatrix,
  selectGpsPositions,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";
import { createGpsExtentTracker } from "gps-plus-slam-app-framework/state/gps-extent-tracker";
import { mintQrLevelFromWorld } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import {
  driftedYaw,
  gaussMarkovGpsErrors,
  gaussian,
  integrateOdometry,
  mulberry32,
  positionOnRoute,
  rotY,
  trackAt,
  type IntegratedDrift,
  type NE,
  type OdomTrack,
  type Waypoint,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";

import { createVisitAlignmentTracker } from "./visit-alignment-picks.js";
import { mintPin } from "./content-placement.js";
import { odomNueFromWebXr } from "./visit-anchoring.js";
import {
  planVisitSettle,
  storedGeo,
  type CodeSighting,
  type VisitSettle,
  type VisitSettleInput,
} from "./visit-settle.js";

// The geodesy is licence-gated; building a store activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

// ---------------------------------------------------------------------------
// Scenario constants (the Recorder sweep's). World frame: NUE metres
// relative to ORIGIN, Up = absolute altitude.
// ---------------------------------------------------------------------------

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const NOW_ISO = new Date(EPOCH_MS).toISOString();
const GROUND_ALT = 400;
const PHONE_ALT = 401.4;
/** Local +X points east, so the printed face looks south (normal 180). */
const CODE_HEADING_DEG = 90;
const CODE_NORMAL_DEG = CODE_HEADING_DEG + 90;
const CODE_WORLD: Vector3 = [0, 401.5, 0];
const CODE_TEXT = "https://example.invalid/?qr=settle-left-behind";
const LEVEL_ID = "5e771ed0be41";
const CODE_SIZE_M = 0.16;
const STAND: NE = [-2, 0];
/** Each out-and-back walk before the pin, unless a cell says otherwise. */
const WALK_M = 60;
const WALK_SPEED_MPS = 1.2;
const LOOK_S = 4;
const ACCURACY_M = 5;
const PIN_FROM_STAND_M = 4;
const LOOK_YAW_NOISE_DEG = 2;
const LOOK_POS_NOISE_M = 0.02;
const IDENTITY_Q: Quaternion = [0, 0, 0, 1];
const INFO = { hasMatrix: true, sampleCount: 100, gpsAccuracyM: ACCURACY_M };

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** Signed angle difference in (-180, 180]. */
const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const yawQuat = (a: number): Quaternion => [
  0,
  Math.sin(a / 2),
  0,
  Math.cos(a / 2),
];
/** Inverse of the library's `webxrToNUE` ([-z, y, x]). */
const nueToWebxr = (v: Vector3): Vector3 => [v[2], v[1], -v[0]];
const stream = (seed: number, purpose: number): (() => number) =>
  mulberry32(seed * 7919 + purpose * 104_729);

// ---------------------------------------------------------------------------
// One authoring visit.
// ---------------------------------------------------------------------------

interface LeaveSpec {
  /** Path length walked after the pin is placed (m). */
  readonly distanceM: number;
  /** Half of it out, then back along the same path to the stand, where the
   *  code is looked at once more before the visit ends. */
  readonly endBack: boolean;
  /** One straight line, or 50 m legs turning by up to 60 degrees each. */
  readonly path: "straight" | "meander";
}

interface VisitSpec {
  readonly seed: number;
  readonly drift: IntegratedDrift;
  readonly leave: LeaveSpec | null;
  /** Length of EACH of the two out-and-back walks before the pin (m);
   *  {@link WALK_M} when absent. */
  readonly walkM?: number;
  /** GPS noise, drift and look noise off: the fixture's sanity inputs. */
  readonly exact?: boolean;
}

interface FixSnapshot {
  readonly tS: number;
  readonly alignment: number[] | null;
  /** The session's GPS extent as the shipped `createGpsExtentTracker`
   *  reads it from the store (what D28's maturity floor reads). */
  readonly extentM: number;
}

interface Visit {
  readonly spec: VisitSpec;
  readonly zero: LatLong;
  readonly fixes: readonly FixSnapshot[];
  readonly waypoints: readonly Waypoint[];
  /** Look windows [from, to] (s); the last is the end-of-visit look of an
   *  out-and-back leave. */
  readonly looks: readonly (readonly [number, number])[];
  /** When the code is measured and the pin placed (s). */
  readonly placedS: number;
  readonly endS: number;
  readonly pinWorld: Vector3;
  readonly frameYaw: (tS: number) => number;
  readonly track: OdomTrack;
}

function timeline(spec: VisitSpec): {
  waypoints: Waypoint[];
  looks: [number, number][];
  placedS: number;
  endS: number;
} {
  const rng = stream(spec.seed, 1);
  const waypoints: Waypoint[] = [{ tS: 0, at: STAND, walkedM: 0 }];
  const looks: [number, number][] = [[0.5, 0.5 + LOOK_S]];
  let t = 0.5 + LOOK_S + 0.5;
  let walked = 0;
  waypoints.push({ tS: t, at: STAND, walkedM: walked });
  for (let walk = 0; walk < 2; walk += 1) {
    const phi = rad(CODE_NORMAL_DEG + (rng() * 120 - 60));
    const half = (spec.walkM ?? WALK_M) / 2;
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
  const placedS = t - 0.25;
  if (spec.leave === null) return { waypoints, looks, placedS, endS: t };
  t = appendLeave(spec.seed, spec.leave, waypoints, t, walked);
  if (spec.leave.endBack) {
    looks.push([t + 0.5, t + 0.5 + LOOK_S]);
    t += 0.5 + LOOK_S + 0.5;
    waypoints.push({ tS: t, at: STAND, walkedM: waypoints.at(-1)!.walkedM });
  }
  return { waypoints, looks, placedS, endS: t };
}

/** The walk away from the stand after the pin; returns the end time. Its
 *  own random stream, so the walks before it are unchanged. */
function appendLeave(
  seed: number,
  leave: LeaveSpec,
  waypoints: Waypoint[],
  startS: number,
  startWalkedM: number,
): number {
  const rng = stream(seed, 6);
  const legM = leave.path === "straight" ? Infinity : 50;
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

/** The odometry NUE of a world point as the phone sees it at `tS`: relative
 *  to the phone, in the frame as it is at that moment, on top of the
 *  phone's own integrated (drifted) odometry. */
function odomNueAt(visit: Visit, world: Vector3, tS: number): Vector3 {
  const phone = positionOnRoute(visit.waypoints, tS).at;
  const o = trackAt(visit.track, tS);
  const rel = rotY(-visit.frameYaw(tS), [
    world[0] - phone[0],
    world[1] - PHONE_ALT,
    world[2] - phone[1],
  ]);
  return [o[0] + rel[0], o[1] + rel[1], o[2] + rel[2]];
}

/** The inverse of {@link odomNueAt}, horizontally: the world spot (North,
 *  East) the phone shows odometry point `local` at, at `tS`. */
function previewWorldAt(visit: Visit, local: Vector3, tS: number): NE {
  const phone = positionOnRoute(visit.waypoints, tS).at;
  const o = trackAt(visit.track, tS);
  const rel = rotY(visit.frameYaw(tS), [local[0] - o[0], 0, local[2] - o[2]]);
  return [phone[0] + rel[0], phone[1] + rel[2]];
}

/** Run the visit's GPS through the real store; snapshot after each fix. */
function runVisit(spec: VisitSpec): Visit {
  const { waypoints, looks, placedS, endS } = timeline(spec);
  const rng = stream(spec.seed, 3);
  const yaw0 = rng() * 2 * Math.PI;
  const t0: Vector3 = [
    STAND[0] + gaussian(rng) * 0.3,
    GROUND_ALT,
    STAND[1] + gaussian(rng) * 0.3,
  ];
  const yawSign = rng() < 0.5 ? -1 : 1;
  const pinRng = stream(spec.seed, 7);
  const pinBearing = rad(CODE_NORMAL_DEG + (pinRng() * 120 - 60));
  const pinWorld: Vector3 = [
    STAND[0] + PIN_FROM_STAND_M * Math.cos(pinBearing),
    GROUND_ALT,
    STAND[1] + PIN_FROM_STAND_M * Math.sin(pinBearing),
  ];
  const exact = spec.exact === true;
  const frameYaw = (tS: number): number =>
    exact
      ? yaw0
      : driftedYaw(
          yaw0,
          yawSign,
          spec.drift.yawDegPer100m,
          positionOnRoute(waypoints, tS).walkedM,
        );
  const startNe = positionOnRoute(waypoints, 0).at;
  const track = integrateOdometry({
    waypoints,
    endS,
    start: rotY(-frameYaw(0), [
      startNe[0] - t0[0],
      PHONE_ALT - t0[1],
      startNe[1] - t0[2],
    ]),
    frameYawAt: frameYaw,
    biasDirRad: stream(spec.seed, 5)() * 2 * Math.PI,
    transPct: exact ? 0 : spec.drift.transPct,
  });
  const partial = {
    spec,
    waypoints,
    looks,
    placedS,
    endS,
    pinWorld,
    frameYaw,
    track,
  };
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    // The dev middlewares re-walk the growing GPS slice on every fix and
    // only cost time here; the reducers and the solver are the same.
    enableDevChecks: false,
  });
  const count = Math.floor(endS) + 1;
  const errors: NE[] = exact
    ? Array.from({ length: count }, () => [0, 0])
    : gaussMarkovGpsErrors(stream(spec.seed, 2), count, ACCURACY_M);
  const extent = createGpsExtentTracker();
  const fixes: FixSnapshot[] = [];
  let zero: LatLong | null = null;
  errors.forEach((err, i) => {
    const pos = positionOnRoute(waypoints, i).at;
    const truth: Vector3 = [pos[0], PHONE_ALT, pos[1]];
    const measured: Vector3 = [truth[0] + err[0], truth[1], truth[2] + err[1]];
    const ll = calcGpsCoords(ORIGIN, measured);
    if (zero === null) {
      zero = ll;
      store.dispatch(setZeroPos(ll));
    }
    store.dispatch(
      recordGpsEvent({
        odomPosition: nueToWebxr(
          odomNueAt({ ...partial, zero: ll, fixes: [] }, truth, i),
        ),
        odomRotation: IDENTITY_Q,
        rawGpsPoint: {
          id: `gps-${String(i)}`,
          latitude: ll.lat,
          longitude: ll.lon,
          altitude: measured[1],
          latLongAccuracy: ACCURACY_M,
          timestamp: EPOCH_MS + i * 1000,
        },
      }),
    );
    const a = selectAlignmentMatrix(store.getState());
    fixes.push({
      tS: i,
      alignment: a === null ? null : Array.from(a),
      extentM: extent.update(selectGpsPositions(store.getState())),
    });
  });
  if (zero === null) throw new Error("a visit needs at least one fix");
  return { ...partial, zero, fixes };
}

/** The code's stable fused pose at the end of look `look` (raw WebXR): a
 *  systematic yaw error per look and a little position noise. */
function codeSeenAt(visit: Visit, look: number): Pose {
  const window = visit.looks[look];
  if (window === undefined) throw new Error(`no look ${String(look)}`);
  const tS = window[1];
  const exact = visit.spec.exact === true;
  const rng = stream(visit.spec.seed * 31 + look, 4);
  const yawErr = exact ? 0 : LOOK_YAW_NOISE_DEG * gaussian(rng);
  const posErr = exact ? 0 : LOOK_POS_NOISE_M;
  const p = nueToWebxr(odomNueAt(visit, CODE_WORLD, tS));
  return {
    position: [
      p[0] + posErr * gaussian(rng),
      p[1],
      p[2] + posErr * gaussian(rng),
    ],
    rotation: yawQuat(
      Math.PI / 2 - visit.frameYaw(tS) - rad(CODE_HEADING_DEG) + rad(yawErr),
    ),
  };
}

// ---------------------------------------------------------------------------
// The alignments the candidates settle through.
// ---------------------------------------------------------------------------

function endAlignment(visit: Visit): number[] {
  const last = visit.fixes.at(-1)?.alignment;
  if (last === undefined || last === null) {
    throw new Error("the visit never solved an alignment");
  }
  return last;
}

/** The alignment as it stood at `tS` (the newest fix at or before it). */
function alignmentAt(visit: Visit, tS: number): number[] {
  let found: number[] | null = null;
  for (const fix of visit.fixes) {
    if (fix.tS > tS) break;
    if (fix.alignment !== null) found = fix.alignment;
  }
  if (found === null) throw new Error(`no alignment by ${String(tS)} s`);
  return found;
}

/** D28's rule moved to the settle: the first alignment at or after `tS`
 *  whose session GPS extent reaches `floorM`, else the end-of-visit one. */
function matureAfter(visit: Visit, tS: number, floorM: number): number[] {
  const from = Math.floor(tS);
  const found = visit.fixes.find(
    (f) => f.tS >= from && f.alignment !== null && f.extentM >= floorM,
  );
  return found?.alignment ?? endAlignment(visit);
}

// ---------------------------------------------------------------------------
// The settle, fed the way `creator-setup.ts` feeds it.
// ---------------------------------------------------------------------------

/** The pin as placed: its odometry pose, and its tap-time geo through the
 *  alignment of that moment (the reticle's world position). */
function placedPin(visit: Visit): VisitSettleInput["placed"][number] {
  const local = odomNueAt(visit, visit.pinWorld, visit.placedS);
  const tapAlignment = alignmentAt(visit, visit.placedS);
  const world = settleThrough(visit, tapAlignment, null, null, local);
  return {
    object: world.pin!,
    placement: {
      visit: 0,
      local: { position: local, rotation: [0, 0, 0, 1] },
    },
  };
}

/** The true code as a stored level (the reference a D10b visit corrects
 *  onto): the code's real pose minted against this visit's zero. */
function storedTrueLevel(visit: Visit): { id: string; json: string } {
  const codeLl = calcGpsCoords(ORIGIN, CODE_WORLD);
  const nue = calcRelativeCoordsInMeters(visit.zero, codeLl, CODE_WORLD[1], 0);
  const rotation = odomNueFromWebXr({
    position: [0, 0, 0],
    rotation: yawQuat(Math.PI / 2 - rad(CODE_HEADING_DEG)),
  }).rotation;
  const result = mintQrLevelFromWorld({
    world: {
      position: { x: nue[0], y: nue[1], z: nue[2] },
      rotation: [...rotation],
    },
    zero: visit.zero,
    alignment: INFO,
    sizeM: CODE_SIZE_M,
    nowIso: NOW_ISO,
  });
  if (!result.ok) throw new Error(result.error);
  return { id: LEVEL_ID, json: result.json };
}

/** The settle's `placed` entry for a pin at odometry `pinLocal` (its
 *  tap-time geo is irrelevant: the settle recomputes it). */
function pinEntry(
  visit: Visit,
  pinLocal: Vector3 | null,
): VisitSettleInput["placed"] {
  const pinTap =
    pinLocal === null
      ? null
      : mintPin({
          id: "pin",
          label: "pin",
          worldNuePosition: { x: 0, y: 0, z: 0 },
          zero: visit.zero,
          nowIso: NOW_ISO,
        });
  if (pinLocal === null || pinTap === null) return [];
  return [
    {
      object: pinTap,
      placement: {
        visit: 0,
        local: { position: pinLocal, rotation: [0, 0, 0, 1] },
      },
    },
  ];
}

/** The settle's code inputs: a code MEASURED in this visit (re-minted by
 *  the settle), or a STORED code and this visit's sighting of it (D10b). */
function codeInputs(
  measuredCode: Pose | null,
  stored: { level: { id: string; json: string }; sighting: Pose } | null,
): Pick<VisitSettleInput, "mintedLevel" | "measurement" | "sighting"> {
  if (stored !== null) {
    return {
      mintedLevel: stored.level,
      measurement: null,
      sighting: {
        text: CODE_TEXT,
        levelId: LEVEL_ID,
        odomPose: stored.sighting,
      },
    };
  }
  if (measuredCode === null) {
    return { mintedLevel: null, measurement: null, sighting: null };
  }
  return {
    // Only its id is read: the settle re-mints the level from the
    // measurement.
    mintedLevel: { id: LEVEL_ID, json: "{}" },
    measurement: {
      levelId: LEVEL_ID,
      text: CODE_TEXT,
      odomPose: measuredCode,
      sizeM: CODE_SIZE_M,
      visit: 0,
    },
    sighting: null,
  };
}

/**
 * `planVisitSettle` through `alignment`, for a pin at odometry `pinLocal`
 * and/or a code measured in this visit at `measuredCode` (or a stored code
 * and its sighting).
 */
function settleThrough(
  visit: Visit,
  alignment: number[],
  measuredCode: Pose | null,
  stored: { level: { id: string; json: string }; sighting: Pose } | null,
  pinLocal: Vector3 | null,
): {
  pin: TourObject | null;
  level: { json: string } | null;
  plan: VisitSettle;
} {
  const plan = planVisitSettle({
    visit: 0,
    placed: pinEntry(visit, pinLocal),
    alignment,
    zero: visit.zero,
    ...codeInputs(measuredCode, stored),
    alignmentInfo: INFO,
    gpsAccuracyM: ACCURACY_M,
    nowIso: NOW_ISO,
  });
  if (plan === null) throw new Error("the settle planned nothing");
  return { pin: plan.objects[0]?.object ?? null, level: plan.level, plan };
}

// ---------------------------------------------------------------------------
// Errors against the truth.
// ---------------------------------------------------------------------------

interface GeoError {
  readonly horizontalM: number;
  readonly headingDeg: number | null;
}

function normalBearingDeg(q: Quaternion): number {
  // +z (out of the printed face) rotated by q, then the bearing of (N, E).
  const [x, y, z, w] = q;
  const nx = 2 * (x * z + w * y);
  const nz = 1 - 2 * (x * x + y * y);
  return deg(Math.atan2(nz, nx));
}

function geoError(
  geo: { lat: number; lon: number; alt: number; rotation?: Quaternion },
  truth: Vector3,
  withHeading: boolean,
): GeoError {
  const nue = calcRelativeCoordsInMeters(
    ORIGIN,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  return {
    horizontalM: Math.hypot(nue[0] - truth[0], nue[2] - truth[2]),
    headingDeg:
      withHeading && geo.rotation !== undefined
        ? Math.abs(wrapDeg(normalBearingDeg(geo.rotation) - CODE_NORMAL_DEG))
        : null,
  };
}

function pinError(visit: Visit, pin: TourObject | null): GeoError {
  if (pin === null) throw new Error("the settle dropped the pin");
  return geoError(pin.geo, visit.pinWorld, false);
}

function codeError(level: { json: string } | null): GeoError {
  const geo = level === null ? null : storedGeo(level.json);
  if (geo === null) throw new Error("the settle re-minted no code");
  return geoError(geo, CODE_WORLD, true);
}

/** Horizontal distance between two objects' geo (m). */
function geoDistanceM(a: TourObject, b: TourObject): number {
  const pa = calcRelativeCoordsInMeters(ORIGIN, a.geo, a.geo.alt, 0);
  const pb = calcRelativeCoordsInMeters(ORIGIN, b.geo, b.geo.alt, 0);
  return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
}

// ---------------------------------------------------------------------------
// The settle as it ships since D33: the visit replayed through the shipped
// tracker (`visit-alignment-picks.ts`) the way `creator-setup.ts` feeds it
// - each fix's alignment and session extent, and between fixes the moment's
// events - then `planVisitSettle` with its picks.
// ---------------------------------------------------------------------------

/** A sighting of the code (raw WebXR fused pose) as the page keeps it. */
function sightingOf(pose: Pose): CodeSighting {
  return { text: CODE_TEXT, levelId: LEVEL_ID, odomPose: pose };
}

/** The looks a STORED code is sighted at, as in {@link measureVisit}'s
 *  D10b row: the first one (the entry hint), and on an out-and-back leave
 *  the end-of-visit look. The same sightings as the end-alignment columns,
 *  so SHIPPED differs from them by the D33 rule alone. */
function storedSightingLooks(visit: Visit): number[] {
  return visit.spec.leave?.endBack === true ? [0, visit.looks.length - 1] : [0];
}

/**
 * The shipped settle of one visit: the pin placed at `placedS`, the code
 * MEASURED at the end of look `measureLook` (the third when absent), or a
 * STORED code
 * (`stored`) sighted at the end of {@link storedSightingLooks}.
 */
function settleAsShipped(
  visit: Visit,
  options: {
    readonly measured: boolean;
    readonly stored: { id: string; json: string } | null;
    /** The look the code is measured at; the third (2) when absent. */
    readonly measureLook?: number;
  },
): VisitSettle {
  const tracker = createVisitAlignmentTracker();
  const ms = (tS: number): number => Math.round(tS * 1000);
  const events: { tS: number; apply: () => void }[] = [
    {
      tS: visit.placedS,
      apply: () => tracker.notePlacement("pin", ms(visit.placedS)),
    },
  ];
  const measureLook = options.measureLook ?? 2;
  const measureS = visit.looks[measureLook]![1];
  if (options.measured) {
    events.push({
      tS: measureS,
      apply: () => tracker.noteMeasurement(ms(measureS)),
    });
  }
  if (options.stored !== null) {
    for (const look of storedSightingLooks(visit)) {
      const endS = visit.looks[look]![1];
      events.push({
        tS: endS,
        apply: () =>
          tracker.noteSighting(sightingOf(codeSeenAt(visit, look)), ms(endS)),
      });
    }
  }
  events.sort((a, b) => a.tS - b.tS);
  let next = 0;
  for (const fix of visit.fixes) {
    // An event between two fixes happens under the earlier one's alignment.
    while (next < events.length && events[next]!.tS < fix.tS)
      events[next++]!.apply();
    tracker.noteAlignment({
      alignmentMatrix: fix.alignment,
      zero: visit.zero,
      gpsExtentM: fix.extentM,
    });
  }
  while (next < events.length) events[next++]!.apply();
  const pinLocal = odomNueAt(visit, visit.pinWorld, visit.placedS);
  const latestLook = storedSightingLooks(visit).at(-1)!;
  const plan = planVisitSettle({
    visit: 0,
    placed: pinEntry(visit, pinLocal),
    alignment: endAlignment(visit),
    zero: visit.zero,
    ...codeInputs(
      options.measured ? codeSeenAt(visit, measureLook) : null,
      options.stored === null
        ? null
        : { level: options.stored, sighting: codeSeenAt(visit, latestLook) },
    ),
    picks: tracker.picks(),
    alignmentInfo: INFO,
    gpsAccuracyM: ACCURACY_M,
    nowIso: NOW_ISO,
  });
  if (plan === null) throw new Error("the settle planned nothing");
  return plan;
}

/** The pin's settled geo error on the shipped path. */
function shippedPinError(
  visit: Visit,
  stored: { id: string; json: string } | null,
): { error: GeoError; refused: boolean } {
  const plan = settleAsShipped(visit, { measured: false, stored });
  const pin = plan.objects[0];
  // A sighted stored code that did not correct the pin was refused. Read
  // from the basis (the pin's own, else the plan's), so a planner without
  // per-object choices is counted the same way, never as "no refusal".
  const basis = (pin as { basis?: string } | undefined)?.basis ?? plan.basis;
  return {
    error: pinError(visit, pin?.object ?? null),
    refused: stored !== null && basis !== "code-corrected",
  };
}

/** The first alignment at or after `tS` whose session extent has GROWN by
 *  `floorM` since `tS`, else the end one: the other reading of D33
 *  ("80 m after its placement"), measured for comparison only. */
function grownAfter(visit: Visit, tS: number, floorM: number): number[] {
  const from = Math.floor(tS);
  const atPlacement =
    [...visit.fixes].reverse().find((f) => f.tS <= tS)?.extentM ?? 0;
  const found = visit.fixes.find(
    (f) =>
      f.tS >= from && f.alignment !== null && f.extentM >= atPlacement + floorM,
  );
  return found?.alignment ?? endAlignment(visit);
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

// ---------------------------------------------------------------------------
// Always-run: the fixture is sound.
// ---------------------------------------------------------------------------

describe("left-behind settle fixture: the conventions are sound", () => {
  // Why this test matters: every number of the sweep rests on this file's
  // frame conventions and on feeding `planVisitSettle` the way the page
  // does. With exact inputs (no GPS noise, no drift, no look noise) the
  // settle must recover the code, the pin, and - through a stored true
  // code (D10b) - the pin again; a wrong sign or basis factor would put
  // them metres or tens of degrees off.
  it("recovers the code and the pin through the settle with exact inputs", () => {
    const visit = runVisit({
      seed: 3,
      drift: { yawDegPer100m: 0, transPct: 0 },
      leave: { distanceM: 100, endBack: false, path: "straight" },
      exact: true,
    });
    const pinLocal = placedPin(visit).placement!.local.position;
    const measured = settleThrough(
      visit,
      endAlignment(visit),
      codeSeenAt(visit, 2),
      null,
      pinLocal,
    );
    expect(measured.plan.basis).toBe("measured-here");
    const code = codeError(measured.level);
    expect(code.horizontalM).toBeLessThan(0.5);
    expect(code.headingDeg!).toBeLessThan(1);
    expect(pinError(visit, measured.pin).horizontalM).toBeLessThan(0.5);

    const stored = storedTrueLevel(visit);
    const storedErr = geoError(storedGeo(stored.json)!, CODE_WORLD, true);
    expect(storedErr.horizontalM).toBeLessThan(0.01);
    expect(storedErr.headingDeg!).toBeLessThan(0.01);
    const corrected = settleThrough(
      visit,
      endAlignment(visit),
      null,
      { level: stored, sighting: codeSeenAt(visit, 0) },
      pinLocal,
    );
    expect(corrected.plan.basis).toBe("code-corrected");
    expect(pinError(visit, corrected.pin).horizontalM).toBeLessThan(0.5);
  });

  // Why this test matters: the sweep's "preview@end" column reads where
  // the rigid preview shows the pin through `previewWorldAt`, the inverse
  // of the odometry model. On a DRIFTING visit, at the tap itself, the
  // preview must sit exactly on the placed spot; at the end it must not.
  it("shows the rigid preview on the placed spot at the tap, and drifted at the end", () => {
    const visit = runVisit({
      seed: 4,
      drift: { yawDegPer100m: 2, transPct: 2 },
      leave: { distanceM: 300, endBack: false, path: "straight" },
    });
    const local = placedPin(visit).placement!.local.position;
    const atTap = previewWorldAt(visit, local, visit.placedS);
    expect(atTap[0]).toBeCloseTo(visit.pinWorld[0], 6);
    expect(atTap[1]).toBeCloseTo(visit.pinWorld[2], 6);
    const atEnd = previewWorldAt(visit, local, visit.endS);
    expect(
      Math.hypot(atEnd[0] - visit.pinWorld[0], atEnd[1] - visit.pinWorld[2]),
    ).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Always-run: the shipped settle at a few cells of the sweep (D33).
// ---------------------------------------------------------------------------

/** Seeds per default cell: enough for a median, cheap enough for the gate. */
const DEFAULT_SEEDS = [401, 402, 403, 404, 405];

/**
 * Meander seeds (500 m, 2 % / 2 deg per 100 m) whose correction the bound
 * refuses when judged through the drifted END alignment: 8 of seeds
 * 401-460 (405, 413, 420, 423, 427, 438, 449, 458; a one-off search with
 * this file's fixture, 2026-10-03), three of them here with one that is
 * never refused (401).
 */
const MEANDER_REFUSAL_SEEDS = [401, 405, 413, 420];

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

describe("the shipped settle keeps notes and codes left behind (D33)", () => {
  // Why these tests matter: they are the sweep's three findings as
  // assertions on the path that ships. Each cell also runs the settle
  // through the END alignment (the path before D33) and asserts that it
  // fails there, so the cell provably measures the regression it guards.
  it(
    "places a note and a measured code left 500 m behind (1 % / 1 deg per 100 m) within about 2 m, where the end alignment is 8 m off",
    () => {
      const drift = { yawDegPer100m: 1, transPct: 1 };
      const leave = {
        distanceM: 500,
        endBack: false,
        path: "straight",
      } as const;
      const shipped: number[] = [];
      const shippedCode: number[] = [];
      const atEnd: number[] = [];
      for (const seed of DEFAULT_SEEDS) {
        const visit = runVisit({ seed, drift, leave });
        shipped.push(shippedPinError(visit, null).error.horizontalM);
        const measured = settleAsShipped(visit, {
          measured: true,
          stored: null,
        });
        shippedCode.push(codeError(measured.level).horizontalM);
        const pinLocal = odomNueAt(visit, visit.pinWorld, visit.placedS);
        atEnd.push(
          pinError(
            visit,
            settleThrough(visit, endAlignment(visit), null, null, pinLocal).pin,
          ).horizontalM,
        );
      }
      expect(median(atEnd)).toBeGreaterThan(5);
      expect(median(shipped)).toBeLessThan(2);
      expect(Math.max(...shipped)).toBeLessThan(3.5);
      expect(median(shippedCode)).toBeLessThan(2.5);
    },
    10 * 60_000,
  );

  it(
    "keeps the start note of a 500 m out-and-back within about 2 m when the stored code is seen again at the end, where the latest sighting puts it 11 m off",
    () => {
      const drift = { yawDegPer100m: 1, transPct: 1 };
      const leave = {
        distanceM: 500,
        endBack: true,
        path: "straight",
      } as const;
      const shipped: number[] = [];
      const latest: number[] = [];
      for (const seed of DEFAULT_SEEDS) {
        const visit = runVisit({ seed, drift, leave });
        const stored = storedTrueLevel(visit);
        shipped.push(shippedPinError(visit, stored).error.horizontalM);
        const pinLocal = odomNueAt(visit, visit.pinWorld, visit.placedS);
        latest.push(
          pinError(
            visit,
            settleThrough(
              visit,
              endAlignment(visit),
              null,
              { level: stored, sighting: codeSeenAt(visit, 3) },
              pinLocal,
            ).pin,
          ).horizontalM,
        );
      }
      expect(median(latest)).toBeGreaterThan(5);
      expect(median(shipped)).toBeLessThan(2);
    },
    10 * 60_000,
  );

  it(
    "never refuses a correct stored code on a long meander (500 m, 2 % / 2 deg per 100 m), which the drifted end alignment does",
    () => {
      const drift = { yawDegPer100m: 2, transPct: 2 };
      const leave = {
        distanceM: 500,
        endBack: false,
        path: "meander",
      } as const;
      let refusedShipped = 0;
      let refusedAtEnd = 0;
      for (const seed of MEANDER_REFUSAL_SEEDS) {
        const visit = runVisit({ seed, drift, leave });
        const stored = storedTrueLevel(visit);
        if (shippedPinError(visit, stored).refused) refusedShipped += 1;
        const pinLocal = odomNueAt(visit, visit.pinWorld, visit.placedS);
        const atEnd = settleThrough(
          visit,
          endAlignment(visit),
          null,
          { level: stored, sighting: codeSeenAt(visit, 0) },
          pinLocal,
        );
        if (atEnd.plan.basis !== "code-corrected") refusedAtEnd += 1;
      }
      expect(refusedAtEnd).toBeGreaterThan(0);
      expect(refusedShipped).toBe(0);
    },
    10 * 60_000,
  );
});

// ---------------------------------------------------------------------------
// Opt-in: the sweep.
// ---------------------------------------------------------------------------

interface Column {
  readonly m: number[];
  readonly h: number[];
}

function addTo(cols: Map<string, Column>, name: string, e: GeoError): void {
  const c = cols.get(name) ?? { m: [], h: [] };
  c.m.push(e.horizontalM);
  if (e.headingDeg !== null) c.h.push(e.headingDeg);
  cols.set(name, c);
}

function addDistance(cols: Map<string, Column>, name: string, m: number): void {
  addTo(cols, name, { horizontalM: m, headingDeg: null });
}

/** `name p50/p90 m [p50/p90 deg]` per column. */
function formatColumns(cols: ReadonlyMap<string, Column>): string {
  return [...cols.entries()]
    .map(([name, c]) => {
      const heading =
        c.h.length > 0
          ? ` ${quantile(c.h, 0.5).toFixed(1)}/${quantile(c.h, 0.9).toFixed(1)}deg`
          : "";
      return `${name} ${quantile(c.m, 0.5).toFixed(1)}/${quantile(c.m, 0.9).toFixed(1)}m${heading}`;
    })
    .join(" | ");
}

/** Every candidate on one visit, into the four row groups. */
function measureVisit(
  visit: Visit,
  rows: {
    note: Map<string, Column>;
    codeMid: Map<string, Column>;
    codeStart: Map<string, Column>;
    d10b: Map<string, Column>;
    d10bRefused: { count: number };
    d10bShippedRefused: { count: number };
  },
): void {
  const pin = placedPin(visit);
  const pinLocal = pin.placement!.local.position;
  const tP = visit.placedS;
  const end = endAlignment(visit);
  const candidates: [string, (tS: number) => number[]][] = [
    ["settle(end)", () => end],
    ["at-tap", (tS) => alignmentAt(visit, tS)],
    ["mature40", (tS) => matureAfter(visit, tS, 40)],
    ["mature80", (tS) => matureAfter(visit, tS, 80)],
    ["grown80", (tS) => grownAfter(visit, tS, 80)],
  ];

  // No stored code: the note settles through the visit's alignment (the
  // same whether the visit measured the code or saw none).
  const codeMid = codeSeenAt(visit, 2);
  const codeStart = codeSeenAt(visit, 0);
  for (const [name, pick] of candidates) {
    const n = settleThrough(visit, pick(tP), null, null, pinLocal);
    addTo(rows.note, name, pinError(visit, n.pin));
    const cm = settleThrough(
      visit,
      pick(visit.looks[2]![1]),
      codeMid,
      null,
      null,
    );
    addTo(rows.codeMid, name, codeError(cm.level));
    const cs = settleThrough(
      visit,
      pick(visit.looks[0]![1]),
      codeStart,
      null,
      null,
    );
    addTo(rows.codeStart, name, codeError(cs.level));
  }
  // What ships (D33): the tracker and the planner with its picks.
  addTo(rows.note, "SHIPPED", shippedPinError(visit, null).error);
  addTo(
    rows.codeMid,
    "SHIPPED",
    codeError(settleAsShipped(visit, { measured: true, stored: null }).level),
  );
  // R4 (D33 review): D34's floor on a code measured at the visit's start.
  addTo(
    rows.codeStart,
    "SHIPPED",
    codeError(
      settleAsShipped(visit, { measured: true, stored: null, measureLook: 0 })
        .level,
    ),
  );
  // What the author sees change at the settle: the stored geo moving from
  // the tap-time record to the settled one.
  const settledNote = settleThrough(visit, end, null, null, pinLocal).pin!;
  addDistance(
    rows.note,
    "jump(tap->settle)",
    geoDistanceM(pin.object, settledNote),
  );
  // Where the RIGID preview (decision D2: under the world group at its
  // odometry pose) shows the pin at the visit's end: the odometry drift
  // since the tap carries it along. Against the placed spot, and against the
  // settled geo (how far the settle lands from what the author last saw).
  const previewEnd = previewWorldAt(visit, pinLocal, visit.endS);
  addDistance(
    rows.note,
    "preview@end",
    Math.hypot(
      previewEnd[0] - visit.pinWorld[0],
      previewEnd[1] - visit.pinWorld[2],
    ),
  );
  const settledNue = calcRelativeCoordsInMeters(
    ORIGIN,
    settledNote.geo,
    settledNote.geo.alt,
    0,
  );
  addDistance(
    rows.note,
    "settle-vs-preview@end",
    Math.hypot(settledNue[0] - previewEnd[0], settledNue[2] - previewEnd[1]),
  );

  // A stored code (here: the true pose) seen at the visit's start, and on an
  // out-and-back leave seen again at the end (the settle corrects through
  // the LATEST sighting, `ctx.visitCodeSighting`).
  const stored = storedTrueLevel(visit);
  const latestLook = visit.looks.length - 1 === 3 ? 3 : 0;
  const latest = codeSeenAt(visit, latestLook);
  const settle = settleThrough(
    visit,
    end,
    null,
    { level: stored, sighting: latest },
    pinLocal,
  );
  // What ships, refusals included: the plausibility bound is judged through
  // the END alignment, so a long visit can push the start sighting past it
  // and the note then settles through the plain visit alignment.
  if (settle.plan.basis !== "code-corrected") rows.d10bRefused.count += 1;
  addTo(rows.d10b, "settle(end,latest)", pinError(visit, settle.pin));
  const shipped = shippedPinError(visit, stored);
  if (shipped.refused) rows.d10bShippedRefused.count += 1;
  addTo(rows.d10b, "SHIPPED", shipped.error);
  // The correction does not depend on which yaw-only alignment it starts
  // from (`correctedAlignment`): the tap-time alignment must give the same.
  const atTap = settleThrough(
    visit,
    alignmentAt(visit, tP),
    null,
    { level: stored, sighting: latest },
    pinLocal,
  );
  addTo(rows.d10b, "at-tap(corr,latest)", pinError(visit, atTap.pin));
  if (latestLook === 3) {
    const first = settleThrough(
      visit,
      end,
      null,
      { level: stored, sighting: codeStart },
      pinLocal,
    );
    addTo(rows.d10b, "corr,start-sighting", pinError(visit, first.pin));
  }
  addDistance(
    rows.d10b,
    "jump(tap->settle)",
    geoDistanceM(pin.object, settle.pin!),
  );
}

interface Cell {
  readonly label: string;
  readonly drift: IntegratedDrift;
  readonly leave: LeaveSpec | null;
  readonly walkM?: number;
}

const driftTag = (d: IntegratedDrift): string =>
  `yaw ${String(d.yawDegPer100m)}deg/100m trans ${String(d.transPct)}%`;

/** The sweep grid; every parameter it rests on is in the label. */
function cells(): Cell[] {
  const drifts: IntegratedDrift[] = [];
  for (const yawDegPer100m of [0.5, 1, 2])
    for (const transPct of [0.5, 1, 2])
      drifts.push({ yawDegPer100m, transPct });
  const out: Cell[] = [];
  for (const drift of drifts) {
    out.push({
      label: `L 0 (ends at the pin), ${driftTag(drift)}`,
      drift,
      leave: null,
    });
    for (const distanceM of [100, 200, 300, 500])
      out.push({
        label: `L ${String(distanceM)} straight, ${driftTag(drift)}`,
        drift,
        leave: { distanceM, endBack: false, path: "straight" },
      });
    for (const distanceM of [300, 500])
      out.push({
        label: `L ${String(distanceM)} meander, ${driftTag(drift)}`,
        drift,
        leave: { distanceM, endBack: false, path: "meander" },
      });
    for (const distanceM of [100, 300, 500])
      out.push({
        label: `L ${String(distanceM)} out-and-back, ${driftTag(drift)}`,
        drift,
        leave: { distanceM, endBack: true, path: "straight" },
      });
  }
  // How mature the alignment is when the pin is placed: shorter and longer
  // walks before it (the tap-time candidate rests on this).
  for (const walkM of [15, 30, 120])
    for (const drift of [
      { yawDegPer100m: 1, transPct: 1 },
      { yawDegPer100m: 2, transPct: 2 },
    ])
      out.push({
        label: `walks ${String(walkM)} m before the pin, L 300 straight, ${driftTag(drift)}`,
        drift,
        walkM,
        leave: { distanceM: 300, endBack: false, path: "straight" },
      });
  return out;
}

const SWEEP = process.env["VISIT_SETTLE_LEFT_BEHIND_SWEEP"] === "1";

describe.skipIf(!SWEEP)(
  "sweep: notes and codes left behind in a long authoring visit",
  () => {
    it(
      "measures each candidate settle alignment across leave distance, path and drift",
      () => {
        const seedCount = Number(
          process.env["VISIT_SETTLE_LEFT_BEHIND_SEEDS"] ?? "30",
        );
        const seeds = Array.from({ length: seedCount }, (_, i) => i + 401);
        const lines: string[] = [
          `authoring settle, left behind (${String(seedCount)} visits per cell; two 60 m walks, then the code measured / pin placed, then L m; GPS 5 m; look yaw noise 2 deg): horizontal p50/p90 m, heading p50/p90 deg`,
        ];
        for (const cell of cells()) {
          const rows = {
            note: new Map<string, Column>(),
            codeMid: new Map<string, Column>(),
            codeStart: new Map<string, Column>(),
            d10b: new Map<string, Column>(),
            d10bRefused: { count: 0 },
            d10bShippedRefused: { count: 0 },
          };
          // A visit the settle cannot measure (no
          // alignment) is counted and named, never dropped silently.
          const failed: string[] = [];
          for (const seed of seeds) {
            try {
              measureVisit(
                runVisit({
                  seed,
                  drift: cell.drift,
                  leave: cell.leave,
                  ...(cell.walkM === undefined ? {} : { walkM: cell.walkM }),
                }),
                rows,
              );
            } catch (error) {
              failed.push(`seed ${String(seed)}: ${String(error)}`);
            }
          }
          lines.push(
            failed.length === 0
              ? cell.label
              : `${cell.label} - ${String(failed.length)} visit(s) not measured: ${failed.join("; ")}`,
          );
          lines.push(`  note, no stored code: ${formatColumns(rows.note)}`);
          lines.push(`  code measured mid:    ${formatColumns(rows.codeMid)}`);
          lines.push(
            `  code measured start:  ${formatColumns(rows.codeStart)}`,
          );
          lines.push(
            `  note, stored code (D10b), correction refused in ${String(rows.d10bRefused.count)} (end,latest) / ${String(rows.d10bShippedRefused.count)} (SHIPPED): ${formatColumns(rows.d10b)}`,
          );
        }
        const table = lines.join("\n");
        const out = process.env["VISIT_SETTLE_LEFT_BEHIND_OUT"];
        if (out === undefined) console.log(table);
        else writeFileSync(out, `${table}\n`);
        expect(lines.length).toBeGreaterThan(1);
      },
      120 * 60_000,
    );
  },
);
