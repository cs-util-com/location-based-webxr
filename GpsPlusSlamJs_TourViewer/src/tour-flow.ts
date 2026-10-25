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

import type { ViewerMode } from "./mode.js";
import { IGNORED_CODE_LINE, viewerStatusLine } from "./qr-viewer-mode.js";
import { notFinishedSentence } from "./tour-unfinished.js";
import type { KeepAlivePhase } from "./qr-vote-keep-alive.js";
import { gateSegment, type ScanGate } from "./scan-gate.js";

/** What the page knows about the open tour, for copy decisions (reached
 *  through `ArStatusInput["tour"]`; a standalone export counts as dead). */
type TourFlowTour =
  | { kind: "none" }
  | {
      kind: "open";
      /** Authored `qr/<id>.json` count; null while the levels still load. */
      levelCount: number | null;
      /** Present for a visitor's tour that is not finished yet
       *  (`tour-unfinished.ts`), with the tour's contact (absent: none). */
      unfinished?: { readonly contact: string | undefined };
    };

/** Whether the placement still waits for the tracking to be ready. The
 *  strings are rendered by {@link placementSegment} - callers never compose
 *  copy. */
export type PlacementState =
  | { kind: "idle" }
  | {
      /** AR running with a tour open, the tracking-quality phase not yet
       *  `ready` (flows plan M4, DEC-F3) - the segment shows the phase's
       *  coaching hint. */
      kind: "waiting-ready";
    };

export interface ArStatusInput {
  mode: ViewerMode;
  arStatus: EnableGpsArState["status"];
  /** The controller's error message while `arStatus` is "error" (the
   *  visitor's line maps it to a plain cause, UI round 1). */
  arError?: string | null;
  cameraFrames: number;
  /** The session runs without location (QR-first M1b-1): the codes place
   *  the tour, no GPS fix will come. Absent: false. */
  codesOnly?: boolean;
  tour: TourFlowTour;
  qr: {
    status: QrTrackingStatus | null;
    unknownCode: string | null;
    unusableCode: string | null;
    votedLocks: number;
    lockedText: string | null;
    reprojectionErrorPx: number | null;
    /** The fused pose's hint before the first vote (plan §66). */
    fusedHint?: string | null;
    /** The code keep-alive's phase (authoring plan M2b): what the line
     *  says once the vote budget is spent. */
    hold?: KeepAlivePhase | null;
    /** Device GPS fixes stored this session (votes not counted): with none
     *  the hold line claims no countdown and no GPS (QR-first M1); with
     *  fewer than one lock's ring, no hand-over (PR #620 review). */
    deviceFixes?: number;
    /** A code the moved-code check ignores, vetoed or seen in this AR entry
     *  (authoring plan 2026-09-28-0953 §3.6, D20, M5c). */
    ignoredCode?: string | null;
  };
  /** The tracking-quality onboarding phase while running; null before the
   *  slice produced a report (or in author mode, which never reads it). */
  readiness: OnboardingGuidance | null;
  placement: PlacementState;
  /** A failed `tour.json` content render (its own channel, M5 review #5). */
  contentError: string | null;
  /** The visitor's scan gate (M5); `idle` outside a session. */
  gate: ScanGate;
  /** The tour's placed content (`tour.json`), once rendered. */
  content:
    { kind: "none" } | { kind: "placed"; count: number; skipped: number };
  /** The visitor guide has stations to point at and waits for a heading
   *  (D34 of the tour editor plan 2026-10-17-1816; the store's
   *  `visitorGuide.headingPending`): the visitor's line asks for a few
   *  steps. Absent: false. */
  stationsAwaitHeading?: boolean;
  /** The tour is placed and every piece of its content waits at a station
   *  not shown now (`StationContent.showsAny` false): nothing is in view,
   *  so the visitor's line asks for a station. Absent: false. */
  awayFromStations?: boolean;
  /** The visitor's walk runs (its sheet shows): the
   *  guide runs only once the tour's zero is known, so its stations are
   *  placed and the tour counts as placed, even with no content standing
   *  (a tour whose stations hold only stories places none). Absent:
   *  false. */
  walkRuns?: boolean;
}

/** The content segment: how many of the tour's objects stand. */
export function contentSegment(content: ArStatusInput["content"]): string {
  if (content.kind === "none") return "";
  const noun = content.count === 1 ? "placed object" : "placed objects";
  const skipped =
    content.skipped > 0 ? ` (${String(content.skipped)} could not load)` : "";
  return `${String(content.count)} ${noun}${skipped}`;
}

/** The placement trigger (DEC-F3): the tracking-quality `ok` state, read
 *  through the framework's onboarding mapping so the threshold and the
 *  coaching copy stay one contract (DEC-H3). At the first GPS fix the
 *  alignment is the identity - no heading - so an earlier trigger would
 *  start the scene up to 180° wrong. One exemption (QR-first M1): a code
 *  that placed the tour (`codePlacedTour` below) places
 *  before this gate, and cannot be 180° wrong - a voted lock's ring
 *  carries the code's saved heading, unlike a single GPS fix. */
export function isPlacementReady(
  report: TrackingQualityReport | null,
): boolean {
  return computeOnboardingGuidance(report).phase === "ready";
}

/** A code lined the tour up: its votes were cast (after the escape too -
 *  the gate stays "skipped" when a later lock votes). Read by the visitor's
 *  status line and by the station guide, whose position is then the
 *  code's, not the raw fixes'. */
export function codeLinedUp(
  qr: Pick<ArStatusInput["qr"], "lockedText" | "votedLocks">,
): boolean {
  return qr.lockedText !== null && qr.votedLocks > 0;
}

/** Whether a code's votes placed this tour: the gate passed on a voted
 *  lock of a trusted code (M5). The placement trigger then ends the wait
 *  for readiness whatever the tracking-quality phase reads (`viewer-placement.ts`, §7
 *  #9). The voted count goes back to 0 when a veto takes every vote back
 *  (r881 review M1), so a gate another code passed no longer counts, and
 *  when an odometry-frame change ends the code's trust
 *  (`viewer-placement.ts` `endCodeTrust`): its votes name places in the
 *  old frame until its next voted lock. */
export function codePlacedTour(ctx: {
  readonly scanGate: ScanGate;
  readonly viewerVotedLocks: number;
}): boolean {
  return (
    ctx.scanGate.kind === "passed" &&
    ctx.scanGate.via === "code" &&
    ctx.viewerVotedLocks > 0
  );
}

/**
 * Whether the visitor's stations may be judged on the session's alignment
 * - its position found by, the HUD's arrows and the breadcrumbs pointed on
 * it: tracking ready (`isPlacementReady`) or a code lined it up
 * (`codeLinedUp`; a voted lock after the gate's escape too, which ends
 * the wait for readiness by itself, `onVotedLock`). Before it the alignment is
 * the identity at the first fix, which can be 180° wrong. The guide's
 * find re-reads this each tick, and while it is false judges by the fresh
 * device fix instead (r881 review H1); what needs a heading (the arrows,
 * the breadcrumbs, the figure) latches its first `true` per AR entry, as
 * the placement trigger does, so a degraded dip does not take it away (r881
 * re-review L-B).
 */
export function alignmentReady(
  report: TrackingQualityReport | null,
  qr: Pick<ArStatusInput["qr"], "lockedText" | "votedLocks">,
): boolean {
  return isPlacementReady(report) || codeLinedUp(qr);
}

/**
 * The share of the heading a compass must carry before it confirms the
 * radar's north (`compassHeadingVerdict`). PROVISIONAL: the sweep in
 * `tour-flow.test.ts` finds every threshold in (0.03, 0.4] gives the same
 * verdicts on its scenarios, but the scenarios are assumed, not recorded.
 * The value that actually reverses the verdict is the applied share at the
 * first compass reading: about 1 for a visitor standing still at a cold
 * start, so any threshold up to about 0.9 gives the same verdict there;
 * only a compass first read once GPS already carries most of the heading
 * sits near the band's top. Not measured on a phone.
 */
export const COMPASS_CONFIRMS_WEIGHT = 0.25;

/** What the compass diagnostics say about the heading now: a compass
 *  carried a real share of it (`confirms`), it is marked untrusted
 *  (`distrusts`), or nothing either way (`silent`). */
export type CompassHeadingVerdict = "confirms" | "distrusts" | "silent";

/** The compass diagnostics' fields this reads (the framework's
 *  `getCompassDiagnostics` result, structurally): each absent until
 *  measured, the share absent while no compass reading exists. */
interface CompassDiagnosticsLike {
  readonly appliedWeight?: number | undefined;
  readonly trust?: { readonly state?: string } | undefined;
}

/**
 * Whether a compass stands behind the heading now. Untrusted wins over
 * any share (in the default configuration the trust is never
 * re-evaluated, so `distrusts` does not occur there and a confirm is not
 * checked against anything); a share confirms only when it is a finite number of at least
 * `minWeight` (at most 1). Anything else - no diagnostics, no reading, a
 * share of 0 (GPS alone carries the heading), a value that is no share -
 * is silent, never a confirm.
 */
export function compassHeadingVerdict(
  diagnostics: CompassDiagnosticsLike | null | undefined,
  minWeight: number = COMPASS_CONFIRMS_WEIGHT,
): CompassHeadingVerdict {
  if (diagnostics === null || diagnostics === undefined) return "silent";
  if (diagnostics.trust?.state === "untrusted") return "distrusts";
  const w = diagnostics.appliedWeight;
  return typeof w === "number" &&
    Number.isFinite(w) &&
    w >= minWeight &&
    w <= 1 &&
    w > 0
    ? "confirms"
    : "silent";
}

/** The printed-code line: the viewer pipeline's status, with the no-codes
 *  rule applied for an open tour. Empty in author mode. */
const NO_PRINTED_CODES = "This tour has no printed codes.";

export function qrSegment(input: ArStatusInput): string {
  if (input.mode === "creator") return "";
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
    return NO_PRINTED_CODES;
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
  const mode = input.mode === "creator" ? "Creator mode" : "Visitor mode";
  if (input.arStatus !== "running") {
    // The cause of a failed start, for the creator and ?debug=1: the button
    // only says "Try again" since UI round 1 (U1 milestone review #1).
    return input.arStatus === "error" && input.arError != null
      ? `${mode} — error: ${input.arError}`
      : `${mode} — ${input.arStatus}`;
  }
  // A tour that is not finished yet has nothing to scan for or place: the
  // sentence stands alone after the prefix.
  if (input.tour.kind === "open" && input.tour.unfinished !== undefined) {
    return `${mode} — AR running · ${String(input.cameraFrames)} camera frames · ${notFinishedSentence(input.tour.unfinished.contact)}`;
  }
  const placement = input.placement;
  // While the gate scans, the placement's coaching hint ("walk around")
  // would contradict "stay at the code": the gate's line stands alone.
  const gateScanning = input.gate.kind === "scanning";
  const qr = qrSegment(input);
  // The gate already names the code situation ("no measured code", or
  // "could not be read"); the pipeline's own line would say it twice, or
  // contradict it by scanning for a code that will never resolve (M5
  // review #12, PR #434 review).
  const gateSaysNoCode =
    input.gate.kind === "not-required" &&
    (input.gate.reason === "no-lockable-level" ||
      input.gate.reason === "levels-unavailable");
  // A code the moved-code check ignores (D20, M5c; §7j #4): the gate's
  // short pass stands in for the generic scanning line, and the pipeline's
  // plain sentence about the code, when it names one, stands for both.
  const gateIgnored =
    input.gate.kind === "passed" && input.gate.via === "ignored";
  const segments = [
    `${mode} — AR running · ${String(input.cameraFrames)} camera frames`,
    // The gate's own "point the phone at the code" replaces the pipeline's
    // generic scanning line; a detected-but-unknown code still shows.
    ((gateScanning || gateIgnored) &&
      qr === "Scanning for the printed code…") ||
    (gateSaysNoCode &&
      (qr === NO_PRINTED_CODES || qr === "Scanning for the printed code…"))
      ? ""
      : qr,
    gateIgnored && qr === IGNORED_CODE_LINE
      ? ""
      : gateSegment(input.gate, input.codesOnly === true),
    gateScanning ? "" : placementSegment(placement, input.readiness),
    contentSegment(input.content),
    input.contentError === null
      ? ""
      : `placed content failed: ${input.contentError}`,
  ];
  return segments.filter((segment) => segment !== "").join(" · ");
}
