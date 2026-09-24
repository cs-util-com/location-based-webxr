/**
 * The fused QR pose over a window of detections (QR near-frontal pose plan
 * 2026-09-23-2314, M3b b1, §19): which detections form the window, the
 * joint rotation over them (`solveQrPoseMultiView`), the joint-fit gate that
 * decides when the pose may be used (§18), and the fallback to today's
 * averaging when the views contradict each other. See qr-fused-pose.ts.md.
 */

import type { Pose, Point2, CameraIntrinsics } from './qr-pose.js';
import { aggregateQrPose } from './qr-pose-aggregation.js';
import {
  solveQrPoseMultiView,
  type QrMultiViewPoseOptions,
  type QrMultiViewPoseResult,
  type QrViewObservation,
} from './qr-multi-view-pose.js';
import { geodesicAngleRad } from '../../utils/geodesic-angle.js';
import { interpolatingMedian } from '../../utils/median.js';

/** One detection, as the window needs it. */
export interface QrFusedEntry {
  /** Milliseconds on the producer's own clock; only differences are used. */
  timestamp: number;
  /** The 4 corners in symbol reading order (TL, TR, BR, BL), pixels. */
  corners: readonly Point2[];
  /** The capturing camera's world pose. */
  cameraPose: Pose;
  /** Intrinsics of the exact buffer the corners came from. */
  intrinsics: CameraIntrinsics;
  /** Tracking-frame epoch (bumped on an odometry restart); default 0. */
  epoch?: number;
  /** The single-frame world pose, when the producer solved one. */
  rawPose?: Pose | null;
}

export interface QrFusedPoseOptions {
  /** Most entries in a window. Default 8. */
  windowSize?: number;
  /** A larger step between consecutive timestamps starts a new window. Default 4000. */
  gapMs?: number;
  /** Entries whose raw position is farther from the newest one are left out. Default Infinity (off). */
  radiusM?: number;
  /** Views the gate needs. Default 5. */
  minViews?: number;
  /** The gate's bound on the median per-view corner error, px. Default 1.5 (provisional). */
  maxFitPx?: number;
  /** Above this median per-view error the output falls back to averaging, px. Default 3 (provisional). */
  fallbackFitPx?: number;
  /** A state is kept until the error exceeds its bound x this. Default 1.5. */
  hysteresis?: number;
  /**
   * The printed size, used only for the position when no entry carries a raw
   * pose (the rotation does not depend on it). Default 0.16.
   */
  sizeM?: number;
  /** Passed to the joint solve. */
  solveOptions?: QrMultiViewPoseOptions;
  /** The joint solve; injectable so a test can count solves. */
  solve?: typeof solveQrPoseMultiView;
}

export interface QrFusedPose {
  /** `unknown` without entries; `stable` when the gate is open. */
  status: 'unknown' | 'measuring' | 'stable';
  pose: Pose | null;
  /** Which rotation `pose` carries. */
  method: 'joint' | 'averaged' | null;
  /** Views the joint solve used, and those it dropped as unusable. */
  views: number;
  droppedViews: number;
  /** Median per-view corner error at the joint rotation, px (Infinity without a solve). */
  fitPx: number;
  /** Entries in the selected window. */
  windowEntries: number;
  /** Angle between the joint and the averaged rotation, deg (NaN when either is missing). */
  averagedRotationDeltaDeg: number;
}

const DEFAULTS = {
  windowSize: 8,
  gapMs: 4000,
  radiusM: Infinity,
  minViews: 5,
  maxFitPx: 1.5,
  fallbackFitPx: 3,
  hysteresis: 1.5,
  sizeM: 0.16,
};

const UNKNOWN: QrFusedPose = {
  status: 'unknown',
  pose: null,
  method: null,
  views: 0,
  droppedViews: 0,
  fitPx: Infinity,
  windowEntries: 0,
  averagedRotationDeltaDeg: Number.NaN,
};

function distance(a: Pose['position'], b: Pose['position']): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The window (oldest to newest): walking back from the newest entry, stop at
 * another epoch or at a step in time larger than `gapMs` (either direction);
 * leave out entries farther than `radiusM` from the newest raw position
 * (entries without a raw pose are kept); keep at most `windowSize`.
 */
export function selectFusedWindow(
  entries: readonly QrFusedEntry[],
  options: Pick<QrFusedPoseOptions, 'windowSize' | 'gapMs' | 'radiusM'> = {}
): QrFusedEntry[] {
  const o = { ...DEFAULTS, ...options };
  const newest = entries[entries.length - 1];
  if (!newest) return [];
  const out: QrFusedEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < o.windowSize; i--) {
    const e = entries[i]!;
    if (breaksWindow(e, entries[i + 1], newest, o.gapMs)) break;
    if (!isFar(e, newest, o.radiusM)) out.push(e);
  }
  return out.reverse();
}

/** Another epoch than the newest, or a step in time above `gapMs` to the next entry. */
function breaksWindow(
  e: QrFusedEntry,
  later: QrFusedEntry | undefined,
  newest: QrFusedEntry,
  gapMs: number
): boolean {
  if ((e.epoch ?? 0) !== (newest.epoch ?? 0)) return true;
  return later !== undefined && Math.abs(later.timestamp - e.timestamp) > gapMs;
}

/** Farther than `radiusM` from the newest raw position (false when either has none). */
function isFar(
  e: QrFusedEntry,
  newest: QrFusedEntry,
  radiusM: number
): boolean {
  const anchor = newest.rawPose;
  if (!anchor || !e.rawPose) return false;
  return distance(e.rawPose.position, anchor.position) > radiusM;
}

/** The joint solve over the window and its robust fit statistic. */
function jointOf(
  window: readonly QrFusedEntry[],
  o: typeof DEFAULTS & QrFusedPoseOptions
): { joint: QrMultiViewPoseResult | null; fitPx: number } {
  const views: QrViewObservation[] = window.map((e) => ({
    corners: e.corners,
    cameraPose: e.cameraPose,
    intrinsics: e.intrinsics,
  }));
  const joint = (o.solve ?? solveQrPoseMultiView)(
    views,
    o.sizeM,
    o.solveOptions
  );
  return {
    joint,
    fitPx:
      joint && joint.viewRmsPx.length
        ? interpolatingMedian(joint.viewRmsPx)
        : Infinity,
  };
}

/** Whether a state is (still) held: under the bound, or under bound x hysteresis if held before. */
function held(
  value: number,
  bound: number,
  before: boolean,
  hyst: number
): boolean {
  return value <= bound || (before && value <= bound * hyst);
}

/**
 * The fused pose of the window selected from `entries`. `previous` (the last
 * result for the same code) makes the gate and the method sticky, so the
 * output does not flicker between states or methods.
 */
export function evaluateFusedQrPose(
  entries: readonly QrFusedEntry[],
  options: QrFusedPoseOptions = {},
  previous?: QrFusedPose | null
): QrFusedPose {
  const o = { ...DEFAULTS, ...options };
  const window = selectFusedWindow(entries, o);
  if (window.length === 0) return { ...UNKNOWN };
  const averaged = averagedOf(window);
  const { joint, fitPx } = jointOf(window, o);
  const { useJoint, stable } = decide(joint, fitPx, o, previous);
  return {
    status: stable ? 'stable' : 'measuring',
    ...poseOf(useJoint ? joint : null, averaged, joint),
    views: joint ? joint.views : 0,
    droppedViews: joint ? joint.droppedViews : window.length,
    fitPx,
    windowEntries: window.length,
    averagedRotationDeltaDeg: rotationDeltaDeg(joint, averaged),
  };
}

/**
 * The method and the gate: the joint rotation unless its fit is above the
 * fallback bound; stable with enough views and a fit under the gate's bound.
 * Both bounds stretch by `hysteresis` for a state held before.
 */
function decide(
  joint: QrMultiViewPoseResult | null,
  fitPx: number,
  o: typeof DEFAULTS,
  previous: QrFusedPose | null | undefined
): { useJoint: boolean; stable: boolean } {
  const wasJoint = previous ? previous.method === 'joint' : false;
  const wasStable = previous ? previous.status === 'stable' : false;
  const useJoint =
    joint !== null && held(fitPx, o.fallbackFitPx, wasJoint, o.hysteresis);
  const stable =
    useJoint &&
    joint.views >= o.minViews &&
    held(fitPx, o.maxFitPx, wasStable, o.hysteresis);
  return { useJoint, stable };
}

/** Today's aggregate of the window's raw poses (median position, averaged rotation). */
function averagedOf(window: readonly QrFusedEntry[]): Pose | null {
  const raws: Pose[] = [];
  for (const e of window) if (e.rawPose) raws.push(e.rawPose);
  const agg = aggregateQrPose(raws);
  return agg ? agg.pose : null;
}

/**
 * The output pose: the joint rotation when `chosen` is set, else the
 * averaged one; the position from the raw poses (today's median) when there
 * are any, else the joint solve's.
 */
function poseOf(
  chosen: QrMultiViewPoseResult | null,
  averaged: Pose | null,
  joint: QrMultiViewPoseResult | null
): Pick<QrFusedPose, 'pose' | 'method'> {
  const rotation = chosen ? chosen.rotation : averaged && averaged.rotation;
  const position = averaged ? averaged.position : joint && joint.position;
  if (!rotation || !position) return { pose: null, method: null };
  return {
    pose: { rotation, position },
    method: chosen ? 'joint' : 'averaged',
  };
}

function rotationDeltaDeg(
  joint: QrMultiViewPoseResult | null,
  averaged: Pose | null
): number {
  if (!joint || !averaged) return Number.NaN;
  return (geodesicAngleRad(joint.rotation, averaged.rotation) * 180) / Math.PI;
}

export interface FusedQrPoseTracker {
  /** The fused pose for `entries`; solves again only for a new array. */
  evaluate(entries: readonly QrFusedEntry[]): QrFusedPose;
  /** Forget the cached result and the hysteresis state. */
  reset(): void;
}

/**
 * A per-code tracker: caches on the entries ARRAY identity (the store hands
 * out a new array per new detection; never a timestamp, which replay and
 * store swaps reuse) and carries the previous result for the hysteresis.
 */
export function createFusedQrPoseTracker(
  options: QrFusedPoseOptions = {}
): FusedQrPoseTracker {
  let lastEntries: readonly QrFusedEntry[] | null = null;
  let last: QrFusedPose | null = null;
  return {
    evaluate(entries) {
      if (entries === lastEntries && last) return last;
      last = evaluateFusedQrPose(entries, options, last);
      lastEntries = entries;
      return last;
    },
    reset() {
      lastEntries = null;
      last = null;
    },
  };
}
