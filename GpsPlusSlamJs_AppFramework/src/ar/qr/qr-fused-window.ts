/**
 * Which recent detections of one code may be combined (QR near-frontal pose
 * plan 2026-09-23-2314, M3b b1, §19): the entry shape and the window
 * selection shared by the fused pose (`qr-fused-pose.ts`) and the motion
 * detector (`qr-motion.ts`). See qr-fused-window.ts.md.
 */

import type { Pose, Point2, CameraIntrinsics } from './qr-pose.js';

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
  /**
   * Tracking-frame epoch: bumped on an odometry restart, after which older
   * detections live in another coordinate frame. Default 0.
   */
  frameEpoch?: number;
  /** The single-frame world pose, when the producer solved one. */
  rawPose?: Pose | null;
}

export interface QrFusedWindowOptions {
  /** Most entries in a window. Default 8. */
  windowSize?: number;
  /** A larger step between consecutive timestamps starts a new window. Default 4000. */
  gapMs?: number;
  /** Entries whose raw position is farther from the newest one are left out. Default Infinity (off). */
  radiusM?: number;
  /**
   * Entries older than this (on the entries' clock) are left out. Default
   * -Infinity (off); the fused tracker sets it from the motion detector
   * (plan §26).
   */
  sinceMs?: number;
}

export const FUSED_WINDOW_DEFAULTS = {
  windowSize: 8,
  gapMs: 4000,
  radiusM: Infinity,
  sinceMs: -Infinity,
};

/**
 * The window options with every value checked: a missing, NaN or
 * out-of-range value takes its default instead of silently switching a
 * check off (an explicit `undefined` from a plain JS caller included).
 */
export function resolveFusedWindowOptions(
  options: QrFusedWindowOptions
): typeof FUSED_WINDOW_DEFAULTS {
  const d = FUSED_WINDOW_DEFAULTS;
  const pick = (
    v: number | undefined,
    fallback: number,
    ok: (x: number) => boolean
  ) => (typeof v === 'number' && ok(v) ? v : fallback);
  return {
    windowSize: pick(options.windowSize, d.windowSize, (x) => x >= 1),
    gapMs: pick(options.gapMs, d.gapMs, (x) => x >= 0),
    radiusM: pick(options.radiusM, d.radiusM, (x) => x > 0),
    sinceMs: pick(options.sinceMs, d.sinceMs, (x) => !Number.isNaN(x)),
  };
}

function distance(a: Pose['position'], b: Pose['position']): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The window (oldest to newest): walking back from the newest entry, stop at
 * another frame epoch, at a step in time larger than `gapMs` (either
 * direction; a NaN step breaks too) or at an entry older than `sinceMs`;
 * leave out entries farther than `radiusM` from the newest raw position in
 * the run (entries without a raw pose are kept); keep at most `windowSize`.
 */
export function selectFusedWindow(
  entries: readonly QrFusedEntry[],
  options: QrFusedWindowOptions = {}
): QrFusedEntry[] {
  const o = resolveFusedWindowOptions(options);
  const newest = entries[entries.length - 1];
  if (!newest) return [];
  const run: QrFusedEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (breaksWindow(e, entries[i + 1], newest, o.gapMs)) break;
    if (e.timestamp < o.sinceMs) break;
    run.push(e);
  }
  const anchor = run.find((e) => e.rawPose)?.rawPose?.position;
  const out = anchor
    ? run.filter(
        (e) => !e.rawPose || distance(e.rawPose.position, anchor) <= o.radiusM
      )
    : run;
  return out.slice(0, o.windowSize).reverse();
}

/** Another frame epoch than the newest, or a time step to the next entry above `gapMs` (or NaN). */
function breaksWindow(
  e: QrFusedEntry,
  later: QrFusedEntry | undefined,
  newest: QrFusedEntry,
  gapMs: number
): boolean {
  if ((e.frameEpoch ?? 0) !== (newest.frameEpoch ?? 0)) return true;
  return (
    later !== undefined && !(Math.abs(later.timestamp - e.timestamp) <= gapMs)
  );
}
