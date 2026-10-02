/**
 * The visitor's `tourViewing/*` log (authoring recording plan
 * 2026-09-28-0953, M1b): thin hooks the viewer pipeline calls at its
 * existing seams - a recorded detection, each vote it dispatches, the
 * voted lock, a placement - turned into the log actions of
 * `tour-viewing-actions.ts`.
 *
 * - SILENT WHILE OFF. Every hook returns at once unless `enabled()` (the
 *   recording's persistence gate): no action is dispatched, no vote is
 *   kept, so a visitor without `?debug=1` and the switch pays nothing - not
 *   even a store subscriber's render per lock.
 * - A LOCK IS LOGGED WHEN IT STARTS TRACKING, not per locked frame: the
 *   controller locks at the camera cadence, and every locked frame is
 *   already a `qrDetected/*` action. A lock after a miss, of another code,
 *   or in another AR visit is a new one.
 * - VOTES ARE LOGGED PER LOCK. The controller dispatches a lock's votes one
 *   by one and then reports the voted lock; the votes are collected in
 *   between and logged as one batch with the lock's code.
 * - THE KEEP-ALIVE IS LOGGED PER STATE CHANGE (M1b review #5), through a
 *   thin wrapper around the entry's keep-alive: armed, a re-scan, the fade,
 *   the end, the stop - never per tracked frame or per fix. Its votes stay
 *   out of the lock batches; they are in the raw stream as `qr-keep` GPS
 *   events.
 * - A CODE THE MOVED-CODE CHECK IGNORES is logged once, at the veto, with
 *   the detector's inputs and what the recovery did (D20, M5c; §7j #15).
 *
 * @see viewing-log.ts.md
 */

import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrTrackingStatus } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import type { KeepAlivePhase, QrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import type { AlignmentMatrix } from "./tour-authoring-actions.js";
import {
  codeIgnored,
  codeLocked,
  keepAliveChanged,
  tourPlaced,
  votesCast,
  type TourViewingAction,
} from "./tour-viewing-actions.js";

type CodeIgnoredInput = Omit<
  Parameters<typeof codeIgnored>[0],
  "alignmentMatrix" | "arVisitIndex" | "atMs"
>;

type PlacedInput = Omit<
  Parameters<typeof tourPlaced>[0],
  "alignmentMatrix" | "arVisitIndex" | "atMs"
>;

export interface ViewingLog {
  /** A locked frame's detection, as the pipeline records it; `statusBefore`
   *  is the controller status before this frame (`tracking` while the code
   *  stayed locked). */
  detection(
    event: QrDetectionEvent,
    level: QrLevel | null,
    statusBefore: QrTrackingStatus | null,
  ): void;
  /** One vote the pipeline dispatched. */
  vote(payload: RecordGpsEventPayload): void;
  /** The lock whose votes were just dispatched. */
  votedLock(text: string, votedLocks: number): void;
  placed(input: PlacedInput): void;
  /** The moved-code check's veto, after its recovery. */
  codeIgnored(input: CodeIgnoredInput): void;
  /** Wrap the AR entry's keep-alive so its state changes are logged; the
   *  wrapper forwards every call unchanged. */
  keepAlive(inner: QrVoteKeepAlive): QrVoteKeepAlive;
}

type KeepAliveEvent = ReturnType<typeof keepAliveChanged>["payload"]["event"];
type KeptCode = Parameters<QrVoteKeepAlive["keep"]>[0];

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createViewingLog(deps: {
  /** Whether the recording runs (its persistence gate). */
  enabled: () => boolean;
  dispatch: (action: TourViewingAction) => void;
  alignmentMatrix: () => AlignmentMatrix;
  /** The scan gate's state, for the lock log. */
  scanGate: () => string;
  /** AR sessions ended before this one. */
  arVisitIndex: () => number;
  now: () => number;
}): ViewingLog {
  let pendingVotes: RecordGpsEventPayload[] = [];
  /** The last logged lock: its code and visit. */
  let lastLock: { text: string; visit: number } | null = null;
  /** The code whose lock just started tracking and has not yet reached the
   *  keep-alive: its next relock is a re-scan, the ones after it are
   *  tracked frames of the same lock. */
  let rescanOf: string | null = null;

  function moment() {
    return { arVisitIndex: deps.arVisitIndex(), atMs: deps.now() };
  }

  return {
    detection(event, level, statusBefore) {
      if (!deps.enabled()) return;
      const visit = deps.arVisitIndex();
      const continues =
        statusBefore === "tracking" &&
        lastLock?.text === event.text &&
        lastLock.visit === visit;
      lastLock = { text: event.text, visit };
      if (continues) return;
      rescanOf = event.text;
      deps.dispatch(
        codeLocked({
          text: event.text,
          level: level?.qr ?? null,
          qrPoseWorld: event.qrPoseWorld,
          reprojectionErrorPx: event.reprojectionErrorPx,
          scanGate: deps.scanGate(),
          alignmentMatrix: deps.alignmentMatrix(),
          ...moment(),
        }),
      );
    },
    vote(payload) {
      if (!deps.enabled()) return;
      pendingVotes.push(payload);
    },
    votedLock(text, votedLocks) {
      const votes = pendingVotes;
      pendingVotes = [];
      if (!deps.enabled()) return;
      deps.dispatch(
        votesCast({
          text,
          votedLocks,
          votes: votes.map((v) => ({
            latitude: v.rawGpsPoint.latitude,
            longitude: v.rawGpsPoint.longitude,
            altitude: finiteOrNull(v.rawGpsPoint.altitude),
            accuracyM: finiteOrNull(v.rawGpsPoint.latLongAccuracy),
            odomPosition: [...v.odomPosition],
          })),
          alignmentMatrix: deps.alignmentMatrix(),
          ...moment(),
        }),
      );
    },
    placed(input) {
      if (!deps.enabled()) return;
      deps.dispatch(
        tourPlaced({
          ...input,
          alignmentMatrix: deps.alignmentMatrix(),
          ...moment(),
        }),
      );
    },
    codeIgnored(input) {
      if (!deps.enabled()) return;
      deps.dispatch(
        codeIgnored({
          ...input,
          alignmentMatrix: deps.alignmentMatrix(),
          ...moment(),
        }),
      );
    },
    keepAlive(inner) {
      /** The last phase logged (or passed while off): its kind and code. */
      let last: { kind: KeepAlivePhase["kind"]; text: string } | null = null;
      function log(
        event: KeepAliveEvent,
        text: string,
        keepAliveMs: number | null,
        phase: KeepAlivePhase,
        kept?: KeptCode,
      ): void {
        last = phase.kind === "none" ? null : { kind: phase.kind, text };
        if (!deps.enabled()) return;
        deps.dispatch(
          keepAliveChanged({
            event,
            text,
            keepAliveMs,
            phase,
            ...(kept === undefined
              ? {}
              : {
                  kept: {
                    qrPoseWorld: kept.qrPoseWorld,
                    qrGeo: kept.qrGeo,
                    sizeM: kept.sizeM,
                  },
                }),
            ...moment(),
          }),
        );
      }
      return {
        ...inner,
        keep(code, atMs) {
          inner.keep(code, atMs);
          if (code.text === rescanOf) rescanOf = null;
          const phase = inner.phase(atMs);
          if (phase.kind !== "none" && phase.text === code.text) {
            log("armed", code.text, atMs, phase, code);
          }
        },
        relock(text, atMs) {
          // A stale pose refuses the restart; the re-scan's fresh voted
          // lock is then logged by keep() as "armed" instead.
          const restarts = inner.holdsFreshPose(text, atMs);
          inner.relock(text, atMs);
          if (!restarts) return;
          const phase = inner.phase(atMs);
          if (phase.kind === "none" || phase.text !== text) return;
          const rescan = rescanOf === text;
          if (rescan) rescanOf = null;
          if (rescan || phase.kind !== last?.kind) {
            log("relocked", text, atMs, phase);
          }
        },
        votesForFix(fix) {
          const votes = inner.votesForFix(fix);
          const phase = inner.phase(fix.atMs);
          if (phase.kind === "none") {
            // A code whose votes cannot be built was dropped.
            if (last !== null) log("stopped", last.text, null, phase);
          } else if (
            (phase.kind === "fading" || phase.kind === "ended") &&
            (phase.kind !== last?.kind || phase.text !== last.text)
          ) {
            log(phase.kind, phase.text, fix.atMs, phase);
          }
          return votes;
        },
        stop() {
          inner.stop();
          if (last !== null) log("stopped", last.text, null, { kind: "none" });
        },
      };
    },
  };
}
