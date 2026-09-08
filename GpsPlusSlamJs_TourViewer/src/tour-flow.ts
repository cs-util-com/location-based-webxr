/**
 * The page-level flow state and the copy derived from it (flows plan M1).
 * The AR status line is the visitor's only feedback during a session
 * (`#error` sits outside the DOM overlay), so its composition lives here,
 * DOM-free and string-exact under test, instead of inline in `main.ts`.
 *
 * Copy rules with a history:
 * - With a tour OPEN and zero authored levels the QR line says so instead
 *   of "Scanning for the printed code…" - the first on-phone session read
 *   that as the app waiting for a code the zip cannot carry (feedback F3).
 *   With NO tour open the scanning line stays: a tour opened later can
 *   still resolve against it (owner verdict 2026-09-04, DEC-T9).
 * - The running prefix "<mode> — AR running · N camera frames" is pinned
 *   by the e2e suite and is a contract.
 */

import type { EnableGpsArState } from "gps-plus-slam-app-framework/ar";
import type { QrTrackingStatus } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  computeOnboardingGuidance,
  type OnboardingGuidance,
  type TrackingQualityReport,
} from "gps-plus-slam-app-framework/state";

import { viewerStatusLine } from "./qr-viewer-mode.js";

/** What the page knows about the open tour, for copy decisions. */
export type TourFlowTour =
  | { kind: "none" }
  | {
      kind: "open";
      /** Authored `qr/<id>.json` count; null while the levels still load. */
      levelCount: number | null;
      /** True when the zip carries an action stream the geo join can read. */
      hasRecording: boolean;
    };

/** What the photo placement did or is doing. The strings are rendered by
 *  {@link placementSegment} - callers never compose copy. */
export type PlacementState =
  | { kind: "idle" }
  | {
      /** AR running with a tour open, the tracking-quality phase not yet
       *  `ready` (flows plan M4, DEC-F3) - the segment shows the phase's
       *  coaching hint. */
      kind: "waiting-ready";
    }
  | {
      /** The tour has neither a recording (capture spots) nor printed
       *  codes (the ring) - said plainly instead of "Scanning…". */
      kind: "nothing-to-place";
    }
  | {
      kind: "placing";
      phase: "reading-walk" | "loading-photos";
      done: number;
      total: number;
    }
  | {
      kind: "placed";
      placedKind: "capture-spots";
      count: number;
      fixes: number;
      gpsAccuracyMedianM: number | null;
    }
  | {
      /** The join declined (taxonomy reason) - the ring is the fallback and
       *  the reason stays visible while it stands. */
      kind: "declined";
      reason: string;
    };

export interface ArStatusInput {
  authorMode: boolean;
  arStatus: EnableGpsArState["status"];
  cameraFrames: number;
  tour: TourFlowTour;
  qr: {
    status: QrTrackingStatus | null;
    unknownCode: string | null;
    unusableCode: string | null;
    votedLocks: number;
    lockedText: string | null;
    reprojectionErrorPx: number | null;
  };
  /** The tracking-quality onboarding phase while running; null before the
   *  slice produced a report (or in author mode, which never reads it). */
  readiness: OnboardingGuidance | null;
  placement: PlacementState;
  /** A failed image-plane placement (the Drive-aware open error text). */
  planesError: string | null;
}

/** The placement trigger (DEC-F3): the tracking-quality `ok` state, read
 *  through the framework's onboarding mapping so the threshold and the
 *  coaching copy stay one contract (DEC-H3). At the first GPS fix the
 *  alignment is the identity - no heading - so an earlier trigger would
 *  start the scene up to 180° wrong. */
export function isPlacementReady(
  report: TrackingQualityReport | null,
): boolean {
  return computeOnboardingGuidance(report).phase === "ready";
}

/** The printed-code line: the viewer pipeline's status, with the no-codes
 *  rule applied for an open tour. Empty in author mode. */
export function qrSegment(input: ArStatusInput): string {
  if (input.authorMode) return "";
  const { qr, tour } = input;
  const nothingDetected =
    qr.unknownCode === null &&
    qr.unusableCode === null &&
    qr.lockedText === null;
  if (
    tour.kind === "open" &&
    tour.levelCount === 0 &&
    nothingDetected &&
    qr.status !== null
  ) {
    return "This tour has no printed codes.";
  }
  return viewerStatusLine(qr);
}

export function placementSegment(
  placement: PlacementState,
  readiness: OnboardingGuidance | null = null,
): string {
  switch (placement.kind) {
    case "idle":
      return "";
    case "waiting-ready":
      // The framework's coaching line for the phase (DEC-H3: shared copy),
      // or a generic wait before the slice has reported at all.
      return readiness === null
        ? "Waiting for tracking to warm up…"
        : readiness.hint;
    case "nothing-to-place":
      return "nothing to place: this tour has no recording and no printed codes";
    case "placing":
      return placement.phase === "reading-walk"
        ? `reading the walk ${String(placement.done)}/${String(placement.total)}…`
        : `loading photos ${String(placement.done)}/${String(placement.total)}…`;
    case "placed": {
      // HONEST label (geo-join review, finding 5): fixes and their median
      // GPS accuracy are what the numbers are - never a claimed placement
      // error.
      const accuracy =
        placement.gpsAccuracyMedianM === null
          ? ""
          : `, median GPS ±${placement.gpsAccuracyMedianM.toFixed(1)}m`;
      return `${String(placement.count)} photos at capture spots (${String(placement.fixes)} fixes${accuracy})`;
    }
    case "declined":
      return `photo ring (${placement.reason})`;
  }
}

/** The "Clear cache" button's confirmation (flows plan M2). `removed` is the
 *  store's index length read BEFORE the open session's eviction - an upper
 *  bound on stored copies, hence "stored tours" rather than a claim about
 *  bytes. */
export function clearCacheLabel(removed: number): string {
  if (removed <= 0) return "Cache cleared - nothing was stored";
  return `Cache cleared - ${String(removed)} stored ${removed === 1 ? "tour" : "tours"} removed`;
}

/** The whole `#ar-status` text for a state. */
export function arStatusLine(input: ArStatusInput): string {
  const mode = input.authorMode ? "Author mode" : "Viewer mode";
  if (input.arStatus !== "running") {
    return `${mode} — ${input.arStatus}`;
  }
  // A declined join on a tour that also has no printed codes is the
  // "nothing to place" case - derived here so `main.ts` never has to
  // re-evaluate it when the levels arrive after the decline.
  const placement: PlacementState =
    input.placement.kind === "declined" &&
    input.tour.kind === "open" &&
    !input.tour.hasRecording &&
    input.tour.levelCount === 0
      ? { kind: "nothing-to-place" }
      : input.placement;
  const segments = [
    `${mode} — AR running · ${String(input.cameraFrames)} camera frames`,
    qrSegment(input),
    placementSegment(placement, input.readiness),
    input.planesError === null ? "" : `images failed: ${input.planesError}`,
  ];
  return segments.filter((segment) => segment !== "").join(" · ");
}
