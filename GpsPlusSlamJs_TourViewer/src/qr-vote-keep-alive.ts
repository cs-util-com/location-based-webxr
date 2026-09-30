/**
 * The code's keep-alive (Tour Viewer authoring plan 2026-09-28-0953 §3.2,
 * owner decisions D8/D9, measured in M0b/M0c): after a scan's vote budget is
 * spent, the viewer keeps re-voting from the last stable pose of the code,
 * so the code keeps its hold on the alignment for about two minutes and then
 * hands it back to GPS gradually.
 *
 * The schedule is the measured one, and nothing else: after every DEVICE GPS
 * fix, one ring of votes whose size is the full per-lock count while the
 * hold lasts, then falls linearly to zero over the fade. The count is carried
 * in a credit accumulator, so the mean rate follows the schedule exactly
 * while every batch stays a ring of at least 3 points (the builder's
 * non-collinear minimum). The time base is the last lock of the kept code.
 *
 * Pure: every time is an argument, so the lifecycle is testable with a fake
 * clock. Dispatching the votes, and deciding WHEN a device fix happened
 * ({@link createDeviceFixWatch}), belong to the caller.
 *
 * @see qr-vote-keep-alive.ts.md
 */

import {
  buildQrGpsVotes,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

/** The builder's minimum for a non-collinear ring. */
const MIN_RING_POINTS = 3;

/** Id prefix of keep-alive votes, so a recording tells them from a lock's
 *  (`qr-`); both carry the synthetic-QR source stamp. */
const KEEP_ALIVE_ID_PREFIX = "qr-keep";

export interface KeepAliveSettings {
  /** Full strength after the kept code's last lock (ms). */
  readonly holdMs: number;
  /** Linear fade to zero after the hold (ms). */
  readonly fadeMs: number;
  /** Votes per fix at full strength - the per-lock count (integer >= 3). */
  readonly votesPerFix: number;
  /** Ring radius in the code's plane (m). */
  readonly baselineM: number;
  /** Synthetic accuracy stamped on each vote (m). */
  readonly syntheticAccuracyM: number;
}

/** What the keep-alive re-votes from: the code and its last stable pose. */
export interface KeptCode {
  readonly text: string;
  /** The stable (fused) pose, raw WebXR/odometry frame. */
  readonly qrPoseWorld: Pose;
  readonly qrGeo: QrGeoPose;
  readonly sizeM: number;
}

export type KeepAlivePhase =
  | { readonly kind: "none" }
  | {
      readonly kind: "holding";
      readonly text: string;
      readonly remainingMs: number;
    }
  | { readonly kind: "fading"; readonly text: string; readonly share: number }
  | { readonly kind: "ended"; readonly text: string };

export interface QrVoteKeepAlive {
  /** A lock of `code` cast votes from this stable pose at `atMs`: keep it
   *  (a different code takes over) and restart the hold. */
  keep(code: KeptCode, atMs: number): void;
  /** Any lock of `text` at `atMs`: a re-scan of the kept code restarts the
   *  hold (from the pose already kept); another code changes nothing. */
  relock(text: string, atMs: number): void;
  /** One device GPS fix at `fixMs`: the votes to cast now, stamped with the
   *  fix time (often none). */
  votesForFix(fixMs: number): RecordGpsEventPayload[];
  /** Where the hold stands at `nowMs` - the status line's input. */
  phase(nowMs: number): KeepAlivePhase;
  /** Forget the kept code: AR exit, or the code's tour closed. */
  stop(): void;
}

/**
 * The keep-alive's share of the full count `elapsedMs` after the kept
 * code's last lock: 1 through the hold (also for a fix stamped slightly
 * before the lock), linear to 0 over the fade, 0 after it and for a
 * non-finite elapsed time.
 */
export function keepAliveShare(
  elapsedMs: number,
  holdMs: number,
  fadeMs: number,
): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  if (elapsedMs <= holdMs) return 1;
  if (fadeMs <= 0 || elapsedMs >= holdMs + fadeMs) return 0;
  return 1 - (elapsedMs - holdMs) / fadeMs;
}

function validate(settings: KeepAliveSettings): void {
  const { holdMs, fadeMs, votesPerFix, baselineM, syntheticAccuracyM } =
    settings;
  const nonNegative = (x: number) => Number.isFinite(x) && x >= 0;
  const positive = (x: number) => Number.isFinite(x) && x > 0;
  if (!nonNegative(holdMs) || !nonNegative(fadeMs)) {
    throw new RangeError(
      `qr-vote-keep-alive: hold and fade must be finite and >= 0, got ${String(holdMs)} / ${String(fadeMs)}`,
    );
  }
  if (!Number.isInteger(votesPerFix) || votesPerFix < MIN_RING_POINTS) {
    throw new RangeError(
      `qr-vote-keep-alive: votesPerFix must be an integer >= ${String(MIN_RING_POINTS)}, got ${String(votesPerFix)}`,
    );
  }
  if (!positive(baselineM) || !positive(syntheticAccuracyM)) {
    throw new RangeError(
      `qr-vote-keep-alive: baselineM and syntheticAccuracyM must be > 0, got ${String(baselineM)} / ${String(syntheticAccuracyM)}`,
    );
  }
}

export function createQrVoteKeepAlive(
  settings: KeepAliveSettings,
): QrVoteKeepAlive {
  validate(settings);
  const { holdMs, fadeMs, votesPerFix, baselineM, syntheticAccuracyM } =
    settings;
  let kept: KeptCode | null = null;
  /** The kept code's last lock - the hold's time base. */
  let heldFromMs = 0;
  /** Votes owed but not yet cast (below one ring, or fractional). */
  let credit = 0;

  return {
    keep(code, atMs) {
      if (!Number.isFinite(atMs)) return;
      if (kept?.text !== code.text) credit = 0;
      kept = code;
      heldFromMs = atMs;
    },
    relock(text, atMs) {
      if (kept?.text !== text || !Number.isFinite(atMs)) return;
      heldFromMs = Math.max(heldFromMs, atMs);
    },
    votesForFix(fixMs) {
      if (kept === null) return [];
      const share = keepAliveShare(fixMs - heldFromMs, holdMs, fadeMs);
      if (share === 0) return [];
      credit += votesPerFix * share;
      const count = Math.floor(credit);
      if (count < MIN_RING_POINTS) return [];
      let votes: RecordGpsEventPayload[];
      try {
        votes = buildQrGpsVotes({
          qrPoseWorld: kept.qrPoseWorld,
          sizeM: kept.sizeM,
          qrGeo: kept.qrGeo,
          syntheticAccuracyM,
          baselineM,
          count,
          timestamp: fixMs,
          idPrefix: KEEP_ALIVE_ID_PREFIX,
        });
      } catch {
        // A code that cannot build a vote can never cast one: drop it
        // rather than throw into the store listener that called this.
        kept = null;
        credit = 0;
        return [];
      }
      credit -= count;
      return votes;
    },
    phase(nowMs) {
      if (kept === null) return { kind: "none" };
      const elapsed = nowMs - heldFromMs;
      const share = keepAliveShare(elapsed, holdMs, fadeMs);
      if (share === 1) {
        return {
          kind: "holding",
          text: kept.text,
          remainingMs: Math.max(0, holdMs - elapsed),
        };
      }
      return share > 0
        ? { kind: "fading", text: kept.text, share }
        : { kind: "ended", text: kept.text };
    },
    stop() {
      kept = null;
      credit = 0;
    },
  };
}

/**
 * Watches a store's GPS positions for NEW device fixes - the keep-alive's
 * trigger. Returns the timestamp of the newest stored point when it is a
 * device fix not reported before, else null. A synthetic QR vote (the
 * keep-alive's own output) is never a fix, and neither is a point whose
 * source this version does not know (`gpsPointSourceOf` reads it as
 * `unknown`): rounding an unknown source toward "real GPS" is the one
 * direction that must not happen.
 */
export function createDeviceFixWatch(): (
  positions: readonly {
    readonly source?: string;
    readonly timestamp: number;
  }[],
) => number | null {
  let lastSeen: unknown = undefined;
  return (positions) => {
    const newest = positions.at(-1);
    if (newest === undefined || newest === lastSeen) return null;
    lastSeen = newest;
    return gpsPointSourceOf(newest) === GPS_POINT_SOURCE_DEVICE
      ? newest.timestamp
      : null;
  };
}
