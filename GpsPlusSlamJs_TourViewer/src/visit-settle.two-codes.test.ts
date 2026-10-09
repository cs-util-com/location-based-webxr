/**
 * Two codes in one authoring visit (code book refactor plan M3): which code
 * a note placed between them should be settled through, measured against
 * the truth BEFORE any two-code rule ships (plan §4 M3, owner decision D2).
 *
 * Why this file matters: today a visit settles every note through the ONE
 * code in hand (D10b, reach `CODE_EVENT_REACH_M` walked). M4 lets a visit
 * hold several codes, each with its own stored pose, and those poses
 * disagree by their own minting error. A note between two codes can follow
 * the nearer code (D2: nearest code event in walked distance) or a blend of
 * both; and when a later visit IMPROVES one code's position, the objects it
 * takes along (`move-with-code.ts`, today every object within 40 m) can
 * overlap the other code's. This file scores the candidate rules against
 * each note's ground truth, never against their own inputs.
 *
 * THE VISIT (deterministic per seed; the drift and GPS models are the
 * left-behind sweep's, `integrated-slam-drift.ts`):
 * - two codes A and B, `spacingM` apart (B due east of A), both facing
 *   south; the author stands 2 m in front of A, walks two 60 m
 *   out-and-backs (so the alignment matures), looks at A (a sighting),
 *   walks to B's stand - straight, or a U that walks three times the
 *   spacing ("loop") - placing a note 3 m south of the path at each tenth
 *   of the way, and looks at B (a sighting); the visit ends there;
 * - odometry drift integrated along the walk, GPS at 1 Hz through the REAL
 *   store and solver, each look's code pose with 2 degrees of yaw error
 *   and 2 cm of position noise;
 * - the two STORED poses disagree by `disagreeM`: A off by half of it and
 *   B by the other half in the opposite direction, each with 2 degrees of
 *   stored heading error.
 *
 * THE RULES, per note:
 * - `own` - the note's own pick (the first alignment with 40 m of GPS
 *   extent at or after it): no code at all;
 * - `inHand` - what ships: corrected through A, the one code in hand, when
 *   its sighting is within reach and not refused, else `own`;
 * - `nearest` - D2: through the code whose sighting is nearest in walked
 *   distance, among those within reach and not refused, else `own`;
 * - `blend` - the notes through every such code, weighted by the inverse of
 *   their walked distance, else `own`.
 *
 * THE SCORES, horizontal, per note:
 * - `abs` - against the note's true position (what a map, or a viewer
 *   placing by GPS alone, shows);
 * - `rel` - against the true position SHIFTED by the stored error of the
 *   code nearest the note in space: what a visitor anchored at that code
 *   sees, because the viewer puts the code's stored pose on the real code.
 *
 * MOVE WITH CODE: after the visit (notes settled `nearest`), a later visit
 * improves A to within 0.3 m and 0.5 degrees of the truth, and each rule
 * moves the notes: `reach` (what ships: every note within 40 m of A's old
 * pose), `nearestOnly` (only notes nearer A's old pose than B's), `blendMove`
 * (each note by the fraction of A's move its distances give A).
 *
 * The default run checks the fixture's conventions with exact inputs. The
 * sweep is opt-in: `VISIT_SETTLE_TWO_CODES_SWEEP=1` (seeds per cell in
 * `VISIT_SETTLE_TWO_CODES_SEEDS`, default 30; the table goes to the file
 * `VISIT_SETTLE_TWO_CODES_OUT` names, else the console). Its results are in
 * the plan's §12 "M3".
 *
 * MEASURED (2026-10-06, 30 visits per cell, 9 notes each; spacing 10 / 20 /
 * 40 / 80 m, straight and loop, drift 0.5 / 1 / 2 deg and % per 100 m, GPS
 * 3 / 5 / 10 m, reach 20 / 40 / 80 m, disagreement 0 / 2 / 5 / 10 m; p50 /
 * p90 in m):
 * - The two scores pick different winners, in every cell where the codes
 *   disagree. Against the truth (`abs`), `blend` is never worse than
 *   `nearest` at p90 and better in 213 of 288 cells (by up to 1.6 m; up to
 *   2.9 m at p50): averaging two independent stored errors halves them
 *   (20 m straight, 10 m apart: 2.2 / 4.0 against 5.0 / 5.3). Against the
 *   nearest code (`rel`), `nearest` wins at p50 in 135 cells by up to 2.7 m
 *   (0.3 against 2.9); at p90 the two are within 0.3 m (blend ahead in 81
 *   cells, nearest in 9, the rest tied), because the one note halfway
 *   between the codes costs either rule half the disagreement.
 * - Either beats what ships (`inHand`, A only) at `rel` p90 in 246 cells,
 *   by up to 5.6 m: a note next to B corrected through A carries the whole
 *   disagreement (10.3 m p90 at 10 m apart).
 * - At 0-2 m of disagreement every rule is within 0.6 m of the others.
 * - GPS accuracy changes nothing for the corrected rules (the correction
 *   does not depend on the alignment); drift up to 2 / 2 barely does, at
 *   these walks. No cell refused a correction.
 * - The reach: 40 m walked gives the lowest mean `rel` p90 (2.90 m; 20 m:
 *   3.22, 80 m: 2.97).
 * - Move with code: moving every note within 40 m of A (what ships) is the
 *   worst rule wherever B is within reach - it drags B's notes along (10 m
 *   apart, 10 m disagreement: 9.4 / 10.2 m against `nearestOnly`'s 4.8 /
 *   5.4). `nearestOnly` beats it at `rel` p90 in 196 of 288 cells (up to
 *   3.9 m) and never loses; against `blendMove` it is even (82 / 59 cells,
 *   within 1.2 m either way).
 * - What reverses the settle verdict: which score a visitor's view follows.
 *   The viewer adds a scanned code's pose as votes to the GPS solve (about
 *   one fix's weight each), not as a rigid anchor, so a visitor's error lies
 *   between `abs` and `rel` - nearer `rel` right after scanning one code,
 *   nearer a blend after scanning both.
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
import { MATURE_GPS_EXTENT_M } from "gps-plus-slam-app-framework/state/alignment-maturity";
import { createGpsExtentTracker } from "gps-plus-slam-app-framework/state/gps-extent-tracker";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
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

import { moveWithCode, withinCodeReach } from "./move-with-code.js";
import {
  correctedAlignment,
  correctionSize,
  odomNueFromWebXr,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";
import {
  CODE_EVENT_REACH_M,
  CORRECTION_MAX_YAW_DEG,
  correctionBoundM,
} from "./visit-settle.js";

// The geodesy is licence-gated; building a store activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

// ---------------------------------------------------------------------------
// Scenario constants. World frame: NUE metres relative to ORIGIN.
// ---------------------------------------------------------------------------

const ORIGIN: LatLong = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const GROUND_ALT = 400;
const PHONE_ALT = 401.4;
const CODE_ALT = 401.5;
/** Both codes face south: local +X east, the printed face's normal 180. */
const CODE_HEADING_DEG = 90;
const STAND_OFFSET_N = -2;
const PRE_WALK_M = 60;
const WALK_SPEED_MPS = 1.2;
const LOOK_S = 4;
const NOTE_OFFSET_N = -3;
const NOTE_FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const LOOK_YAW_NOISE_DEG = 2;
const LOOK_POS_NOISE_M = 0.02;
const STORED_YAW_NOISE_DEG = 2;
/** How close a later visit brings the improved code (move with code). */
const IMPROVED_POS_M = 0.3;
const IMPROVED_YAW_DEG = 0.5;
const IDENTITY_Q: Quaternion = [0, 0, 0, 1];
const IDENTITY_M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const rad = (d: number): number => (d * Math.PI) / 180;
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
// One visit with two codes.
// ---------------------------------------------------------------------------

type CodeName = "A" | "B";

interface TwoCodeSpec {
  readonly seed: number;
  readonly spacingM: number;
  readonly shape: "straight" | "loop";
  readonly drift: IntegratedDrift;
  readonly accuracyM: number;
  /** GPS noise, drift and look noise off: the fixture's sanity inputs. */
  readonly exact?: boolean;
}

interface Note {
  readonly tS: number;
  /** The path's walked distance at the note (m). */
  readonly walkedM: number;
  /** Its true position, world NUE. */
  readonly world: Vector3;
}

interface Fix {
  readonly tS: number;
  readonly alignment: number[] | null;
  readonly extentM: number;
}

interface TwoCodeVisit {
  readonly spec: TwoCodeSpec;
  readonly waypoints: readonly Waypoint[];
  /** The end of each code's look (its sighting), with the walked distance. */
  readonly sightings: Readonly<
    Record<CodeName, { tS: number; walkedM: number }>
  >;
  readonly notes: readonly Note[];
  readonly frameYaw: (tS: number) => number;
  readonly track: OdomTrack;
  readonly zero: LatLong;
  readonly fixes: readonly Fix[];
}

function codeWorld(spec: TwoCodeSpec, code: CodeName): Vector3 {
  return [0, CODE_ALT, code === "A" ? 0 : spec.spacingM];
}

function standOf(spec: TwoCodeSpec, code: CodeName): NE {
  return [STAND_OFFSET_N, code === "A" ? 0 : spec.spacingM];
}

/** The route from A's stand to B's: a line, or a U three spacings long. */
function pathToB(spec: TwoCodeSpec): NE[] {
  const a = standOf(spec, "A");
  const b = standOf(spec, "B");
  if (spec.shape === "straight") return [a, b];
  const depth = spec.spacingM;
  return [a, [a[0] - depth, a[1]], [b[0] - depth, b[1]], b];
}

function timeline(spec: TwoCodeSpec): {
  waypoints: Waypoint[];
  sightings: Record<CodeName, { tS: number; walkedM: number }>;
  notes: { tS: number; walkedM: number; at: NE }[];
  endS: number;
} {
  const rng = stream(spec.seed, 1);
  const standA = standOf(spec, "A");
  const waypoints: Waypoint[] = [{ tS: 0, at: standA, walkedM: 0 }];
  let t = 0;
  let walked = 0;
  // Two out-and-backs from A's stand, within 60 degrees of its face's
  // normal: the alignment matures before the notes.
  for (let walk = 0; walk < 2; walk += 1) {
    const phi = rad(180 + (rng() * 120 - 60));
    const half = PRE_WALK_M / 2;
    const far: NE = [
      standA[0] + half * Math.cos(phi),
      standA[1] + half * Math.sin(phi),
    ];
    t += half / WALK_SPEED_MPS;
    walked += half;
    waypoints.push({ tS: t, at: far, walkedM: walked });
    t += half / WALK_SPEED_MPS;
    walked += half;
    waypoints.push({ tS: t, at: standA, walkedM: walked });
  }
  // The look at A.
  t += 0.5 + LOOK_S;
  const sightA = { tS: t, walkedM: walked };
  t += 0.5;
  waypoints.push({ tS: t, at: standA, walkedM: walked });
  // The walk to B, the notes along it.
  const path = pathToB(spec);
  const legs = path.slice(1).map((to, i) => {
    const from = path[i]!;
    return { from, to, len: Math.hypot(to[0] - from[0], to[1] - from[1]) };
  });
  const total = legs.reduce((sum, leg) => sum + leg.len, 0);
  const startS = t;
  const startWalked = walked;
  for (const leg of legs) {
    t += leg.len / WALK_SPEED_MPS;
    walked += leg.len;
    waypoints.push({ tS: t, at: leg.to, walkedM: walked });
  }
  const notes = NOTE_FRACTIONS.map((f) => {
    const tS = startS + (f * total) / WALK_SPEED_MPS;
    const on = positionOnRoute(waypoints, tS);
    return {
      tS,
      walkedM: startWalked + f * total,
      at: [on.at[0] + NOTE_OFFSET_N, on.at[1]] as NE,
    };
  });
  // The look at B.
  t += 0.5 + LOOK_S;
  const sightB = { tS: t, walkedM: walked };
  t += 0.5;
  waypoints.push({ tS: t, at: standOf(spec, "B"), walkedM: walked });
  return { waypoints, sightings: { A: sightA, B: sightB }, notes, endS: t };
}

/** The odometry NUE of a world point as the phone sees it at `tS`. */
function odomNueAt(visit: TwoCodeVisit, world: Vector3, tS: number): Vector3 {
  const phone = positionOnRoute(visit.waypoints, tS).at;
  const o = trackAt(visit.track, tS);
  const rel = rotY(-visit.frameYaw(tS), [
    world[0] - phone[0],
    world[1] - PHONE_ALT,
    world[2] - phone[1],
  ]);
  return [o[0] + rel[0], o[1] + rel[1], o[2] + rel[2]];
}

/** Run the visit's GPS through the real store; snapshot after each fix. */
function runVisit(spec: TwoCodeSpec): TwoCodeVisit {
  const { waypoints, sightings, notes, endS } = timeline(spec);
  const rng = stream(spec.seed, 3);
  const yaw0 = rng() * 2 * Math.PI;
  const t0: Vector3 = [
    STAND_OFFSET_N + gaussian(rng) * 0.3,
    GROUND_ALT,
    gaussian(rng) * 0.3,
  ];
  const yawSign = rng() < 0.5 ? -1 : 1;
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
    sightings,
    notes: notes.map((n) => ({
      tS: n.tS,
      walkedM: n.walkedM,
      world: [n.at[0], GROUND_ALT, n.at[1]] as Vector3,
    })),
    frameYaw,
    track,
  };
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    enableDevChecks: false,
  });
  const count = Math.floor(endS) + 1;
  const errors: NE[] = exact
    ? Array.from({ length: count }, () => [0, 0])
    : gaussMarkovGpsErrors(stream(spec.seed, 2), count, spec.accuracyM);
  const extent = createGpsExtentTracker();
  const fixes: Fix[] = [];
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
          latLongAccuracy: spec.accuracyM,
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

/** The code's stable fused pose at the end of its look (raw WebXR). */
function codeSeen(visit: TwoCodeVisit, code: CodeName): Pose {
  const tS = visit.sightings[code].tS;
  const exact = visit.spec.exact === true;
  const rng = stream(visit.spec.seed * 31 + (code === "A" ? 1 : 2), 4);
  const yawErr = exact ? 0 : LOOK_YAW_NOISE_DEG * gaussian(rng);
  const posErr = exact ? 0 : LOOK_POS_NOISE_M;
  const p = nueToWebxr(odomNueAt(visit, codeWorld(visit.spec, code), tS));
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
// Frames: everything the rules compute is GPS-world NUE relative to the
// visit's zero; the truth is relative to ORIGIN.
// ---------------------------------------------------------------------------

function toZero(visit: TwoCodeVisit, world: Vector3): Vector3 {
  const ll = calcGpsCoords(ORIGIN, world);
  const n = calcRelativeCoordsInMeters(visit.zero, ll, world[1], 0);
  return [n[0], n[1], n[2]];
}

function zeroToGeo(visit: TwoCodeVisit, p: Vector3): QrGeoPose {
  const { lat, lon } = calcGpsCoords(visit.zero, p);
  return { lat, lon, alt: p[1], rotation: [0, 0, 0, 1] };
}

function geoToZero(visit: TwoCodeVisit, geo: QrGeoPose): Vector3 {
  const n = calcRelativeCoordsInMeters(visit.zero, geo, geo.alt, 0);
  return [n[0], n[1], n[2]];
}

/** A code pose in world NUE: position and the printed face's rotation. */
function codePoseNue(position: Vector3, headingDeg: number): NuePose {
  return {
    position,
    rotation: odomNueFromWebXr({
      position: [0, 0, 0],
      rotation: yawQuat(Math.PI / 2 - rad(headingDeg)),
    }).rotation,
  };
}

/** The two codes' stored poses (zero frame), `disagreeM` apart beyond the
 *  truth: A off by half, B by half the other way, each with a heading
 *  error; and each one's horizontal stored error (N, E). */
function storedPoses(
  visit: TwoCodeVisit,
  disagreeM: number,
): Record<CodeName, { pose: NuePose; geo: QrGeoPose; errorNe: NE }> {
  const exact = visit.spec.exact === true;
  const rng = stream(visit.spec.seed, 9);
  const dir = rng() * 2 * Math.PI;
  const half = disagreeM / 2;
  const out = {} as Record<
    CodeName,
    { pose: NuePose; geo: QrGeoPose; errorNe: NE }
  >;
  for (const [code, sign] of [
    ["A", 1],
    ["B", -1],
  ] as const) {
    const errorNe: NE = [
      sign * half * Math.cos(dir),
      sign * half * Math.sin(dir),
    ];
    const truth = codeWorld(visit.spec, code);
    const position = toZero(visit, [
      truth[0] + errorNe[0],
      truth[1],
      truth[2] + errorNe[1],
    ]);
    const yawErr = exact ? 0 : STORED_YAW_NOISE_DEG * gaussian(rng);
    const pose = codePoseNue(position, CODE_HEADING_DEG + yawErr);
    out[code] = {
      pose,
      geo: {
        ...zeroToGeo(visit, position),
        rotation: [...pose.rotation] as Quaternion,
      },
      errorNe,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

function endAlignment(visit: TwoCodeVisit): number[] {
  const last = visit.fixes.at(-1)?.alignment;
  if (last === undefined || last === null) {
    throw new Error("the visit never solved an alignment");
  }
  return last;
}

/** The alignment as it stood at `tS` (the newest fix at or before it). */
function alignmentAt(visit: TwoCodeVisit, tS: number): number[] {
  let found: number[] | null = null;
  for (const fix of visit.fixes) {
    if (fix.tS > tS) break;
    if (fix.alignment !== null) found = fix.alignment;
  }
  return found ?? endAlignment(visit);
}

/** The note's own pick: the first alignment at or after it with the
 *  maturity floor of GPS extent, else the end one (D33, D34). */
function ownPick(visit: TwoCodeVisit, tS: number): number[] {
  const from = Math.floor(tS);
  const found = visit.fixes.find(
    (f) =>
      f.tS >= from && f.alignment !== null && f.extentM >= MATURE_GPS_EXTENT_M,
  );
  return found?.alignment ?? endAlignment(visit);
}

const RULES = ["own", "inHand", "nearest", "blend"] as const;
type Rule = (typeof RULES)[number];

interface CodeView {
  /** The visit's alignment corrected through this code. */
  readonly corrected: number[];
  /** The plausibility bound refused the correction (judged through the
   *  alignment at the sighting, as the settle does). */
  readonly refused: boolean;
  readonly walkedM: number;
}

function codeViews(
  visit: TwoCodeVisit,
  stored: ReturnType<typeof storedPoses>,
): Record<CodeName, CodeView> {
  const out = {} as Record<CodeName, CodeView>;
  for (const code of ["A", "B"] as const) {
    const seen = odomNueFromWebXr(codeSeen(visit, code));
    const sighting = visit.sightings[code];
    const corrected = correctedAlignment(IDENTITY_M, seen, stored[code].pose);
    if (corrected === null) throw new Error(`no correction for ${code}`);
    const measured = throughAlignment(seen, alignmentAt(visit, sighting.tS));
    const size =
      measured === null ? null : correctionSize(measured, stored[code].pose);
    const bound = correctionBoundM(visit.spec.accuracyM, visit.spec.accuracyM);
    out[code] = {
      corrected,
      refused:
        size === null ||
        size.horizontalM > bound ||
        size.yawDeg > CORRECTION_MAX_YAW_DEG,
      walkedM: sighting.walkedM,
    };
  }
  return out;
}

function through(local: Vector3, alignment: readonly number[]): Vector3 {
  const p = throughAlignment(
    { position: local, rotation: [0, 0, 0, 1] },
    alignment,
  );
  if (p === null) throw new Error("unreadable alignment");
  return p.position;
}

/** Where `rule` settles `note` (zero frame), within `reachM` walked. */
function settleNote(
  visit: TwoCodeVisit,
  views: Record<CodeName, CodeView>,
  note: Note,
  rule: Rule,
  reachM: number,
): Vector3 {
  const local = odomNueAt(visit, note.world, note.tS);
  const own = (): Vector3 => through(local, ownPick(visit, note.tS));
  const usable = (["A", "B"] as const).filter(
    (c) =>
      (rule !== "inHand" || c === "A") &&
      !views[c].refused &&
      Math.abs(views[c].walkedM - note.walkedM) <= reachM,
  );
  if (rule === "own" || usable.length === 0) return own();
  const gap = (c: CodeName): number =>
    Math.abs(views[c].walkedM - note.walkedM);
  if (rule === "inHand" || rule === "nearest") {
    // A tie goes to the later event (`nearestBy` in `visit-settle.ts`).
    const best = usable.reduce((a, b) => (gap(b) <= gap(a) ? b : a));
    return through(local, views[best].corrected);
  }
  let sum: Vector3 = [0, 0, 0];
  let weights = 0;
  for (const c of usable) {
    const w = 1 / Math.max(gap(c), 1);
    const p = through(local, views[c].corrected);
    sum = [sum[0] + w * p[0], sum[1] + w * p[1], sum[2] + w * p[2]];
    weights += w;
  }
  return [sum[0] / weights, sum[1] / weights, sum[2] / weights];
}

/** How much nearer `world` is to A than to B, horizontally (m). */
function spaceGapM(spec: TwoCodeSpec, world: Vector3): number {
  const d = (c: CodeName): number => {
    const w = codeWorld(spec, c);
    return Math.hypot(w[0] - world[0], w[2] - world[2]);
  };
  return d("B") - d("A");
}

/** The code nearest `world` in space (what a visitor there scans). */
function nearestCodeInSpace(spec: TwoCodeSpec, world: Vector3): CodeName {
  return spaceGapM(spec, world) < 0 ? "B" : "A";
}

interface NoteScore {
  /** Against the truth (m). */
  readonly abs: number;
  /** Against the truth shifted by the nearest code's stored error (m). */
  readonly rel: number;
}

function scoreNote(
  visit: TwoCodeVisit,
  stored: ReturnType<typeof storedPoses>,
  note: Note,
  settled: Vector3,
): NoteScore {
  const truth = toZero(visit, note.world);
  const dn = settled[0] - truth[0];
  const de = settled[2] - truth[2];
  const relTo = (code: CodeName): number =>
    Math.hypot(dn - stored[code].errorNe[0], de - stored[code].errorNe[1]);
  // A note as near one code as the other (within half a metre) is seen
  // from either: a visitor is as likely to anchor at one as at the other.
  const gap = spaceGapM(visit.spec, note.world);
  return {
    abs: Math.hypot(dn, de),
    rel:
      Math.abs(gap) < 0.5
        ? (relTo("A") + relTo("B")) / 2
        : relTo(nearestCodeInSpace(visit.spec, note.world)),
  };
}

// ---------------------------------------------------------------------------
// Move with code: a later visit improves A.
// ---------------------------------------------------------------------------

const MOVE_RULES = ["none", "reach", "nearestOnly", "blendMove"] as const;
type MoveRule = (typeof MOVE_RULES)[number];

function improvedA(visit: TwoCodeVisit): { geo: QrGeoPose; errorNe: NE } {
  const exact = visit.spec.exact === true;
  const rng = stream(visit.spec.seed, 11);
  const dir = rng() * 2 * Math.PI;
  const off = exact ? 0 : IMPROVED_POS_M;
  const errorNe: NE = [off * Math.cos(dir), off * Math.sin(dir)];
  const truth = codeWorld(visit.spec, "A");
  const position = toZero(visit, [
    truth[0] + errorNe[0],
    truth[1],
    truth[2] + errorNe[1],
  ]);
  const yawErr = exact ? 0 : IMPROVED_YAW_DEG * gaussian(rng);
  const pose = codePoseNue(position, CODE_HEADING_DEG + yawErr);
  return {
    geo: {
      ...zeroToGeo(visit, position),
      rotation: [...pose.rotation] as Quaternion,
    },
    errorNe,
  };
}

function horizontalM(visit: TwoCodeVisit, a: QrGeoPose, b: QrGeoPose): number {
  const pa = geoToZero(visit, a);
  const pb = geoToZero(visit, b);
  return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
}

/** A note's geo after A is improved, by `rule`. A pin keeps no rotation
 *  (`creator-settle.ts`: only its position follows). */
function moveNote(
  visit: TwoCodeVisit,
  stored: ReturnType<typeof storedPoses>,
  newA: QrGeoPose,
  note: QrGeoPose,
  rule: MoveRule,
): QrGeoPose {
  const oldA = stored.A.geo;
  const moved = (): QrGeoPose => {
    const m = moveWithCode(note, oldA, newA);
    return { lat: m.lat, lon: m.lon, alt: m.alt, rotation: [0, 0, 0, 1] };
  };
  if (rule === "none") return note;
  if (rule === "reach") return withinCodeReach(note, oldA) ? moved() : note;
  const dA = horizontalM(visit, note, oldA);
  const dB = horizontalM(visit, note, stored.B.geo);
  if (rule === "nearestOnly") {
    return withinCodeReach(note, oldA) && dA <= dB ? moved() : note;
  }
  if (!withinCodeReach(note, oldA)) return note;
  const w = dB / Math.max(dA + dB, 1e-9);
  const from = geoToZero(visit, note);
  const to = geoToZero(visit, moved());
  return zeroToGeo(visit, [
    from[0] + w * (to[0] - from[0]),
    from[1] + w * (to[1] - from[1]),
    from[2] + w * (to[2] - from[2]),
  ]);
}

// ---------------------------------------------------------------------------
// Always-run: the fixture is sound.
// ---------------------------------------------------------------------------

const EXACT_DRIFT: IntegratedDrift = { yawDegPer100m: 0, transPct: 0 };

function exactVisit(spacingM: number, shape: TwoCodeSpec["shape"]) {
  return runVisit({
    seed: 1,
    spacingM,
    shape,
    drift: EXACT_DRIFT,
    accuracyM: 5,
    exact: true,
  });
}

describe("two-code settle fixture: the conventions are sound", () => {
  // Why this test matters: every number of the sweep rests on this file's
  // frames and on feeding the shipped correction (`correctedAlignment`) the
  // way the settle does. With exact inputs and true stored poses every rule
  // must put every note on its true spot; a wrong sign or frame would put
  // them metres off.
  it("recovers every note through every rule with exact inputs and true stored poses", () => {
    for (const shape of ["straight", "loop"] as const) {
      const visit = exactVisit(20, shape);
      const stored = storedPoses(visit, 0);
      const views = codeViews(visit, stored);
      expect(views.A.refused).toBe(false);
      expect(views.B.refused).toBe(false);
      for (const note of visit.notes) {
        for (const rule of RULES) {
          const score = scoreNote(
            visit,
            stored,
            note,
            settleNote(visit, views, note, rule, CODE_EVENT_REACH_M),
          );
          expect(score.abs, `${shape} ${rule}`).toBeLessThan(1e-3);
        }
      }
    }
  });

  // Why this test matters: it pins what each rule MEANS before any number
  // is read. With B stored 4 m off (A true), a note next to B follows B
  // under `nearest` - 4 m off the truth, but exactly where a visitor
  // anchored at B sees it - and a note next to A follows A. `blend` lands
  // in between, and `inHand` (A only, what ships) keeps every note true.
  it("ties a note to the nearer code under nearest, and blends in between", () => {
    const visit = exactVisit(20, "straight");
    // The disagreement is split; shift both so that A stays true.
    const stored = storedPoses(visit, 8);
    const shiftNe: NE = [-stored.A.errorNe[0], -stored.A.errorNe[1]];
    for (const c of ["A", "B"] as const) {
      const truth = codeWorld(visit.spec, c);
      const errorNe: NE = [
        stored[c].errorNe[0] + shiftNe[0],
        stored[c].errorNe[1] + shiftNe[1],
      ];
      const position = toZero(visit, [
        truth[0] + errorNe[0],
        truth[1],
        truth[2] + errorNe[1],
      ]);
      const pose = codePoseNue(position, CODE_HEADING_DEG);
      stored[c] = {
        pose,
        geo: { ...zeroToGeo(visit, position), rotation: pose.rotation },
        errorNe,
      };
    }
    expect(Math.hypot(...stored.A.errorNe)).toBeLessThan(1e-9);
    expect(Math.hypot(...stored.B.errorNe)).toBeCloseTo(8, 6);
    const views = codeViews(visit, stored);
    const nearB = visit.notes.at(-1)!;
    const nearA = visit.notes[0]!;
    const at = (note: Note, rule: Rule) =>
      scoreNote(
        visit,
        stored,
        note,
        settleNote(visit, views, note, rule, CODE_EVENT_REACH_M),
      );
    expect(at(nearB, "nearest").abs).toBeCloseTo(8, 3);
    expect(at(nearB, "nearest").rel).toBeLessThan(1e-3);
    expect(at(nearA, "nearest").abs).toBeLessThan(1e-3);
    expect(at(nearB, "inHand").abs).toBeLessThan(1e-3);
    const blended = at(nearB, "blend").abs;
    expect(blended).toBeGreaterThan(0.5);
    expect(blended).toBeLessThan(8);
  });

  // Why this test matters: the move rules must agree where they should -
  // with true stored poses and an exact improvement nothing moves anywhere
  // - so a difference in the sweep is the rule's, not the fixture's.
  it("moves nothing when the improvement is exact and the poses true", () => {
    const visit = exactVisit(20, "straight");
    const stored = storedPoses(visit, 0);
    const newA = improvedA(visit).geo;
    for (const note of visit.notes) {
      const geo = zeroToGeo(visit, toZero(visit, note.world));
      for (const rule of MOVE_RULES) {
        const moved = moveNote(visit, stored, newA, geo, rule);
        expect(horizontalM(visit, moved, geo), rule).toBeLessThan(1e-3);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Opt-in: the sweep (plan §12 "M3").
// ---------------------------------------------------------------------------

const SWEEP = process.env["VISIT_SETTLE_TWO_CODES_SWEEP"] === "1";
const SEEDS = Number(process.env["VISIT_SETTLE_TWO_CODES_SEEDS"] ?? "30");

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "-");

describe.runIf(SWEEP)("two-code settle sweep", () => {
  it(
    "scores the rules against the truth",
    { timeout: 6 * 60 * 60 * 1000 },
    () => {
      const spacings = [10, 20, 40, 80];
      const disagreements = [0, 2, 5, 10];
      const drifts: IntegratedDrift[] = [
        { yawDegPer100m: 0.5, transPct: 0.5 },
        { yawDegPer100m: 1, transPct: 1 },
        { yawDegPer100m: 2, transPct: 2 },
      ];
      const accuracies = [3, 5, 10];
      const shapes = ["straight", "loop"] as const;
      const reaches = [20, 40, 80];
      const lines: string[] = [
        "settle: spacing shape drift acc reach disagree | rule abs p50/p90 rel p50/p90 | refusals",
      ];
      const moveLines: string[] = [
        "move: spacing shape drift acc disagree | rule abs p50/p90 rel p50/p90",
      ];
      for (const spacingM of spacings) {
        for (const shape of shapes) {
          for (const drift of drifts) {
            for (const accuracyM of accuracies) {
              const visits = Array.from({ length: SEEDS }, (_, i) =>
                runVisit({ seed: i + 1, spacingM, shape, drift, accuracyM }),
              );
              const cell = `${String(spacingM)} ${shape} ${String(drift.yawDegPer100m)}/${String(drift.transPct)} ${String(accuracyM)}`;
              for (const disagreeM of disagreements) {
                const prepared = visits.map((visit) => {
                  const stored = storedPoses(visit, disagreeM);
                  return { visit, stored, views: codeViews(visit, stored) };
                });
                const refusals = prepared.filter(
                  (p) => p.views.A.refused || p.views.B.refused,
                ).length;
                for (const reachM of reaches) {
                  for (const rule of RULES) {
                    const scores = prepared.flatMap(
                      ({ visit, stored, views }) =>
                        visit.notes.map((note) =>
                          scoreNote(
                            visit,
                            stored,
                            note,
                            settleNote(visit, views, note, rule, reachM),
                          ),
                        ),
                    );
                    const abs = scores.map((s) => s.abs);
                    const rel = scores.map((s) => s.rel);
                    lines.push(
                      `${cell} ${String(reachM)} ${String(disagreeM)} | ${rule} ${f1(quantile(abs, 0.5))}/${f1(quantile(abs, 0.9))} ${f1(quantile(rel, 0.5))}/${f1(quantile(rel, 0.9))} | ${String(refusals)}/${String(SEEDS)}`,
                    );
                  }
                }
                // Move with code: the notes as `nearest` settled them, A then
                // improved by a later visit.
                for (const rule of MOVE_RULES) {
                  const scores = prepared.flatMap(
                    ({ visit, stored, views }) => {
                      const newA = improvedA(visit);
                      const after = {
                        ...stored,
                        A: { ...stored.A, errorNe: newA.errorNe },
                      };
                      return visit.notes.map((note) => {
                        const settled = settleNote(
                          visit,
                          views,
                          note,
                          "nearest",
                          CODE_EVENT_REACH_M,
                        );
                        const moved = moveNote(
                          visit,
                          stored,
                          newA.geo,
                          zeroToGeo(visit, settled),
                          rule,
                        );
                        return scoreNote(
                          visit,
                          after,
                          note,
                          geoToZero(visit, moved),
                        );
                      });
                    },
                  );
                  const abs = scores.map((s) => s.abs);
                  const rel = scores.map((s) => s.rel);
                  moveLines.push(
                    `${cell} ${String(disagreeM)} | ${rule} ${f1(quantile(abs, 0.5))}/${f1(quantile(abs, 0.9))} ${f1(quantile(rel, 0.5))}/${f1(quantile(rel, 0.9))}`,
                  );
                }
              }
            }
          }
        }
      }
      const out = [...lines, "", ...moveLines].join("\n");
      const file = process.env["VISIT_SETTLE_TWO_CODES_OUT"];
      if (file !== undefined && file !== "") writeFileSync(file, out);
      else console.log(out);
      expect(lines.length).toBeGreaterThan(1);
    },
  );
});
