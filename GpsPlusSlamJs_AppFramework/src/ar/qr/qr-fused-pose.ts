/**
 * The fused QR pose over a window of detections (QR near-frontal pose plan
 * 2026-09-23-2314, M3b b1, §19): the joint rotation over the window
 * (`qr-fused-window.ts`) (`solveQrPoseMultiView`), the joint-fit gate that
 * decides when the pose may be used (§18), and the fallback to today's
 * averaging when the views contradict each other. See qr-fused-pose.ts.md.
 */

import type { Pose } from './qr-pose.js';
import {
  FUSED_WINDOW_DEFAULTS,
  resolveFusedWindowOptions,
  selectFusedWindow,
  type QrFusedEntry,
  type QrFusedWindowOptions,
} from './qr-fused-window.js';
import { aggregateQrPose } from './qr-pose-aggregation.js';
import {
  solveQrPoseMultiView,
  type QrMultiViewPoseOptions,
  type QrMultiViewPoseResult,
  type QrViewObservation,
} from './qr-multi-view-pose.js';
import {
  createQrMotionTracker,
  type QrMotion,
  type QrMotionOptions,
} from './qr-motion.js';
import { geodesicAngleRad } from '../../utils/geodesic-angle.js';
import { interpolatingMedian } from '../../utils/median.js';

export interface QrFusedPoseOptions extends QrFusedWindowOptions {
  /** Views the gate needs. Default 5. */
  minViews?: number;
  /**
   * The gate's bound on the median per-view corner error, px. Default 1.5 -
   * above every good rendered window (0.5-1.1 px, plan §20), still to be
   * checked against the phone's corner noise (b7).
   */
  maxFitPx?: number;
  /** Above this median per-view error the output falls back to averaging, px. Default 3 (b7 as above). */
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
  /**
   * The tracker's motion detector (`qr-motion.ts`, plan §26); `false`
   * switches it off. Ignored by `evaluateFusedQrPose` itself.
   */
  motion?: QrMotionOptions | false;
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
  /**
   * The window's frame epoch and time span: the next evaluation carries this
   * result's hysteresis over only if its window CONTINUES this one.
   */
  frameEpoch: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  /**
   * Whether the code is being moved or turned, from the tracker's motion
   * detector; null from `evaluateFusedQrPose` alone or with the detector off.
   */
  motion: QrMotion | null;
}

const DEFAULTS = {
  ...FUSED_WINDOW_DEFAULTS,
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
  frameEpoch: 0,
  oldestTimestamp: Number.NaN,
  newestTimestamp: Number.NaN,
  motion: null,
};

type Resolved = typeof DEFAULTS & {
  solveOptions: QrMultiViewPoseOptions | undefined;
  solve: typeof solveQrPoseMultiView | undefined;
};

/**
 * The options with every numeric one checked: a missing, NaN or out-of-range
 * value takes its default instead of silently switching a check off (an
 * explicit `undefined` from a plain JS caller included).
 */
function resolveOptions(options: QrFusedPoseOptions): Resolved {
  const pick = (
    v: number | undefined,
    d: number,
    ok: (x: number) => boolean
  ) => (typeof v === 'number' && ok(v) ? v : d);
  const positive = (x: number) => x > 0;
  return {
    ...resolveFusedWindowOptions(options),
    minViews: pick(options.minViews, DEFAULTS.minViews, (x) => x >= 1),
    maxFitPx: pick(options.maxFitPx, DEFAULTS.maxFitPx, positive),
    fallbackFitPx: pick(
      options.fallbackFitPx,
      DEFAULTS.fallbackFitPx,
      positive
    ),
    hysteresis: pick(options.hysteresis, DEFAULTS.hysteresis, (x) => x >= 1),
    sizeM: pick(
      options.sizeM,
      DEFAULTS.sizeM,
      (x) => positive(x) && Number.isFinite(x)
    ),
    solveOptions: options.solveOptions,
    solve: options.solve,
  };
}

/** The joint solve over the window and its robust fit statistic. */
function jointOf(
  window: readonly QrFusedEntry[],
  o: Resolved
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
 * output does not flicker between states or methods - but only while the
 * window CONTINUES it (same frame epoch, no gap above `gapMs` between the
 * previous window's newest entry and this window's oldest).
 */
export function evaluateFusedQrPose(
  entries: readonly QrFusedEntry[],
  options: QrFusedPoseOptions = {},
  previous?: QrFusedPose | null
): QrFusedPose {
  const o = resolveOptions(options);
  const window = selectFusedWindow(entries, o);
  const oldest = window[0];
  const newest = window[window.length - 1];
  if (!oldest || !newest) return { ...UNKNOWN };
  const averaged = averagedOf(window);
  const { joint, fitPx } = jointOf(window, o);
  const frameEpoch = newest.frameEpoch ?? 0;
  const carried = continues(previous, frameEpoch, oldest, newest, o.gapMs)
    ? previous
    : null;
  const { useJoint, stable } = decide(joint, fitPx, o, carried);
  return {
    status: stable ? 'stable' : 'measuring',
    ...poseOf(useJoint ? joint : null, averaged, joint),
    views: joint ? joint.views : 0,
    droppedViews: joint ? joint.droppedViews : 0,
    fitPx,
    windowEntries: window.length,
    averagedRotationDeltaDeg: rotationDeltaDeg(joint, averaged),
    frameEpoch,
    oldestTimestamp: oldest.timestamp,
    newestTimestamp: newest.timestamp,
    motion: null,
  };
}

/**
 * Whether this window continues `previous`'s: same frame epoch, not older (a
 * replay seek backwards starts afresh), and no gap above `gapMs` between the
 * previous window's newest entry and this window's oldest.
 */
function continues(
  previous: QrFusedPose | null | undefined,
  frameEpoch: number,
  oldest: QrFusedEntry,
  newest: QrFusedEntry,
  gapMs: number
): previous is QrFusedPose {
  if (!previous || previous.status === 'unknown') return false;
  if (previous.frameEpoch !== frameEpoch) return false;
  if (!(newest.timestamp >= previous.newestTimestamp)) return false;
  return oldest.timestamp - previous.newestTimestamp <= gapMs;
}

/**
 * The method and the gate: the joint rotation unless its fit is above the
 * fallback bound; stable with enough views and a fit under the gate's bound.
 * Both bounds stretch by `hysteresis` for a state held before.
 */
function decide(
  joint: QrMultiViewPoseResult | null,
  fitPx: number,
  o: Resolved,
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
 * The window cut the motion detector asks for (plan §26): while the code is
 * moved or turned only the newest entry (never stable, so the app shows the
 * raw pose), once it is still again only the entries since then.
 */
function motionCutMs(
  motion: QrMotion | null,
  entries: readonly QrFusedEntry[]
): number | undefined {
  if (!motion) return undefined;
  if (motion.moving || motion.turning) {
    return entries[entries.length - 1]?.timestamp;
  }
  return motion.stillSinceMs ?? undefined;
}

/**
 * A per-code tracker: caches on the entries ARRAY identity (the store hands
 * out a new array per new detection; never a timestamp, which replay and
 * store swaps reuse), carries the previous result for the hysteresis, and
 * runs the motion detector (unless `motion: false`), which cuts the window
 * once a motion is CONFIRMED, so the views from before it stop being fused.
 * A motion too short or too slow to be confirmed is not cut (see the
 * sidecar).
 */
export function createFusedQrPoseTracker(
  options: QrFusedPoseOptions = {}
): FusedQrPoseTracker {
  const motionTracker =
    options.motion === false ? null : createQrMotionTracker(options.motion);
  let lastEntries: readonly QrFusedEntry[] | null = null;
  let last: QrFusedPose | null = null;
  return {
    evaluate(entries) {
      if (entries === lastEntries && last) return last;
      const motion = motionTracker ? motionTracker.update(entries) : null;
      const sinceMs = motionCutMs(motion, entries);
      const fused = evaluateFusedQrPose(
        entries,
        sinceMs === undefined ? options : { ...options, sinceMs },
        last
      );
      last = { ...fused, motion };
      lastEntries = entries;
      return last;
    },
    reset() {
      motionTracker?.reset();
      lastEntries = null;
      last = null;
    },
  };
}
