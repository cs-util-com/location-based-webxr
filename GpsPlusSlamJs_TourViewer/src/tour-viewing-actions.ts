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

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import type { MovedCodeEvidence } from "./moved-code-check.js";
import type { KeepAlivePhase } from "./qr-vote-keep-alive.js";

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

interface KeepAliveLog extends ViewingMoment {
  /**
   * What changed in the code's keep-alive (`qr-vote-keep-alive.ts`):
   * - `armed` - a voted lock handed it the code and the stable pose it
   *   re-votes from (`kept`); the hold starts over;
   * - `relocked` - a re-scan of the kept code (the first frame of a new
   *   lock); `phase` says whether the hold started over;
   * - `fading` / `ended` - noticed at the first device fix past the hold,
   *   or past the fade;
   * - `stopped` - forgotten: the AR exit, the code's tour closed, or a
   *   code whose votes cannot be built.
   */
  readonly event: "armed" | "relocked" | "fading" | "ended" | "stopped";
  /** The kept code. */
  readonly text: string;
  /** The time the keep-alive was given, on its own clock (the lock's
   *  detection time, or the fix's timestamp); null for `stopped`. */
  readonly keepAliveMs: number | null;
  /** The keep-alive's phase at `keepAliveMs`, after the change. */
  readonly phase: KeepAlivePhase;
  /** `armed`: what it re-votes from (raw WebXR odometry, the level's geo,
   *  the printed size). */
  readonly kept?: {
    readonly qrPoseWorld: Pose;
    readonly qrGeo: QrGeoPose;
    readonly sizeM: number;
  };
}

interface CodeIgnoredLog extends ViewingMoment {
  /** The code the moved-code check judged moved (authoring plan
   *  2026-09-28-0953 §3.6, D20, M5c), and its level id - what the veto is
   *  kept by for the rest of the tour. */
  readonly text: string;
  readonly levelId: string;
  /** The detector's inputs as computed (§7j #15): device-only accuracies,
   *  the fitted offset and yaw, span, spread, which channel decided, the
   *  rule's version. */
  readonly evidence: MovedCodeEvidence;
  /** What the recovery did: device fixes re-fed after the GPS history was
   *  reset, in how many batches. */
  readonly recovery: { readonly refedFixes: number; readonly batches: number };
  /** The store's alignment AFTER the recovery. */
  readonly alignmentMatrix: AlignmentMatrix;
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
export const keepAliveChanged: LogActionCreator<
  "tourViewing/keepAlive",
  KeepAliveLog
> = logAction<KeepAliveLog>()("tourViewing/keepAlive");

export const codeIgnored: LogActionCreator<
  "tourViewing/codeIgnored",
  CodeIgnoredLog
> = logAction<CodeIgnoredLog>()("tourViewing/codeIgnored");

/** Any `tourViewing/*` action. */
export type TourViewingAction =
  | ReturnType<typeof codeIgnored>
  | ReturnType<typeof codeLocked>
  | ReturnType<typeof votesCast>
  | ReturnType<typeof tourPlaced>
  | ReturnType<typeof keepAliveChanged>;
