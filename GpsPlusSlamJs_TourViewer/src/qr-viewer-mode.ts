/**
 * Viewer mode (QR-pose plan M4): the tracking-controller configuration that
 * relocalizes a visitor against a tour's printed codes, with the two
 * guardrails the reviews ordered:
 *
 * - **A per-code VOTE BUDGET** (review #6): the controller dispatches a
 *   fresh vote set on EVERY locked frame, so an unbounded visitor standing
 *   at the poster would inject thousands of near-identical synthetic GPS
 *   points and pin the alignment centroid to the poster. The first
 *   {@link MAX_VOTED_LOCKS_PER_CODE} locked frames per code vote; later
 *   locks still track (marker, readout) but write nothing.
 * - **The wide-baseline CAP** (delta #6): the minted rotation error enters
 *   every wide-baseline correspondence at ~0.17 m per degree per 10 m of
 *   ring radius, so {@link VIEWER_VOTE_BASELINE_M} starts at 2 and only
 *   M5's measured numbers may raise it.
 *
 * The level lookup is the deferred NEGATIVE CACHE (delta #8): a scanned
 * code with no `qr/<c>.json` in the open tour resolves a geo-less
 * placeholder — cached per text by the controller — instead of rejecting,
 * which would flap the controller between error and scanning at the
 * detection cadence.
 */

import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";
import type {
  QrDetectionEvent,
  QrSolvePoseInput,
  QrTrackingControllerConfig,
  QrTrackingStatus,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type {
  CameraIntrinsics,
  Pose,
  QrPoseSolution,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type {
  QrFrontEnd,
  RgbaImage,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import { codeFromDetectedText } from "./code-param.js";

/** Synthetic per-vote GPS accuracy (m) — the vote weight's input; M5 tunes. */
export const VIEWER_SYNTHETIC_ACCURACY_M = 5;
/** Wide-baseline ring radius cap (m) — delta #6; only M5 may raise it. */
export const VIEWER_VOTE_BASELINE_M = 2;
/** Correspondences per vote batch (`buildQrGpsVotes` count). */
export const VIEWER_VOTE_COUNT = 4;
/** Locked frames per code that actually vote (review #6); M5 tunes. */
export const MAX_VOTED_LOCKS_PER_CODE = 10;

/** The negative-cache placeholder: geo-less, size-less — never solves,
 *  never votes, and the controller caches it per decoded text. */
const NO_LEVEL_PLACEHOLDER: QrLevel = { version: 1, qr: {} };

/** The device/store functions the viewer pipeline needs — seam-injected. */
export interface ViewerPipelineDeps {
  frontEnd: QrFrontEnd;
  solvePose(input: QrSolvePoseInput): QrPoseSolution | null;
  getCameraPose(): Pose | null;
  getIntrinsics(image: RgbaImage): CameraIntrinsics | null;
  /** The open tour's levels (`TourSession.loadQrLevels()`), or null when
   *  no tour is open — every code then reads as unknown. */
  getLevels(): ReadonlyMap<string, QrLevel> | null;
  /** One synthetic GPS vote → `recordGpsEvent` into the store. */
  dispatchVote(payload: RecordGpsEventPayload): void;
  recordDetection(event: QrDetectionEvent): void;
  onError(message: string): void;
  onStatus?(status: QrTrackingStatus): void;
  /** A scanned code with no level in this tour (fires once per fetch). */
  onUnknownCode?(code: string): void;
  /** A locked frame's votes were dispatched (budget progress for the UI). */
  onVotedLock?(text: string, votedLocks: number): void;
}

export function buildViewerControllerConfig(
  deps: ViewerPipelineDeps,
): QrTrackingControllerConfig {
  /** The code the CURRENT frame detected — the controller's documented
   *  ordering contract fires `onDetection` synchronously before the same
   *  frame's vote dispatch, which is what lets the budget key by text. */
  let lastDetectedText: string | null = null;
  const votedLocksByText = new Map<string, number>();
  return {
    frontEnd: deps.frontEnd,
    solvePose: (input) => deps.solvePose(input),
    fetchLevel: (text) => {
      const code = codeFromDetectedText(text);
      const level = deps.getLevels()?.get(code);
      if (level === undefined) {
        deps.onUnknownCode?.(code);
        return Promise.resolve(NO_LEVEL_PLACEHOLDER);
      }
      return Promise.resolve(level);
    },
    dispatchVotes: (votes) => {
      const text = lastDetectedText;
      if (text === null) return;
      const votedLocks = votedLocksByText.get(text) ?? 0;
      if (votedLocks >= MAX_VOTED_LOCKS_PER_CODE) return;
      votedLocksByText.set(text, votedLocks + 1);
      for (const vote of votes) deps.dispatchVote(vote);
      deps.onVotedLock?.(text, votedLocks + 1);
    },
    onDetection: (event) => {
      lastDetectedText = event.text;
      deps.recordDetection(event);
    },
    getCameraPose: () => deps.getCameraPose(),
    getIntrinsics: (image) => deps.getIntrinsics(image),
    onError: (err) => {
      deps.onError(err instanceof Error ? err.message : String(err));
    },
    ...(deps.onStatus !== undefined
      ? { onStatus: (status: QrTrackingStatus) => deps.onStatus?.(status) }
      : {}),
    syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
    voteBaselineM: VIEWER_VOTE_BASELINE_M,
    voteCount: VIEWER_VOTE_COUNT,
    minIntervalMs: 0, // the camera-frame source is the single cadence owner
  };
}

/** What the viewer's status line shows — pure, plain-language. */
export function viewerStatusLine(input: {
  status: QrTrackingStatus | null;
  unknownCode: string | null;
  votedLocks: number;
  lockedText: string | null;
}): string {
  if (input.unknownCode !== null) {
    return `Code ${input.unknownCode} has no level in this tour.`;
  }
  if (input.status === null) return "";
  if (input.lockedText !== null && input.votedLocks > 0) {
    return input.votedLocks >= MAX_VOTED_LOCKS_PER_CODE
      ? `Relocalized — vote budget spent, placement holds.`
      : `Relocalizing — ${String(input.votedLocks)} of ${String(MAX_VOTED_LOCKS_PER_CODE)} vote batches.`;
  }
  return "Scanning for the printed code…";
}

/**
 * Ring positions (GPS-world NUE) for the tour's image planes around the
 * relocalized code (QD-3) — placed ONCE at the scene root in raw NUE (the
 * framework's built-once parenting rule), at the anchor's height.
 * V1 deviation, deliberate: recording zips carry no per-image GPS (images
 * store odom pose only), so the ring around the anchor is the honest
 * placement until a capture-time geo join exists.
 */
export function imagePlaneRingNue(
  centerNue: readonly [number, number, number],
  count: number,
  radiusM = 1.5,
): [number, number, number][] {
  const [n, u, e] = centerNue;
  const positions: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / Math.max(1, count);
    positions.push([
      n + radiusM * Math.cos(angle),
      u,
      e + radiusM * Math.sin(angle),
    ]);
  }
  return positions;
}
