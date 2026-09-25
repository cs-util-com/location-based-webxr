/**
 * The QR motion detector (QR near-frontal pose plan 2026-09-23-2314, §26):
 * per code and INDEPENDENTLY, whether it is being moved and whether it is
 * being turned, from a joint solve over its last few detections - in world
 * coordinates, so a camera walking around a still code reads "still".
 * See qr-motion.ts.md.
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { Pose } from './qr-pose.js';
import {
  FUSED_WINDOW_DEFAULTS,
  selectFusedWindow,
  type QrFusedEntry,
} from './qr-fused-window.js';
import {
  solveQrPoseMultiView,
  viewErrorAtRotationPx,
  type QrMultiViewPoseResult,
  type QrViewObservation,
} from './qr-multi-view-pose.js';
import { geodesicAngleRad } from '../../utils/geodesic-angle.js';
import { interpolatingMedian } from '../../utils/median.js';

export type QrMotionState = 'still' | 'moving' | 'turning' | 'moving+turning';

export interface QrMotionOptions {
  /** Detections the signals look at: the newest against the rest. Default 4. */
  motionWindow?: number;
  /** The newest view's own position this far from the rest's median = moving, m. Default 0.03. */
  moveM?: number;
  /**
   * The newest view's corner error at the rotation solved from the OTHER
   * views above this = turning, px. Default 3 (provisional: phone fits run
   * 0.6-1.5 px, plan §25; swept in §26).
   */
  turnPx?: number;
  /**
   * A larger step between consecutive timestamps breaks the motion window,
   * ms. Default: the fused window's (4000); the fused tracker hands its own.
   */
  gapMs?: number;
  /** Consecutive detections a new state must show before it is taken. Default 4 (owner, ~0.5 s). */
  persistence?: number;
  /** The printed size, for positions only when the entries carry no raw poses (the rotation does not depend on it). Default 0.16. */
  sizeM?: number;
  /** Injectable joint solve. */
  solve?: typeof solveQrPoseMultiView;
}

/** One detection's raw signals, before persistence. */
export interface QrMotionSignals {
  movingCandidate: boolean;
  turningCandidate: boolean;
  /** The newest view's own position offset from the rest's median, m (null: < 2 views). */
  offsetM: number | null;
  /** Speed of that offset over the time since the rest's median detection, m/s. */
  speedMps: number | null;
  /** The newest view's corner error at the rotation solved from the others, px. */
  newestFitPx: number | null;
  /** Rough turn rate: the newest single-frame rotation against the others', deg/s. */
  turnRateDegPerS: number | null;
}

export interface QrMotion extends QrMotionSignals {
  /** The persisted state (a change needs `persistence` consecutive detections). */
  state: QrMotionState;
  moving: boolean;
  turning: boolean;
  /**
   * Since when the code has been still after its last confirmed motion, ms on
   * the entries' clock; null when it has not moved in this frame epoch.
   */
  stillSinceMs: number | null;
}

const DEFAULTS = {
  motionWindow: 4,
  moveM: 0.03,
  turnPx: 3,
  persistence: 4,
  sizeM: 0.16,
  gapMs: FUSED_WINDOW_DEFAULTS.gapMs,
};

type Resolved = typeof DEFAULTS & { solve: typeof solveQrPoseMultiView };

function resolve(o: QrMotionOptions): Resolved {
  const pick = (
    v: number | undefined,
    d: number,
    ok: (x: number) => boolean
  ) => (typeof v === 'number' && ok(v) ? v : d);
  return {
    motionWindow: pick(o.motionWindow, DEFAULTS.motionWindow, (x) => x >= 2),
    moveM: pick(o.moveM, DEFAULTS.moveM, (x) => x > 0),
    turnPx: pick(o.turnPx, DEFAULTS.turnPx, (x) => x > 0),
    persistence: pick(o.persistence, DEFAULTS.persistence, (x) => x >= 1),
    sizeM: pick(o.sizeM, DEFAULTS.sizeM, (x) => x > 0 && Number.isFinite(x)),
    gapMs: pick(o.gapMs, DEFAULTS.gapMs, (x) => x >= 0),
    solve: o.solve ?? solveQrPoseMultiView,
  };
}

const NONE: QrMotionSignals = {
  movingCandidate: false,
  turningCandidate: false,
  offsetM: null,
  speedMps: null,
  newestFitPx: null,
  turnRateDegPerS: null,
};

function medianPosition(ps: readonly Vector3[]): Vector3 {
  const axis = (a: 0 | 1 | 2) => interpolatingMedian(ps.map((p) => p[a]));
  return [axis(0), axis(1), axis(2)];
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Each view's own position: the producer's raw poses when every entry has
 * one - solved at the size the producer measured - else the joint solve's
 * per-view positions at the assumed `sizeM`. A wrong size pulls each view's
 * position toward its camera, so a walking camera would move a still code.
 */
function viewPositions(
  window: readonly QrFusedEntry[],
  joint: QrMultiViewPoseResult
): readonly Vector3[] {
  const raws = window.map((e) => e.rawPose?.position);
  return raws.every((p) => p !== undefined) ? raws : joint.viewPositions;
}

/**
 * Seconds from the rest's median detection to the newest: the time base of
 * both rates, since the newest is compared with the rest as a whole.
 */
function sinceRestS(times: readonly number[]): number {
  return (
    (times[times.length - 1]! - interpolatingMedian(times.slice(0, -1))) / 1000
  );
}

/** The newest view's own position offset and its speed. */
function translation(
  ps: readonly Vector3[],
  dtS: number
): { offsetM: number; speedMps: number | null } {
  const newest = ps[ps.length - 1]!;
  const rest = ps.slice(0, -1);
  const offsetM = distance(newest, medianPosition(rest));
  return { offsetM, speedMps: dtS > 0 ? offsetM / dtS : null };
}

/**
 * Rough turn rate: the newest single-frame (raw) rotation against the
 * others' joint rotation. The raw rotation is the flip-prone one near
 * head-on, so this is for display, never for a decision.
 */
function turnRate(
  newest: QrFusedEntry,
  restRotation: Pose['rotation'],
  dtS: number
): number | null {
  const raw: Pose | null | undefined = newest.rawPose;
  if (!raw || !(dtS > 0)) return null;
  return (geodesicAngleRad(raw.rotation, restRotation) * 180) / Math.PI / dtS;
}

function toView(e: QrFusedEntry): QrViewObservation {
  return {
    corners: e.corners,
    cameraPose: e.cameraPose,
    intrinsics: e.intrinsics,
  };
}

/**
 * One detection's motion signals: the newest of the last `motionWindow`
 * detections (one frame epoch, no long gap) against the rest. The newest
 * against the rest, not a spread over the window, so a single outlier frame
 * is a candidate for ONE detection only and can never reach the persistence.
 */
export function measureQrMotion(
  entries: readonly QrFusedEntry[],
  options: QrMotionOptions = {}
): QrMotionSignals {
  const o = resolve(options);
  const window = selectFusedWindow(entries, {
    windowSize: o.motionWindow,
    gapMs: o.gapMs,
  });
  if (window.length < 2) return { ...NONE };
  const newest = window[window.length - 1]!;
  // The solve over all views checks each is usable (and gives positions
  // when the entries carry no raw poses).
  const all = o.solve(window.map(toView), o.sizeM);
  // Rotation: from the OTHER views only. Under a continuous turn every view
  // disagrees with a rotation shared by all of them, so the newest's share
  // of that disagreement says little; against the others' rotation it is
  // clearly past it.
  const rest = o.solve(window.slice(0, -1).map(toView), o.sizeM);
  // Every view in the motion window must be usable: the newest must be
  // judged, and a dropped view would shift the positions against their times.
  if (!all || !rest || all.droppedViews > 0) return { ...NONE };
  const dtS = sinceRestS(window.map((e) => e.timestamp));
  const { offsetM, speedMps } = translation(viewPositions(window, all), dtS);
  const newestFitPx = viewErrorAtRotationPx(
    toView(newest),
    rest.rotation,
    o.sizeM
  );
  return {
    movingCandidate: offsetM > o.moveM,
    turningCandidate: newestFitPx !== null && newestFitPx > o.turnPx,
    offsetM,
    speedMps,
    newestFitPx,
    turnRateDegPerS: turnRate(newest, rest.rotation, dtS),
  };
}

/** One flag's persistence: the confirmed value and the run of the opposite. */
interface Flag {
  value: boolean;
  run: number;
  runStartMs: number | null;
  stillSinceMs: number | null;
}

function step(
  flag: Flag,
  candidate: boolean,
  atMs: number,
  persistence: number
): Flag {
  if (candidate === flag.value) return { ...flag, run: 0, runStartMs: null };
  const run = flag.run + 1;
  const runStartMs = flag.runStartMs ?? atMs;
  if (run < persistence) return { ...flag, run, runStartMs };
  return {
    value: candidate,
    run: 0,
    runStartMs: null,
    stillSinceMs: candidate ? flag.stillSinceMs : runStartMs,
  };
}

/** The same detection: the store passes the corners through by reference. */
function sameDetection(a: QrFusedEntry, b: QrFusedEntry): boolean {
  return a === b || (a.corners === b.corners && a.timestamp === b.timestamp);
}

function stateOf(moving: boolean, turning: boolean): QrMotionState {
  if (moving && turning) return 'moving+turning';
  if (moving) return 'moving';
  return turning ? 'turning' : 'still';
}

export interface QrMotionTracker {
  /** Feed a code's entries (oldest first) after each new detection. */
  update(entries: readonly QrFusedEntry[]): QrMotion;
  reset(): void;
}

/**
 * The per-code detector with persistence: moving and turning are each
 * confirmed only after `persistence` consecutive detections agree, in both
 * directions. A new frame epoch starts it afresh.
 */
export function createQrMotionTracker(
  options: QrMotionOptions = {}
): QrMotionTracker {
  const o = resolve(options);
  const fresh = (): Flag => ({
    value: false,
    run: 0,
    runStartMs: null,
    stillSinceMs: null,
  });
  let moving = fresh();
  let turning = fresh();
  let epoch: number | null = null;
  // Persistence counts DETECTIONS: a re-read of the same newest detection
  // (a HUD render, or the store rebuilding its entry objects) returns the
  // last result instead of stepping again.
  let lastNewest: QrFusedEntry | null = null;
  let last: QrMotion | null = null;
  const restart = (e: number) => {
    moving = fresh();
    turning = fresh();
    epoch = e;
  };
  const result = (signals: QrMotionSignals): QrMotion => {
    const state = stateOf(moving.value, turning.value);
    const since = [moving.stillSinceMs, turning.stillSinceMs].filter(
      (t): t is number => t !== null
    );
    return {
      ...signals,
      state,
      moving: moving.value,
      turning: turning.value,
      stillSinceMs:
        state === 'still' && since.length ? Math.max(...since) : null,
    };
  };
  const isReRead = (newest: QrFusedEntry) =>
    last !== null && lastNewest !== null && sameDetection(newest, lastNewest);
  // A new frame epoch, or time going backwards in one (a replay seek, a
  // store swap), is a new run: the old run's times mean nothing in it.
  const startsNewRun = (newest: QrFusedEntry) =>
    epoch !== (newest.frameEpoch ?? 0) ||
    (lastNewest !== null && newest.timestamp < lastNewest.timestamp);
  const advance = (signals: QrMotionSignals, atMs: number) => {
    moving = step(moving, signals.movingCandidate, atMs, o.persistence);
    turning = step(turning, signals.turningCandidate, atMs, o.persistence);
  };
  return {
    update(entries) {
      const newest = entries[entries.length - 1];
      if (newest && isReRead(newest)) return last!;
      const signals = measureQrMotion(entries, options);
      if (!newest)
        return {
          ...signals,
          state: 'still',
          moving: false,
          turning: false,
          stillSinceMs: null,
        };
      if (startsNewRun(newest)) restart(newest.frameEpoch ?? 0);
      lastNewest = newest;
      // No signal (too few views, a failed solve, an unusable view) says
      // nothing about motion: it neither confirms nor breaks a run.
      if (signals.offsetM !== null) advance(signals, newest.timestamp);
      last = result(signals);
      return last;
    },
    reset() {
      moving = fresh();
      turning = fresh();
      epoch = null;
      lastNewest = null;
      last = null;
    },
  };
}
