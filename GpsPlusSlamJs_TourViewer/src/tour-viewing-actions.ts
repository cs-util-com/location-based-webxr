/**
 * `tourViewing/*` - actions the VISITOR's pipeline dispatches to be
 * RECORDED, and for nothing else (authoring recording plan 2026-09-28-0953,
 * M1b): the `?debug=1` viewer recording's counterpart of
 * `tour-authoring-actions.ts`.
 *
 * A viewer's scan locks, the votes they cast and the placements they led
 * to happen inside callbacks and the page's session object; the raw
 * stream holds the detections and the vote fixes, but not which lock cast
 * which votes, nor what a placement was computed against. These actions put
 * each of those moments into the stream WITH the inputs it used, so a
 * recording can answer "why did the content land there?" afterwards.
 *
 * NO REDUCER, on purpose (as `tourAuthoring/*` and the framework's
 * `diagnostics/note`): no slice reads them, and the recording is the only
 * place they exist.
 *
 * @see tour-viewing-actions.ts.md
 */

import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  logAction,
  type AlignmentMatrix,
  type LogActionCreator,
} from "./tour-authoring-actions.js";

/** Where each viewing log sits in the page's life. */
interface ViewingMoment {
  /** AR sessions ended before this one (0 = the page's first AR visit). */
  readonly arVisitIndex: number;
  /** Epoch ms. */
  readonly atMs: number;
}

interface CodeLockedLog extends ViewingMoment {
  readonly text: string;
  /** The level the code resolved to (`qr`: printed size, geo, mint
   *  quality), or null when the tour has none for it. */
  readonly level: QrLevel["qr"] | null;
  /** The lock's solve, raw WebXR odometry. */
  readonly qrPoseWorld: Pose;
  readonly reprojectionErrorPx: number;
  /** The scan gate's state when the lock arrived. */
  readonly scanGate: string;
  /** The store's alignment when the lock arrived (before its votes). */
  readonly alignmentMatrix: AlignmentMatrix;
}

/** One cast vote, as the fusion receives it. */
interface VotePointLog {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude: number | null;
  readonly accuracyM: number | null;
  /** The odometry position the vote pairs with the geo point. */
  readonly odomPosition: readonly number[];
}

interface VotesCastLog extends ViewingMoment {
  readonly text: string;
  /** Locks of this code that have voted so far (the budget spent). */
  readonly votedLocks: number;
  readonly votes: readonly VotePointLog[];
  /** The store's alignment AFTER the votes. */
  readonly alignmentMatrix: AlignmentMatrix;
}

interface PlacedLog extends ViewingMoment {
  /** What was placed: the tour's `tour.json` content, the recording's
   *  photos at their capture spots, or the photos ringed around a code. */
  readonly what: "content" | "capture-spots" | "ring";
  /** `geo`: placed from geo positions through the zero and the alignment
   *  at the scene root. `code`: placed around a locked code's geo. */
  readonly basis: "geo" | "code";
  readonly count: number;
  /** The session's GPS zero the geo positions were converted with. */
  readonly zero: { readonly lat: number; readonly lon: number };
  /** The store's alignment at the placement. */
  readonly alignmentMatrix: AlignmentMatrix;
  /** `ring`: the code it was placed around, its geo, and the ring's centre
   *  in the session's NUE. */
  readonly code?: {
    readonly text: string;
    readonly geo: NonNullable<QrLevel["qr"]["geo"]>;
    readonly centerNue: readonly [number, number, number];
  };
  /** `capture-spots`: what the join rested on. */
  readonly join?: {
    readonly fixes: number;
    readonly gpsAccuracyMedianM: number | null;
  };
  /** `content`: ids that could not be rendered. */
  readonly skipped?: readonly string[];
}

export const codeLocked: LogActionCreator<
  "tourViewing/codeLocked",
  CodeLockedLog
> = logAction<CodeLockedLog>()("tourViewing/codeLocked");
export const votesCast: LogActionCreator<
  "tourViewing/votesCast",
  VotesCastLog
> = logAction<VotesCastLog>()("tourViewing/votesCast");
export const tourPlaced: LogActionCreator<"tourViewing/placed", PlacedLog> =
  logAction<PlacedLog>()("tourViewing/placed");

/** Any `tourViewing/*` action. */
export type TourViewingAction =
  | ReturnType<typeof codeLocked>
  | ReturnType<typeof votesCast>
  | ReturnType<typeof tourPlaced>;
