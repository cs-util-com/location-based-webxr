/**
 * The page's mutable session state as ONE explicit object (flows plan M6,
 * DEC-T6 of the simplification plan): every wiring module receives it and
 * mutates the fields it owns, instead of `main.ts` carrying 28 module-scope
 * variables that four concerns wrote to. No behaviour lives here - the
 * fields' invariants are documented where they are used (see each module's
 * sidecar) and summarised in `tour-viewer-session.ts.md`.
 */

import type { createEnableGpsArController } from "gps-plus-slam-app-framework/ar";
import type {
  createQrTrackingController,
  QrTrackingStatus,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";
import type { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { AUTHOR_DEFAULT_SIZE_M } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { createListenerMiddleware } from "@reduxjs/toolkit";
import {
  createSlamAppStore,
  qrDetectedReducer,
  recordQrDetection,
  slicePrefixOf,
} from "gps-plus-slam-app-framework/state";
import {
  NullStorageBackend,
  type StorageBackend,
} from "gps-plus-slam-app-framework/storage";

import { objectPlaced } from "./tour-authoring-actions.js";
import { codeLocked } from "./tour-viewing-actions.js";
import {
  hostedLevels,
  hostedLevelTexts,
  hostedLevelsUnreadable,
  selectTourDocument,
  tourDocumentActions,
  tourDocumentReducer,
  type TourDocumentState,
} from "./tour-document.js";
import {
  creatorCodesReducer,
  type CreatorCodesState,
} from "./creator-codes-slice.js";
import { visitorGuideReducer } from "./visitor-guide-slice.js";

import type {
  HitTestReticleHandle,
  SelectTargetRay,
} from "gps-plus-slam-app-framework/ar";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";

import type { RenderedTourObjects } from "./content-placement.js";
import type { FusedTallies, LastEvaluation } from "./qr-debug-readout.js";
import type { PrintSizeCheck } from "./print-size-check.js";
import type { MovedCodeChecks } from "./moved-code-check.js";
import type { QrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import type { ViewerVoteSink } from "./viewer-vote-sink.js";
import type { ScanGate } from "./scan-gate.js";
import type { StationContent } from "./station-content.js";
import type { TourViewerSeams } from "./seams.js";
import type { PlacementState } from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";
import {
  createCreatorDocument,
  type CreatorDocument,
  type CreatorDocumentStore,
} from "./creator-document.js";

// Reached through the session object's fields; standalone exports count as
// dead (knip).
type QrController = ReturnType<typeof createQrTrackingController>;
type FusedPoseSource = ReturnType<typeof createFusedQrPoseSource>;
type QrDebugView = ReturnType<TourViewerSeams["createQrDebugView"]>;

/**
 * The page's store: the framework store with the opt-in `qrDetected` slice
 * both modes need (author: stability gate for minting; viewer: the
 * relocalization votes read the same window). One factory so every module
 * types the store the same way.
 *
 * `recording` is the creator's troubleshooting recording
 * (`authoring-recording.ts`): its backend, and its gate REPLACING the
 * `isRecording` one - this app starts and ends a session on every AR entry
 * and exit, so under the default gate the per-exit reset and everything
 * done on the page outside AR would never be written. The numbering runs
 * across those sessions for the same reason. Without it (tests) the store
 * writes into a `NullStorageBackend` as before.
 *
 * `visitorGuide` is the visitor's present station and its "show all"
 * override (`visitor-guide-slice.ts`, visitor plan 2026-10-18-2349 §3),
 * not written into the recording either.
 *
 * It also holds the tour a creator edits (`tourDocument`,
 * `tour-document.ts`, D29-D31) - not written into the recording - and
 * `listenToDocument`, its own listener middleware's `startListening`: a
 * page's side effects of the document (its draft's writes) run there,
 * after the reducer, never from `store.subscribe`. Its own middleware,
 * not an `addListener` dispatch: that would land in whichever of the
 * framework's listener middlewares comes first.
 *
 * `creatorCodes` is the creator's code in hand and its visit's sightings
 * (`creator-codes-slice.ts`, debug-captures plan M3a), not written into
 * the recording either.
 */
export function createTourViewerStore(recording?: {
  storageBackend: StorageBackend;
  persistWhile: () => boolean;
}) {
  const documentListener = createListenerMiddleware<{
    tourDocument: TourDocumentState;
    creatorCodes: CreatorCodesState;
  }>();
  const store = createSlamAppStore({
    storageBackend: recording?.storageBackend ?? new NullStorageBackend(),
    ...(recording === undefined
      ? {}
      : { persistWhile: recording.persistWhile, continuousActionIndex: true }),
    extraReducers: {
      qrDetected: qrDetectedReducer,
      tourDocument: tourDocumentReducer,
      visitorGuide: visitorGuideReducer,
      creatorCodes: creatorCodesReducer,
    },
    extraMiddleware: [documentListener.middleware],
    // Beyond the framework's built-ins (GPS with its paired poses, the
    // recording lifecycle, diagnostics): the QR detections the votes and
    // the mint were computed from, the creator's own log actions, and a
    // debugging visitor's (M1b).
    persistedExtraPrefixes: [
      slicePrefixOf(recordQrDetection.type),
      // Every `tourAuthoring/*` action: placed, measured, settled, finished.
      slicePrefixOf(objectPlaced.type),
      slicePrefixOf(codeLocked.type),
    ],
  });
  return Object.assign(store, {
    listenToDocument: documentListener.startListening,
  });
}
export type TourViewerStore = ReturnType<typeof createTourViewerStore>;

/** The page's store as the session reaches it: the tour document with its
 *  codes, and the creator's code state (`creatorCodes`). */
export interface TourViewerPageStore extends CreatorDocumentStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly creatorCodes: CreatorCodesState;
  };
}
export type ArController = ReturnType<typeof createEnableGpsArController>;

/**
 * Cross-module calls, late-bound: the modules are wired in an order that
 * cannot satisfy every dependency at construction (the archive open needs
 * the AR status renderer, which needs the viewer pipeline, which needs the
 * status renderer). `main.ts` creates this object with no-op members and
 * fills each in as its owner module is wired; callers read it at call time.
 * This is what keeps the modules free of import cycles (`check:cycles`).
 */
export interface TourViewerHooks {
  renderArStatus(): void;
  /** Re-render the AR button (its label depends on the visitor screen's
   *  location gate, which resolves asynchronously). */
  renderArEntry(): void;
  renderAuthorReadout(): void;
  /** A creator's Done in AR (polish round M3, Q-Done): start the finish
   *  if one can start now; false when it cannot (the button then just
   *  leaves). */
  finishFromAr(): boolean;
  tryPlaceTour(): void;
  startAuthorPipeline(): boolean;
  startViewerPipeline(): boolean;
  /** Present the open tour's link in the print panel (M3's prefill), and
   *  advance the wizard. `origin` says which form the creator submitted
   *  from: an open started in step 4 must not answer by jumping to step 2
   *  and collapsing step 4, whose content is the AR overlay root. */
  presentTourForPrint(url: string, origin?: "host-step" | "measure-step"): void;
  /** A tour opened from a FILE (tour kit plan K0): it has no link to
   *  print, so the print step keeps asking for one, and the wizard moves on
   *  as for a link (`origin` as above) without remembering a link. */
  presentLocalTour(origin?: "host-step" | "measure-step"): void;
  /** Step 2's link could not be confirmed but may still work - its file is
   *  not uploaded yet, or the device is offline (polish round M2, A16): the
   *  print step takes it, marked unverified, and the wizard moves on. */
  presentUnverifiedLink(url: string): void;
  /** The open tour's codes arrived: the print step continues their
   *  numbering (polish round M0b). */
  presentTourCodes(): void;
  /** The open tour's levels settled - read, or their read failed
   *  (`levelsUnreadable`): the visitor screen's line and its "needs no
   *  GPS" start follow whether a code can place the tour (r857 review #4,
   *  #5). */
  presentTourLevels(): void;
  /** The open tour's manifest settled (`manifest` null: the zip has no
   *  `tour.json`), or no tour is open any more (`tour` null): the
   *  visitor's start page leads with the tour itself - its name, its
   *  subline and its cover, read from the zip by its archive path through
   *  `loadImage` - or says that it is not finished yet. */
  presentTourInfo(
    tour: {
      readonly manifest: TourManifest | null;
      readonly loadImage: (path: string) => Promise<Blob>;
    } | null,
  ): void;
  /** A tour closed: the finish step's page-side state is stale. */
  resetFinishStep(): void;
  /** A creator's AR visit is running (its world group exists): show the
   *  earlier visits' objects (authoring plan 2026-09-28-0953 §3.2, M2c). */
  beginAuthorVisit(): void;
  /** A creator's AR visit ends: settle it. Called BEFORE the session's
   *  store teardown, which resets the alignment the settle reads. */
  endAuthorVisit(): void;
  /** A creator's tap in AR (an XR select the overlay did not cancel):
   *  select the object under the tap - its target ray from the reticle
   *  driver, or the ring's screen centre when null (authoring plan
   *  2026-09-28-0953 M4; review #4). */
  selectInView(tap: SelectTargetRay | null): void;
  /** No tour is open any more (one closed, or an open failed): the panels
   *  that show a tour's link go back to ASKING for one. Without this, the
   *  print step keeps showing the previous tour's link as immutable text
   *  and step 4 stops offering to open a tour at all - for the rest of the
   *  page's life (M3 milestone review #3). */
  presentNoTour(): void;
  /** Before another tour replaces the open one: false when the creator
   *  declined to leave an unsaved rebuilt file (UI round 1, U2). */
  confirmLeaveTour(): boolean;
  /** A tour opened AND its manifest settled: offer any unsaved work this
   *  device still holds for it, or delete a draft the hosted zip has
   *  already absorbed. It waits for the manifest because "spent" is
   *  defined against it. */
  presentDraftForTour(tourUrl: string): void;
  /** A session reached running, or a tour opened into a running session:
   *  derive the scan gate (idle when no session runs). */
  startScanGate(): void;
  /** A tour closed: the gate belongs to it (idle, clock cancelled). */
  resetScanGate(): void;
  /** The tour's levels arrived (or could not be read): a scanning gate may
   *  be waived. */
  reconsiderScanGate(
    levels: ReadonlyMap<string, QrLevel> | "unavailable",
  ): void;
  /** The visitor's stations (tour kit plan K4): re-judge after a store
   *  change or a camera frame. */
  tickStations(): void;
  /** A printed code locked in the visitor's AR (its level id). */
  stationCodeLocked(levelId: string): void;
  /** Inside the "Start the tour" tap: unlock the stories' sound. */
  unlockStationAudio(): void;
  /** The AR session ended or the tour closed: the story stops, the HUD
   *  goes; the progress stays with the open tour. */
  stopStations(): void;
}

export function createUnwiredHooks(): TourViewerHooks {
  return {
    renderArStatus: () => undefined,
    renderArEntry: () => undefined,
    confirmLeaveTour: () => true,
    renderAuthorReadout: () => undefined,
    tryPlaceTour: () => undefined,
    startAuthorPipeline: () => false,
    startViewerPipeline: () => false,
    presentTourForPrint: () => undefined,
    presentLocalTour: () => undefined,
    presentUnverifiedLink: () => undefined,
    presentTourCodes: () => undefined,
    presentTourLevels: () => undefined,
    presentTourInfo: () => undefined,
    finishFromAr: () => false,
    resetFinishStep: () => undefined,
    beginAuthorVisit: () => undefined,
    endAuthorVisit: () => undefined,
    selectInView: () => undefined,
    presentNoTour: () => undefined,
    presentDraftForTour: () => undefined,
    startScanGate: () => undefined,
    resetScanGate: () => undefined,
    reconsiderScanGate: () => undefined,
    tickStations: () => undefined,
    stationCodeLocked: () => undefined,
    unlockStationAudio: () => undefined,
    stopStations: () => undefined,
  };
}

export interface TourViewerSession {
  // --- the open tour (archive-open.ts) ------------------------------------
  session: TourSession | null;
  /** The open tour's authored QR levels — the viewer pipeline's level
   *  source. A view of the store like `currentLevelTexts`: the tour
   *  document's parsed levels (`hostedLevels`, plan M3b), which the
   *  creator's codes read too. Assigning dispatches `levelsParsed` for the
   *  current open. */
  currentLevels: ReadonlyMap<string, QrLevel> | null;
  /** The same levels' raw file texts, parseable or not
   *  (`TourSession.levelTexts`): what the hosted zip holds for each code
   *  (code book plan M1). A view of the store: the tour document's hosted
   *  levels (`hostedLevelTexts`, debug-captures plan M3a), which
   *  `archive-open.ts` dispatches with its open's generation. Assigning it
   *  dispatches the same for the current open (`levelsArrived`; null:
   *  `levelsCleared`). */
  currentLevelTexts: ReadonlyMap<string, string> | null;
  /** The open tour's levels could not be read (their load rejected): they
   *  never come, so the tour has no usable code (`tourCodesUsable`, r857
   *  review #4). Reset when the tour closes. A view of the store like
   *  `currentLevelTexts` (`hostedLevelsUnreadable`); assigning true
   *  dispatches `levelsUnreadable` for the current open, false clears a
   *  failed read (`levelsCleared`). */
  levelsUnreadable: boolean;
  /** The page's store: the tour document's codes and the creator's code
   *  state live there (`creator-codes.ts` reads and writes them). */
  readonly store: TourViewerPageStore;
  /** The tour as the page edits it: the shared `tourDocument` slice
   *  through the page's handle (`creator-document.ts`, D29-D31) - the
   *  open tour's `tour.json` (`manifest()`, null: none, or not loaded
   *  yet), the creator's placed, edited and deleted objects, their pictures
   *  and AR placements. The finish step writes it back, so content already
   *  in the zip survives a re-measure. Not replaced: one per page. */
  readonly tourDocument: CreatorDocument;
  /** Whether the manifest load settled: the finish step refuses while it
   *  is pending or broken, or it would overwrite the creator's placement
   *  with an empty list (M3 review #5). */
  tourManifestStatus: "pending" | "settled" | "broken";
  /** The creator's walk in the open tour (scan-pass plan S1,
   *  `tour-read-set.ts`), set when `tour.json` settles: the gallery and
   *  the visitor's download leave it out. Empty with no manifest. */
  scanEntries: ReadonlySet<string>;
  /** Bumped per open; a slower open that finishes after a newer one started
   *  must close itself instead of clobbering the newer session. */
  openGeneration: number;

  // --- shared AR session state (ar-entry.ts) ------------------------------
  qrController: QrController | null;
  /**
   * The session's fused QR pose per code (QR near-frontal pose plan §60):
   * what the viewer votes with and the creator mints from. Created with the
   * controller, dropped at session end.
   */
  fusedPose: FusedPoseSource | null;
  /**
   * Per code, the lock counts of the fused pose (plan §66): the `?debug=1`
   * readout. Replaced at each pipeline start and KEPT at session end, so the
   * last session's counts outlive it until the next one (plan §67 #10).
   */
  fusedTallies: FusedTallies | null;
  /**
   * The creator's print-size check (QR size consensus plan S3a); null for a
   * visitor. Reset at AR session end and at a tour switch.
   */
  printSizeCheck: PrintSizeCheck | null;
  /** Whether the page was opened with `?debug=1` (read once at boot). */
  debug: boolean;
  /** The in-scene glue check (axis+cube on the code) — the one check a human
   *  at the poster can perform; spread alone is precision, not accuracy
   *  (milestone review #8). */
  qrDebugView: QrDebugView | null;
  cameraFrameCount: number;
  /** Levels resolved per decoded text, filled by the viewer pipeline's async
   *  `fetchLevel`. Deriving a code's identity is a hash and therefore async,
   *  while the debug view and the image planes need the answer synchronously —
   *  so the one place that can await it caches it here for both. */
  levelByText: Map<string, QrLevel | null>;
  /** The level id each decoded text resolved to (the open tour's; cleared
   *  with `levelByText`): what the moved-code veto is looked up by. */
  levelIdByText: Map<string, string>;

  // --- the creator setup (creator-setup.ts) --------------------------------
  /** The most recently detected code — the one the stability gate tracks. */
  lastDetectedText: string | null;
  /** The printed size CAPTURED at AR entry — the size the solves actually
   *  used; the input is disabled while running (milestone review #3). */
  activeSizeM: number;
  /** A persistent pipeline error (no detector, controller failure) — shown
   *  with priority so store updates cannot clobber it (milestone review #5). */
  authorErrorText: string | null;
  /** GPS-fix count snapshot taken when THIS session's runtime started: the
   *  gpsData slice has no reset, so the lifetime count would re-open the mint
   *  gate instantly on a re-entry over an alignment blended across two odom
   *  origins (PR #360 review). Only fixes since the snapshot count. */
  gpsSamplesAtSessionStart: number;
  /** The odometry frame's epoch (`qrDetected.frameEpoch`) when THIS
   *  session's runtime started: a visit whose frame changed since (a
   *  tracking restart or loop closure) mixes two frames, so the settle
   *  makes no automatic code-spot decision in it (code book plan M6 v5.1). */
  frameEpochAtSessionStart: number;
  /** Bumped per mint so a stale identity hash cannot install an older
   *  level over a newer one. (The code in hand itself, its measurement and
   *  the visit's sighting of it live in the creator's code module,
   *  `creator-codes.ts`, code book plan M5d-2.) */
  mintGeneration: number;
  /** The finish step is running (one at a time); the panel shows its
   *  progress with priority over the measuring readout. */
  finishing: boolean;
  /** The finish step's live progress copy while `finishing`. */
  finishProgress: string;
  /** The last finish failure, shown with priority until the next tap
   *  (the readout used to erase it on the next store dispatch, M3 review #1). */
  finishError: string | null;
  /** The rebuilt zip of the last Finish, saved at the end of step 4 (and
   *  again from its button), with the list its
   *  `manifest.json` carries when the tour has one (K1 milestone review
   *  R7): a second Finish rebuilds from this zip, so its list starts there. */
  rebuiltZip: {
    blob: Blob;
    /** The tour.json this zip carries: what a yes to "did you upload
     *  it?" notes (F19). */
    written: TourManifest;
    filename: string;
    signedManifest?: SignedTourManifest;
    /** A save delivered it (UI round 1, U2: the leave guard). */
    delivered?: boolean;
  } | null;
  /** What the panel calls the open tour (`tourLabel`); null with none. */
  tourLabel: string | null;
  /** The creator's hit-test reticle for the running session. */
  reticle: HitTestReticleHandle | null;
  /** The most recent camera frame - what "Capture a photo" encodes, with
   *  the pose it was captured at (the photo is placed with THAT pose). */
  latestFrame: CapturedCameraFrame | null;
  /** The live previews in the running AR visit, one per object id - this
   *  device's and the hosted zip's (rendered as each lands; re-rendering
   *  everything per placement raced itself and re-decoded every photo, M4
   *  review #7). Keyed by id so an edit, a move or a delete finds its
   *  object, and a tap in AR names what it hit. */
  placedPreviews: Map<string, RenderedTourObjects>;
  /** The last placement's outcome (or a draft notice), shown ahead of the
   *  live readout until the next tap; it gates no control (store
   *  dispatches re-render the readout at the frame cadence and erased it
   *  within a frame, M4 review #3). */
  placementNote: string | null;
  /** Bumped on every AR session end: an async continuation captures it
   *  and must not act on a session it did not start in (M3 review #2). */
  arSessionGeneration: number;

  // --- viewer QR line (viewer-placement.ts) -------------------------------
  viewerQrStatus: QrTrackingStatus | null;
  viewerUnknownCode: string | null;
  viewerUnusableCode: string | null;
  viewerVotedLocks: number;
  viewerLockedText: string | null;
  viewerReprojectionPx: number | null;
  /** The viewer's last NEW fused evaluation - the visitor hint's source
   *  (plan §67 #5: read, never re-evaluated, on render). */
  viewerLastEvaluation: LastEvaluation | null;
  /** Last detection's RMS reprojection error — the on-device quality number. */
  latestReprojectionPx: number | null;
  /** The viewer pipeline's code keep-alive (authoring plan M2b): created
   *  per AR entry with the pipeline, stopped at AR exit (`endQrPipeline`)
   *  and when its tour closes; the status line reads its phase. */
  viewerKeepAlive: QrVoteKeepAlive | null;
  /** The viewer pipeline's per-code vote budget: created per AR entry with
   *  the pipeline, dropped at AR exit, and reset when its tour closes
   *  ({@link endTourCodeVotes}) - the pipeline outlives a tour switch. */
  viewerVoteBudget: QrVoteBudget | null;
  /** This visitor AR entry's vote sink (`viewer-vote-sink.ts`, authoring
   *  plan M2e): created at the entry's start (which clears the solver
   *  overrides), the way every vote and every keep-alive tick reaches the
   *  store, kept across a tour switch and dropped at AR exit (the next
   *  entry's start clears the overrides). Null outside a visitor entry: device fixes then
   *  take the plain `recordGpsEvent`. */
  viewerVoteSink: ViewerVoteSink | null;
  /** This visitor AR entry's moved-code checks (authoring plan
   *  2026-09-28-0953 §3.6, D20, M5c): created with the pipeline, cleared at
   *  a tour switch, dropped at AR exit. */
  movedCodeChecks: MovedCodeChecks | null;
  /** The codes the moved-code check judged moved, by level id, with the
   *  spread the veto was read on: ignored for THIS tour (§7j #13) - kept
   *  across AR entries, cleared at a tour switch ({@link endTourCodeVotes})
   *  and when the check lifts a veto on wider evidence (polish round C5,
   *  `restoreMovedCode`). */
  ignoredCodes: Map<
    string,
    { readonly text: string; readonly vetoSpreadM: number }
  >;
  /** The ignored code the status line names in this AR entry (vetoed, or
   *  seen again); null when none. */
  viewerIgnoredText: string | null;
  /** The code whose voted lock passed the scan gate (`passed` via
   *  `code`); null otherwise. A veto flips the gate to `ignored` only for
   *  THIS code (M5c review M1). */
  scanGateCodeText: string | null;

  // --- placement (viewer-placement.ts) ------------------------------------
  /** Whether the placement still waits for readiness - rendered by
   *  tour-flow. */
  placement: PlacementState;
  /** A failed `tour.json` content render, surfaced in the AR status line
   *  on its own channel (M5 review #5) - `#error` is a sibling of
   *  `#ar-root` and invisible during the session (the milestone-review-#4
   *  trap; PR #366 review). */
  contentError: string | null;
  /** The store subscription while a viewer session runs (flows plan M4). */
  placementUnsubscribe: (() => void) | null;
  /** Whether this session+tour's wait for readiness ended (tracking ready,
   *  or a code lined the tour up): the coaching does not come back. */
  placementAttempted: boolean;

  // --- the scan gate and the placed content (viewer-placement.ts, M5) ------
  /** This AR entry runs without location (QR-first M1b-1): the visitor
   *  declined it, so no GPS fix will come; the gate offers no GPS escape. */
  codesOnly: boolean;
  scanGate: ScanGate;
  /** Cancels the escape clock while the gate scans. */
  cancelEscapeClock: (() => void) | null;
  /** The visitor's content per station (`station-content.ts`): the
   *  tour's items as parts of their stations, drawn only while the store
   *  shows them.
   *  Created with the first part after the gate; disposed at the session's
   *  end and when its tour closes. */
  stationContent: StationContent | null;
  /** Whether this session already attempted the content placement. */
  contentAttempted: boolean;
}

/**
 * End the session's QR pipeline (QR near-frontal pose plan §61): dispose the
 * controller, so a decode or level fetch still in flight reaches no callback
 * - no detection into the next session's window, no status line, no vote -
 * and forget it. Nulling it alone only stopped NEW frames.
 */
export function endQrPipeline(ctx: TourViewerSession): void {
  ctx.qrController?.dispose();
  ctx.qrController = null;
  ctx.fusedPose = null;
  // The code's keep-alive ends with the AR entry (authoring plan M2b): its
  // pose is in this session's odometry frame, which the next entry resets.
  ctx.viewerKeepAlive?.stop();
  ctx.viewerKeepAlive = null;
  ctx.viewerVoteBudget = null;
  ctx.viewerVoteSink = null;
  // The checks' pins are in this entry's odometry frame; the veto memory
  // (`ignoredCodes`) outlives the entry, the line naming it does not.
  ctx.movedCodeChecks = null;
  ctx.viewerIgnoredText = null;
}

/**
 * A tour closed while the AR entry goes on (`archive-open.ts`): its codes'
 * votes end with it. The keep-alive stops holding the closing tour's code,
 * and every code's vote budget starts again - the budget lives in the
 * pipeline, which outlives the switch, and a reopened tour used to find its
 * code already "voted": its gate passed on a lock that cast nothing, and a
 * spent code never voted again (authoring plan 2026-09-28-0953, M2b
 * review #6). The soft trimming stays on (M2e milestone review #1; the seam
 * contract, rule 3): the closed tour's votes stay in the GPS history until
 * AR exit, and the hard trim back on them would jump the alignment. The
 * moved-code checks and the veto memory are the closing tour's too (D20,
 * M5c; §7j #13: per tour, cleared at a tour switch).
 */
export function endTourCodeVotes(ctx: TourViewerSession): void {
  ctx.viewerKeepAlive?.stop();
  ctx.viewerVoteBudget?.reset();
  ctx.movedCodeChecks?.clear();
  ctx.ignoredCodes.clear();
  ctx.viewerIgnoredText = null;
}

/**
 * Whether the moved-code check made the viewer ignore this decoded text's
 * code: its level id is in the veto memory (`ignoredCodes`, per tour, kept
 * across AR entries). The one reading of that memory: the viewer pipeline's
 * `isIgnored` and the status line's hint guard both use it, never
 * `viewerIgnoredText`, which names only the latest veto of this AR entry.
 */
export function isCodeIgnored(
  ctx: Pick<TourViewerSession, "levelIdByText" | "ignoredCodes">,
  text: string,
): boolean {
  const id = ctx.levelIdByText.get(text);
  return id !== undefined && ctx.ignoredCodes.has(id);
}

/** The page's session object; `store` holds its tour document (the
 *  page's store; a fresh one in tests that need no other). */
export function createTourViewerSession(
  store: TourViewerPageStore = createTourViewerStore(),
): TourViewerSession {
  const document = () => selectTourDocument(store.getState());
  const ctx: TourViewerSession = {
    session: null,
    get currentLevels() {
      return hostedLevels(document());
    },
    set currentLevels(levels) {
      store.dispatch(
        tourDocumentActions.levelsParsed({
          session: ctx.openGeneration,
          levels:
            levels === null
              ? null
              : [...levels].map(([id, level]) => ({ id, level })),
        }),
      );
    },
    get currentLevelTexts() {
      return hostedLevelTexts(document());
    },
    set currentLevelTexts(texts) {
      const session = ctx.openGeneration;
      store.dispatch(
        texts === null
          ? tourDocumentActions.levelsCleared({ session })
          : tourDocumentActions.levelsArrived({
              session,
              texts: [...texts].map(([id, json]) => ({ id, json })),
            }),
      );
    },
    get levelsUnreadable() {
      return hostedLevelsUnreadable(document());
    },
    set levelsUnreadable(unreadable) {
      const session = ctx.openGeneration;
      if (unreadable) {
        store.dispatch(tourDocumentActions.levelsUnreadable({ session }));
      } else if (hostedLevelsUnreadable(document())) {
        store.dispatch(tourDocumentActions.levelsCleared({ session }));
      }
    },
    store,
    tourDocument: createCreatorDocument(store),
    tourManifestStatus: "settled",
    scanEntries: new Set(),
    openGeneration: 0,
    qrController: null,
    fusedPose: null,
    fusedTallies: null,
    printSizeCheck: null,
    debug: false,
    qrDebugView: null,
    cameraFrameCount: 0,
    levelByText: new Map(),
    levelIdByText: new Map(),
    lastDetectedText: null,
    activeSizeM: AUTHOR_DEFAULT_SIZE_M,
    authorErrorText: null,
    gpsSamplesAtSessionStart: 0,
    frameEpochAtSessionStart: 0,
    mintGeneration: 0,
    finishing: false,
    finishProgress: "",
    finishError: null,
    rebuiltZip: null,
    tourLabel: null,
    arSessionGeneration: 0,
    reticle: null,
    latestFrame: null,
    placedPreviews: new Map(),
    placementNote: null,
    viewerQrStatus: null,
    viewerUnknownCode: null,
    viewerUnusableCode: null,
    viewerVotedLocks: 0,
    viewerLockedText: null,
    viewerReprojectionPx: null,
    viewerLastEvaluation: null,
    latestReprojectionPx: null,
    viewerKeepAlive: null,
    viewerVoteBudget: null,
    viewerVoteSink: null,
    movedCodeChecks: null,
    ignoredCodes: new Map(),
    viewerIgnoredText: null,
    scanGateCodeText: null,
    placement: { kind: "idle" },
    contentError: null,
    placementUnsubscribe: null,
    placementAttempted: false,
    codesOnly: false,
    scanGate: { kind: "idle" },
    cancelEscapeClock: null,
    stationContent: null,
    contentAttempted: false,
  };
  return ctx;
}
