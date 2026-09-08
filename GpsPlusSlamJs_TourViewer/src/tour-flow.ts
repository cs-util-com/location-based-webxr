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
  placement: PlacementState;
  /** A failed image-plane placement (the Drive-aware open error text). */
  planesError: string | null;
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

export function placementSegment(placement: PlacementState): string {
  switch (placement.kind) {
    case "idle":
      return "";
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

/** The whole `#ar-status` text for a state. */
export function arStatusLine(input: ArStatusInput): string {
  const mode = input.authorMode ? "Author mode" : "Viewer mode";
  if (input.arStatus !== "running") {
    return `${mode} — ${input.arStatus}`;
  }
  const segments = [
    `${mode} — AR running · ${String(input.cameraFrames)} camera frames`,
    qrSegment(input),
    placementSegment(input.placement),
    input.planesError === null ? "" : `images failed: ${input.planesError}`,
  ];
  return segments.filter((segment) => segment !== "").join(" · ");
}
