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
 *
 * @see viewing-log.ts.md
 */

import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrTrackingStatus } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import type { AlignmentMatrix } from "./tour-authoring-actions.js";
import {
  codeLocked,
  tourPlaced,
  votesCast,
  type TourViewingAction,
} from "./tour-viewing-actions.js";

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
}

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
  };
}
